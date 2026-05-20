"""FTC event & team service — orchestrates FTC Events API + FTC Scout + GATool."""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import date, timedelta
from typing import Any

import json

from .ftc_client import get_ftc_client
from .ftcscout_client import get_ftcscout_client
from .gatool_client import get_gatool_client
from .payload_cache import read_payload, write_payload, invalidate
from .supabase_client import (
    get_cached_summary,
    set_cached_summary,
    read_event,
    read_event_teams_full,
    read_matches,
)

log = logging.getLogger(__name__)

# FTC seasons are named by their kickoff year. A new game launches each year
# in early September (e.g. "DECODE" = 2025-2026 = season 2025). We treat the
# kickoff month as August onward so championships in late summer roll over
# slightly early rather than late.
_FTC_SEASON_ROLLOVER_MONTH = 8


def current_ftc_season(today: date | None = None) -> int:
    """Return the active FTC kickoff year for today's date."""
    today = today or date.today()
    return today.year if today.month >= _FTC_SEASON_ROLLOVER_MONTH else today.year - 1


# Backwards-compatible module-level alias used by callers below. Computed at
# import time and refreshed on each access via __getattr__ so workers picking
# up the value after a season rollover don't keep a stale year.
def __getattr__(name: str):  # PEP 562
    if name == "FTC_CURRENT_SEASON":
        return current_ftc_season()
    raise AttributeError(name)


def _event_status(start_date: str, end_date: str) -> str:
    """Return 'upcoming', 'ongoing', or 'completed' based on today's date."""
    today = date.today()
    try:
        sd = date.fromisoformat(start_date[:10])  # handle datetime strings
        ed = date.fromisoformat(end_date[:10])
    except (ValueError, TypeError):
        return "unknown"
    if today > ed + timedelta(days=1):
        return "completed"
    if today >= sd:
        return "ongoing"
    return "upcoming"


def _sb_ftc_teams_valid(sb_rows: list[dict]) -> bool:
    """Return True if Supabase event_teams rows are rich enough to serve.

    Requires at least one row with rank or opr_total in raw_data — the same
    bar FRC uses.  Pure stub rows (only the team_key upserted by _sync_ftc_teams
    before stats/rankings arrive) are skipped so we fall through to the API.
    """
    for r in sb_rows:
        rd = r.get("raw_data") or {}
        if isinstance(rd, str):
            rd = json.loads(rd)
        if not isinstance(rd, dict):
            continue
        # Require rank to be present — OPR alone can be a false positive.
        # Rank confirms _sync_ftc_rankings has run; OPR from Scout may exist
        # even when rankings failed, leading to null rank served from cache.
        if rd.get("rank") is not None:
            return True
    return False


async def get_season_events(year: int, *, include_offseason: bool = False) -> list[dict]:
    """Return FTC events for a season, normalised to the frontend format."""
    client = get_ftc_client()
    raw_events = await client.get_events(year)

    # FTC Events API type codes (string integers):
    # 0=Scrimmage, 1=LeagueMeet, 2=Qualifier, 3=LeagueTournament,
    # 4=Championship, 6=FIRSTChampionship, 7=SuperQualifier,
    # 10=OffSeason/Invitational, 12=Kickoff, 14=PracticeDay/BuildDay,
    # 15=VolunteerEvent, 17=Premier
    NON_COMPETITION_TYPES = {"0", "12", "14", "15"}  # Scrimmage, Kickoff, PracticeDay, Volunteer
    OFFSEASON_TYPES = {"10"}

    results: list[dict] = []
    for ev in raw_events:
        type_code = str(ev.get("type", ""))
        # Skip non-competition events
        if type_code in NON_COMPETITION_TYPES:
            continue
        # Skip offseason unless requested
        if not include_offseason and type_code in OFFSEASON_TYPES:
            continue

        results.append(_normalise_event(ev, year))

    # Sort by date
    results.sort(key=lambda e: e.get("start_date", ""))
    return results


def _parse_ftc_bracket_label(desc: str, series: int, match_num: int) -> tuple:
    """Parse FTC playoff description into (comp_level, label, sort_key).

    FTC Events API descriptions follow the pattern:
    "Upper Bracket  Round N Match M"
    "Lower Bracket  Round N Match M"
    "Final Bracket  Round N Match M"
    """
    dl = desc.lower()
    round_m = re.search(r'round\s*(\d+)', dl)
    rnd = int(round_m.group(1)) if round_m else series

    if 'final bracket' in dl or ('final' in dl and 'semi' not in dl):
        comp_level = "f"
        label = "Final"
        if match_num > 1:
            label += f" (Match {match_num})"
        sort_key = (3, 0, match_num)
    elif 'upper bracket' in dl:
        comp_level = "sf"
        label = f"Upper R{rnd}"
        if match_num > 1:
            label += f" (Match {match_num})"
        sort_key = (1, rnd, match_num)
    elif 'lower bracket' in dl:
        comp_level = "sf"
        label = f"Lower R{rnd}"
        if match_num > 1:
            label += f" (Match {match_num})"
        sort_key = (2, rnd, match_num)
    else:
        # Fallback: use description or generic label
        comp_level = "sf"
        label = desc.strip() if desc.strip() else f"Playoff {series}"
        sort_key = (1, series, match_num)

    return comp_level, label, sort_key


def _normalise_event(ev: dict, year: int) -> dict:
    """Convert an FTC Events API event object to our frontend format."""
    code = ev.get("code", "")
    event_key = f"{year}ftc{code}".lower()

    # FTC Events API returns type as a string integer code
    raw_type = str(ev.get("type", ""))

    # Map numeric type codes to our internal event_type numbers
    type_code_map = {
        "0": 0,    # Scrimmage
        "1": 1,    # League Meet
        "2": 2,    # Qualifier
        "3": 3,    # League Tournament
        "4": 4,    # Championship
        "6": 6,    # FIRST Championship
        "7": 5,    # Super Qualifier
        "10": 99,  # Off-Season / Invitational
        "12": 100, # Kickoff
        "14": 100, # Practice Day / Build Day
        "15": 100, # Volunteer Event
        "17": 3,   # Premier
    }
    event_type = type_code_map.get(raw_type, 2)

    # Human-readable type string
    type_label_map = {
        "0": "Scrimmage",
        "1": "League Meet",
        "2": "Qualifier",
        "3": "League Tournament",
        "4": "Championship",
        "6": "FIRST Championship",
        "7": "Super Qualifier",
        "10": "Off-Season",
        "12": "Kickoff",
        "14": "Practice Day",
        "15": "Volunteer Event",
        "17": "Premier",
    }
    event_type_string = type_label_map.get(raw_type, "Qualifier")

    start = ev.get("dateStart", "")
    end = ev.get("dateEnd", "")

    # FTC Events API doesn't provide weekNumber; derive month from start_date
    month = None
    if start:
        try:
            month = int(start[5:7])  # ISO date: YYYY-MM-DD
        except (ValueError, IndexError):
            pass

    return {
        "key": event_key,
        "event_code": code,
        "name": ev.get("name", code),
        "short_name": ev.get("name", code),
        "event_type": event_type,
        "event_type_string": event_type_string,
        "city": ev.get("city", ""),
        "state_prov": ev.get("stateprov", ""),
        "country": ev.get("country", ""),
        "start_date": start,
        "end_date": end,
        "year": year,
        "week": None,
        "month": month,
        "district": None,
        "division_code": ev.get("divisionCode", None),
        "region_code": ev.get("regionCode", ""),
        "league_code": ev.get("leagueCode", ""),
        "region": ev.get("regionCode", "") or ev.get("stateprov", "") or ev.get("country", ""),
        "status": _event_status(start, end),
        "avatar": None,
        "program": "FTC",
    }


async def get_event_info(event_key: str) -> dict:
    """Return event info for an FTC event key like '2025ftcabc'.

    Reads from Supabase first (populated by ftc_event_sync worker every 120 s);
    falls back to the FTC Events API on a cold miss.
    """
    # ── Try Supabase first ──────────────────────────────────
    try:
        row = await read_event(event_key)
    except Exception:
        row = None

    if row:
        raw = row.get("raw_data") or {}
        if isinstance(raw, str):
            raw = json.loads(raw)
        start = str(row.get("start_date", ""))
        end = str(row.get("end_date", ""))
        raw_type = str(raw.get("type", ""))
        type_code_map = {
            "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "6": 6,
            "7": 5, "10": 99, "12": 100, "14": 100, "15": 100, "17": 3,
        }
        type_label_map = {
            "0": "Scrimmage", "1": "League Meet", "2": "Qualifier",
            "3": "League Tournament", "4": "Championship",
            "6": "FIRST Championship", "7": "Super Qualifier",
            "10": "Off-Season", "12": "Kickoff", "14": "Practice Day",
            "15": "Volunteer Event", "17": "Premier",
        }
        month = int(start[5:7]) if start and len(start) >= 7 else None
        state_prov = raw.get("stateprov", "")
        return {
            "key": event_key,
            "event_code": raw.get("code", ""),
            "name": row.get("name", ""),
            "short_name": row.get("name", ""),
            "event_type": type_code_map.get(raw_type, 2),
            "event_type_string": type_label_map.get(raw_type, "Qualifier"),
            "city": raw.get("city", ""),
            "state_prov": state_prov,
            "country": raw.get("country", ""),
            "start_date": start,
            "end_date": end,
            "year": int(event_key[:4]) if event_key[:4].isdigit() else None,
            "week": None,
            "month": month,
            "district": None,
            "division_code": raw.get("divisionCode"),
            "region_code": raw.get("regionCode", ""),
            "league_code": raw.get("leagueCode", ""),
            "region": raw.get("regionCode", "") or state_prov or raw.get("country", ""),
            "status": raw.get("status") or _event_status(start, end),
            "avatar": None,
            "program": "FTC",
            "webcasts": [],
        }

    # ── Fallback: FTC Events API ────────────────────────────
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()
    ev = await client.get_event(year, event_code)
    if not ev:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"FTC event '{event_key}' not found.")
    info = _normalise_event(ev, year)
    info["webcasts"] = []
    return info


async def get_event_teams_with_stats(event_key: str) -> list[dict]:
    """Return teams at an FTC event with rankings + FTC Scout OPR/QuickStats.

    Reads from Supabase first (populated by ftc_event_sync + ftc_match_poller
    workers); falls back to FTC Events API + FTC Scout on a cold miss.
    """
    # ── Try Supabase first ──────────────────────────────────
    try:
        sb_rows = await read_event_teams_full(event_key)
    except Exception as e:
        log.warning("Supabase FTC event_teams read failed for %s: %s", event_key, e)
        sb_rows = []

    if sb_rows and _sb_ftc_teams_valid(sb_rows):
        results: list[dict] = []
        for r in sb_rows:
            tk = r["team_key"]
            raw = r.get("raw_data") or {}
            if isinstance(raw, str):
                raw = json.loads(raw)
            if not isinstance(raw, dict):
                raw = {}
            tims = r.get("tims_data") or {}
            if isinstance(tims, str):
                tims = json.loads(tims)
            if not isinstance(tims, dict):
                tims = {}

            opr_val = raw.get("opr_total")
            sort_orders = raw.get("sort_orders") or []
            # Fall back to FTC Scout's rp when the FTC Events API returns no
            # sortOrders (e.g. Turkish/regional events where sortOrders is []).
            rp_val = sort_orders[0] if sort_orders else raw.get("rp")
            wins = raw.get("wins", 0) or 0
            losses = raw.get("losses", 0) or 0
            ties = raw.get("ties", 0) or 0
            mp = raw.get("matches_played", 0) or 0

            results.append({
                "team_number": r.get("team_number", 0),
                "team_key": tk,
                "nickname": r.get("nickname", ""),
                "name": tims.get("full_name") or r.get("nickname", ""),
                "city": tims.get("city", ""),
                "state_prov": tims.get("state_prov", ""),
                "country": tims.get("country", ""),
                "rookie_year": tims.get("rookie_year"),
                "school_name": tims.get("school_name", ""),
                "avatar": None,
                "rank": raw.get("rank"),
                "wins": wins,
                "losses": losses,
                "ties": ties,
                "record": {"wins": wins, "losses": losses, "ties": ties},
                "qual_average": raw.get("qual_average"),
                "matches_played": mp,
                "sort_orders": sort_orders,
                "ranking_points": rp_val,
                "rp": rp_val,
                "tb": sort_orders[1] if len(sort_orders) > 1 else None,
                # OPR / averages / max / min / dev — stored verbatim by worker
                "opr": round(opr_val, 2) if opr_val is not None else 0,
                "opr_auto": raw.get("opr_auto"),
                "opr_dc": raw.get("opr_dc"),
                "opr_np": raw.get("opr_np"),
                "avg_total": raw.get("avg_total"),
                "avg_auto": raw.get("avg_auto"),
                "avg_dc": raw.get("avg_dc"),
                "avg_np": raw.get("avg_np"),
                "max_total": raw.get("max_total"),
                "max_auto": raw.get("max_auto"),
                "max_dc": raw.get("max_dc"),
                "min_total": raw.get("min_total"),
                "dev_total": raw.get("dev_total"),
                "quick_stats": raw.get("quick_stats"),
                "epa": None,
                "program": "FTC",
            })

        results.sort(key=lambda t: (t["rank"] or 9999, t["team_number"]))
        return results

    # ── Fallback: FTC Events API + FTC Scout ────────────────
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()
    scout = get_ftcscout_client()

    teams_task = client.get_event_teams(year, event_code)
    rankings_task = client.get_rankings(year, event_code)
    scout_task = scout.get_event_team_stats(year, event_code)

    raw_teams, raw_rankings, scout_stats = await asyncio.gather(
        teams_task, rankings_task, scout_task, return_exceptions=True
    )

    # Note: FTC Events API returns 501 for /avatars — skip batch avatar fetching.
    if isinstance(raw_teams, Exception):
        log.warning("FTC teams fetch failed for %s: %s", event_key, raw_teams)
        raw_teams = []
    if isinstance(raw_rankings, Exception):
        log.warning("FTC rankings fetch failed for %s: %s", event_key, raw_rankings)
        raw_rankings = []
    if isinstance(scout_stats, Exception):
        log.warning("FTC Scout stats fetch failed for %s: %r", event_key, scout_stats)
        scout_stats = []

    # Build ranking lookup
    rank_map: dict[int, dict] = {}
    for r in raw_rankings:
        num = r.get("teamNumber", 0)
        if num:
            rank_map[num] = r

    # Build FTC Scout lookup
    scout_map: dict[int, dict] = {}
    for s in scout_stats:
        num = s.get("team_number", 0)
        if num:
            scout_map[num] = s

    api_results: list[dict] = []
    for t in raw_teams:
        num = t.get("teamNumber", 0)
        ranking = rank_map.get(num, {})
        sdata = scout_map.get(num, {})

        wins = ranking.get("wins", 0)
        losses = ranking.get("losses", 0)
        ties = ranking.get("ties", 0)
        opr_val = sdata.get("opr_total")
        sort_orders = ranking.get("sortOrders", [])
        rp_val = sort_orders[0] if sort_orders else None

        api_results.append({
            "team_number": num,
            "team_key": f"ftc{num}",
            "nickname": t.get("nameShort") or t.get("nameFull") or f"Team {num}",
            "name": t.get("nameFull") or t.get("nameShort") or "",
            "city": t.get("city", ""),
            "state_prov": t.get("stateProv", ""),
            "country": t.get("country", ""),
            "rookie_year": t.get("rookieYear"),
            "school_name": t.get("schoolName", ""),
            "avatar": None,
            "rank": ranking.get("rank"),
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "record": {"wins": wins, "losses": losses, "ties": ties},
            "qual_average": ranking.get("qualAverage"),
            "matches_played": ranking.get("matchesPlayed", 0),
            "sort_orders": sort_orders,
            "ranking_points": rp_val,
            "rp": rp_val,
            "tb": sort_orders[1] if len(sort_orders) > 1 else None,
            # OPR from FTC Scout
            "opr": round(opr_val, 2) if opr_val is not None else 0,
            "opr_auto": sdata.get("opr_auto"),
            "opr_dc": sdata.get("opr_dc"),
            "opr_np": sdata.get("opr_np"),
            # Averages from FTC Scout
            "avg_total": sdata.get("avg_total"),
            "avg_auto": sdata.get("avg_auto"),
            "avg_dc": sdata.get("avg_dc"),
            "avg_np": sdata.get("avg_np"),
            # Max / min / std dev
            "max_total": sdata.get("max_total"),
            "max_auto": sdata.get("max_auto"),
            "max_dc": sdata.get("max_dc"),
            "min_total": sdata.get("min_total"),
            "dev_total": sdata.get("dev_total"),
            # QuickStats (global OPR-like ranking across all FTC teams)
            "quick_stats": sdata.get("quick_stats"),
            "epa": None,
            "program": "FTC",
        })

    api_results.sort(key=lambda t: (t["rank"] or 9999, t["team_number"]))
    return api_results


async def get_fast_rankings(event_key: str) -> list[dict]:
    """Lightweight rankings from FTC Events API."""
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()
    rankings = await client.get_rankings(year, event_code)

    return [
        {
            "team_key": f"ftc{r.get('teamNumber')}",
            "team_number": r.get("teamNumber"),
            "rank": r.get("rank"),
            "wins": r.get("wins", 0),
            "losses": r.get("losses", 0),
            "ties": r.get("ties", 0),
            "qual_average": r.get("qualAverage"),
            "matches_played": r.get("matchesPlayed", 0),
            "ranking_points": r.get("sortOrders", [None])[0] if r.get("sortOrders") else None,
            "rp": r.get("sortOrders", [None])[0] if r.get("sortOrders") else None,
        }
        for r in rankings
    ]


async def get_all_matches(event_key: str) -> dict:
    """Return all matches (qual + playoff) with enriched team data for PbP.

    Returns dict with {event_key, matches, event_high_score} matching FRC format.

    Reads team identity, rankings, and OPR from Supabase first.  Reads the
    match schedule from Supabase when the poller has stored it, otherwise
    falls back to the FTC Events API.  All six parallel API calls are reduced
    to zero when both datasets are already in Supabase.
    """
    year, event_code = _parse_ftc_key(event_key)

    # ── Supabase-first: load team data ──────────────────────
    sb_team_rows: list[dict] = []
    try:
        sb_team_rows = await read_event_teams_full(event_key)
    except Exception:
        pass

    team_info: dict[int, dict] = {}
    rank_map_sb: dict[int, dict] = {}
    scout_map_sb: dict[int, dict] = {}

    if sb_team_rows and _sb_ftc_teams_valid(sb_team_rows):
        for r in sb_team_rows:
            num = r.get("team_number", 0)
            if not num:
                continue
            raw = r.get("raw_data") or {}
            if isinstance(raw, str):
                raw = json.loads(raw)
            if not isinstance(raw, dict):
                raw = {}
            tims = r.get("tims_data") or {}
            if isinstance(tims, str):
                tims = json.loads(tims)
            if not isinstance(tims, dict):
                tims = {}

            team_info[num] = {
                "team_number": num,
                "nickname": r.get("nickname", f"Team {num}"),
                "school_name": tims.get("school_name", ""),
                "city": tims.get("city", ""),
                "state_prov": tims.get("state_prov", ""),
                "country": tims.get("country", ""),
                "rookie_year": tims.get("rookie_year"),
            }
            rank_map_sb[num] = raw   # raw_data holds both rankings + OPR
            scout_map_sb[num] = raw  # same row — workers merged into one JSONB

    # ── Supabase-first: load match schedule ─────────────────
    sb_matches: list[dict] = []
    try:
        sb_matches = await read_matches(event_key)
    except Exception:
        pass

    # Determine alliances from Supabase events.raw_data (stored by _sync_ftc_alliances)
    alliance_lookup: dict[int, int] = {}
    try:
        ev_row = await read_event(event_key)
        if ev_row:
            ev_raw = ev_row.get("raw_data") or {}
            if isinstance(ev_raw, str):
                ev_raw = json.loads(ev_raw)
            for a in ev_raw.get("alliances") or []:
                anum = a.get("number", 0)
                for tnum in a.get("pick_numbers") or []:
                    if tnum:
                        alliance_lookup[tnum] = anum
    except Exception:
        pass

    # ── Build source: Supabase matches + Supabase teams ─────
    qual_raw: list[dict] = []
    playoff_raw: list[dict] = []
    raw_alliances: list[dict] = []
    raw_teams: list[dict] = []
    raw_rankings: list[dict] = []
    scout_stats: list[dict] = []

    use_sb_matches = bool(sb_matches)
    use_sb_teams = bool(team_info)

    if use_sb_matches:
        for m in sb_matches:
            # raw_data is the original FTC API hybrid schedule object
            rd = m.get("raw_data") or {}
            if isinstance(rd, str):
                rd = json.loads(rd)
            if not isinstance(rd, dict):
                continue
            cl = m.get("comp_level", "qm")
            # Skip practice/scrimmage matches stored before this filter was added
            if cl not in ("qm", "sf", "f"):
                continue
            if cl == "qm":
                qual_raw.append(rd)
            else:
                playoff_raw.append(rd)

    if not use_sb_matches or not use_sb_teams:
        # Need to go to FTC API — fetch what's missing
        client = get_ftc_client()
        scout = get_ftcscout_client()

        fetch_tasks = []
        task_labels: list[str] = []
        if not use_sb_matches:
            fetch_tasks += [
                client.get_schedule_hybrid(year, event_code, "qual"),
                client.get_schedule_hybrid(year, event_code, "playoff"),
            ]
            task_labels += ["qual", "playoff"]
        if not use_sb_teams:
            fetch_tasks += [
                client.get_event_teams(year, event_code),
                client.get_rankings(year, event_code),
                scout.get_event_team_stats(year, event_code),
                client.get_alliances(year, event_code),
            ]
            task_labels += ["teams", "rankings", "scout", "alliances"]

        results_api = await asyncio.gather(*fetch_tasks, return_exceptions=True)
        api_map = dict(zip(task_labels, results_api))

        if not use_sb_matches:
            q = api_map.get("qual", [])
            p = api_map.get("playoff", [])
            qual_raw = [] if isinstance(q, Exception) else q
            playoff_raw = [] if isinstance(p, Exception) else p

        if not use_sb_teams:
            raw_teams = api_map.get("teams") or []
            raw_rankings = api_map.get("rankings") or []
            scout_stats = api_map.get("scout") or []
            raw_alliances = api_map.get("alliances") or []
            if isinstance(raw_teams, Exception):
                raw_teams = []
            if isinstance(raw_rankings, Exception):
                raw_rankings = []
            if isinstance(scout_stats, Exception):
                scout_stats = []
            if isinstance(raw_alliances, Exception):
                raw_alliances = []

            for t in raw_teams:
                num = t.get("teamNumber", 0)
                if num:
                    team_info[num] = {
                        "team_number": num,
                        "nickname": t.get("nameShort") or t.get("nameFull") or f"Team {num}",
                        "school_name": t.get("schoolName", ""),
                        "city": t.get("city", ""),
                        "state_prov": t.get("stateProv", ""),
                        "country": t.get("country", ""),
                        "rookie_year": t.get("rookieYear"),
                    }

            for r in raw_rankings:
                num = r.get("teamNumber", 0)
                if num:
                    rank_map_sb[num] = r  # reuse same dict; callers use consistent keys below

            for s in scout_stats:
                num = s.get("team_number", 0)
                if num:
                    scout_map_sb[num] = s

            # Rebuild alliance lookup from API alliances
            for a in raw_alliances:
                anum = a.get("number", 0)
                for role in ("captain", "round1", "round2", "round3", "backup"):
                    slot = a.get(role)
                    if isinstance(slot, dict):
                        tnum = slot.get("teamNumber", 0)
                    elif isinstance(slot, (int, float)):
                        tnum = int(slot)
                    else:
                        continue
                    if tnum:
                        alliance_lookup[tnum] = anum

    def _rk_get(rk: dict, key_sb: str, key_api: str, default=None):
        """Read from Supabase raw_data keys first, fall back to API keys."""
        v = rk.get(key_sb)
        if v is None:
            v = rk.get(key_api, default)
        return v

    def build_team(team_number: int) -> dict:
        """Build a rich team object matching the FRC PbP format."""
        info = team_info.get(team_number, {})
        rk = rank_map_sb.get(team_number, {})
        sd = scout_map_sb.get(team_number, {})
        wins = rk.get("wins", 0) or 0
        losses = rk.get("losses", 0) or 0
        ties = rk.get("ties", 0) or 0
        opr_val = rk.get("opr_total") or sd.get("opr_total")
        # sort_orders: Supabase stores as "sort_orders", API returns "sortOrders"
        sort_orders = rk.get("sort_orders") or rk.get("sortOrders") or []
        # qual_average: Supabase stores as "qual_average", API returns "qualAverage"
        qual_avg = rk.get("qual_average") or rk.get("qualAverage") or 0
        mp = rk.get("matches_played") or rk.get("matchesPlayed") or 0
        rp_val = sort_orders[0] if sort_orders else None
        avg_rp = round(rp_val / mp, 2) if rp_val is not None and mp > 0 else 0
        return {
            "team_key": f"ftc{team_number}",
            "team_number": team_number,
            "nickname": info.get("nickname", f"Team {team_number}"),
            "school_name": info.get("school_name", ""),
            "city": info.get("city", ""),
            "state_prov": info.get("state_prov", ""),
            "country": info.get("country", ""),
            "rookie_year": info.get("rookie_year"),
            "avatar": None,
            "rank": rk.get("rank", "-"),
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "opr": round(opr_val, 2) if opr_val is not None else 0,
            "opr_auto": rk.get("opr_auto") or sd.get("opr_auto"),
            "opr_dc": rk.get("opr_dc") or sd.get("opr_dc"),
            "opr_np": rk.get("opr_np") or sd.get("opr_np"),
            "epa": None,
            "avg_rp": avg_rp,
            "qual_average": qual_avg,
            "high_score": 0,
            "high_score_match": "",
            "avg_total": rk.get("avg_total") or sd.get("avg_total"),
            "avg_auto": rk.get("avg_auto") or sd.get("avg_auto"),
            "avg_dc": rk.get("avg_dc") or sd.get("avg_dc"),
            "avg_np": rk.get("avg_np") or sd.get("avg_np"),
            "max_total": rk.get("max_total") or sd.get("max_total"),
            "max_auto": rk.get("max_auto") or sd.get("max_auto"),
            "max_dc": rk.get("max_dc") or sd.get("max_dc"),
            "min_total": rk.get("min_total") or sd.get("min_total"),
            "dev_total": rk.get("dev_total") or sd.get("dev_total"),
        }

    # ── Build match list ──
    all_raw = [(m, "qual") for m in qual_raw] + [(m, "playoff") for m in playoff_raw]

    # Event high score tracking
    event_high = {"score": 0, "match": "", "teams": []}

    result: list[dict] = []
    for raw_match, level in all_raw:
        match_num = raw_match.get("matchNumber", 0)
        teams_in_match = raw_match.get("teams", [])

        red_raw = [t for t in teams_in_match if (t.get("station") or "").startswith("Red")]
        blue_raw = [t for t in teams_in_match if (t.get("station") or "").startswith("Blue")]

        red_nums = [t.get("teamNumber", 0) for t in red_raw]
        blue_nums = [t.get("teamNumber", 0) for t in blue_raw]

        red_teams = [build_team(n) for n in red_nums if n]
        blue_teams = [build_team(n) for n in blue_nums if n]

        red_score = raw_match.get("scoreRedFinal")
        blue_score = raw_match.get("scoreBlueFinal")

        winning = ""
        if red_score is not None and blue_score is not None:
            if red_score > blue_score:
                winning = "red"
            elif blue_score > red_score:
                winning = "blue"

        if level == "qual":
            comp_level = "qm"
            match_key = f"{year}ftc{event_code}_qm{match_num}"
            label = f"Qualification {match_num}"
            sort_key = (0, match_num, 0)
        else:
            series = raw_match.get("series") or 0
            # Some championship events (e.g. trcmp) return series=0; fall back to
            # match_number so each match gets a unique key and its own bracket slot.
            if series == 0:
                series = match_num
            desc = raw_match.get("description", "")
            # Parse bracket label from FTC API description
            # e.g. "Upper Bracket  Round 1 Match 1", "Lower Bracket  Round 2 Match 3",
            #      "Final Bracket  Round 4 Match 6"
            comp_level, label, sort_key = _parse_ftc_bracket_label(desc, series, match_num)
            match_key = f"{year}ftc{event_code}_{comp_level}{series}m{match_num}"

        rs = red_score if red_score is not None else -1
        bs = blue_score if blue_score is not None else -1

        # Track event high score
        for score_val, tnums in [(rs, red_nums), (bs, blue_nums)]:
            if score_val > event_high["score"]:
                event_high = {"score": score_val, "match": label, "teams": tnums}

        # Check if breakdown might be available (scored match)
        has_breakdown = rs >= 0 and bs >= 0

        result.append({
            "key": match_key,
            "comp_level": comp_level,
            "match_number": match_num,
            "set_number": raw_match.get("series", 1),
            "label": label,
            "sort_key": sort_key,
            "time": raw_match.get("actualStartTime") or raw_match.get("startTime"),
            "has_breakdown": has_breakdown,
            "red": {
                "teams": red_teams,
                "score": rs,
                "total_opr": round(sum(t["opr"] for t in red_teams), 2),
                "alliance_number": alliance_lookup.get(red_nums[0]) if (comp_level != "qm" and red_nums) else None,
            },
            "blue": {
                "teams": blue_teams,
                "score": bs,
                "total_opr": round(sum(t["opr"] for t in blue_teams), 2),
                "alliance_number": alliance_lookup.get(blue_nums[0]) if (comp_level != "qm" and blue_nums) else None,
            },
            "winning_alliance": winning,
            "pred": None,
            "program": "FTC",
        })

    result.sort(key=lambda x: x["sort_key"])
    return {
        "event_key": event_key,
        "matches": result,
        "event_high_score": event_high if event_high["score"] > 0 else None,
    }


async def get_playoff_matches(event_key: str) -> dict:
    """Return only playoff matches in {event_key, matches} format."""
    # Reuse the full enrichment pipeline
    data = await get_all_matches(event_key)
    playoff = [m for m in data["matches"] if m["comp_level"] != "qm"]
    return {"event_key": event_key, "matches": playoff}


async def get_match_scores(event_key: str) -> dict:
    """Quick score fetch for live updates.

    Returns dict with {event_key, scores} like the FRC format.
    """
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()

    qual_task = client.get_matches(year, event_code, level="qual")
    playoff_task = client.get_matches(year, event_code, level="playoff")

    qual, playoff = await asyncio.gather(
        qual_task, playoff_task, return_exceptions=True
    )

    results: list[dict] = []
    for batch, level in [(qual, "qual"), (playoff, "playoff")]:
        if isinstance(batch, Exception):
            continue
        for m in batch:
            match_num = m.get("matchNumber", 0)
            red_score = m.get("scoreRedFinal")
            blue_score = m.get("scoreBlueFinal")
            if red_score is None and blue_score is None:
                continue
            winning = ""
            if red_score is not None and blue_score is not None:
                if red_score > blue_score:
                    winning = "red"
                elif blue_score > red_score:
                    winning = "blue"
            results.append({
                "key": f"{year}ftc{event_code}_{level[0]}m{match_num}",
                "comp_level": level,
                "match_number": match_num,
                "red_score": red_score or 0,
                "blue_score": blue_score or 0,
                "winning_alliance": winning,
            })
    return {"event_key": event_key, "scores": results}


async def get_alliances(event_key: str) -> list[dict]:
    """Return alliance selections for an FTC event.

    Reads from Supabase first (alliances stored in events.raw_data by
    ftc_event_sync worker); falls back to the FTC Events API.
    """
    year, event_code = _parse_ftc_key(event_key)

    def _normalise_alliances(raw: list[dict]) -> list[dict]:
        """Convert raw FTC API alliances to the frontend format."""
        def _team_num(slot):
            if isinstance(slot, dict):
                return slot.get("teamNumber", 0)
            if isinstance(slot, (int, float)):
                return int(slot)
            return 0

        results: list[dict] = []
        for i, a in enumerate(raw, 1):
            captain = a.get("captain")
            round1 = a.get("round1")
            round2 = a.get("round2")
            round3 = a.get("round3")
            pick_nums = [
                _team_num(p) for p in [captain, round1, round2, round3]
                if p is not None
            ]
            pick_nums = [n for n in pick_nums if n]
            results.append({
                "number": a.get("number", i),
                "picks": [f"ftc{n}" for n in pick_nums],
                "pick_numbers": pick_nums,
                "name": a.get("name", f"Alliance {i}"),
            })
        return results

    # ── Try Supabase first ──────────────────────────────────
    try:
        ev_row = await read_event(event_key)
        if ev_row:
            ev_raw = ev_row.get("raw_data") or {}
            if isinstance(ev_raw, str):
                ev_raw = json.loads(ev_raw)
            stored = ev_raw.get("alliances")
            if stored:
                return _normalise_alliances(stored)
    except Exception as e:
        log.debug("Supabase alliances read failed for %s: %s", event_key, e)

    # ── Fallback: FTC Events API ────────────────────────────
    client = get_ftc_client()
    raw = await client.get_alliances(year, event_code)
    return _normalise_alliances(raw)


async def get_event_awards(event_key: str) -> list[dict]:
    """Return awards for an FTC event."""
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()
    raw = await client.get_event_awards(year, event_code)
    return [
        {
            "name": a.get("name", ""),
            "award_type": a.get("awardId"),
            "team_number": a.get("teamNumber"),
            "person": a.get("person"),
            "event_key": event_key,
        }
        for a in raw
    ]


# ── FTC Past Season Awards ─────────────────────────────────
# Award IDs that matter for summary
_FTC_INSPIRE_ID = 11
_FTC_WINNER_ID = 13
_FTC_FINALIST_ID = 12
_FTC_INTERESTING_AWARD_IDS = {_FTC_INSPIRE_ID, _FTC_WINNER_ID, _FTC_FINALIST_ID}

# Human-readable award types for frontend filtering
_FTC_AWARD_TYPE_MAP = {
    _FTC_INSPIRE_ID: "inspire",
    _FTC_WINNER_ID: "winner",
    _FTC_FINALIST_ID: "finalist",
}


async def get_ftc_past_season_awards(event_key: str) -> dict:
    """Fetch previous-season Inspire / Winner / Finalist awards for all teams at an FTC event.

    Returns {"past_season_awards": [{ team_number, nickname, awards: [{name, event_name, type}] }]}
    """
    sb_key = f"ftc_{event_key}"

    # 1) Disk cache (30 min TTL — past season data is stable)
    cached = read_payload("ftc_past_awards", event_key, ttl=1800)
    if cached:
        cached.pop("_ts", None)
        return cached

    # 2) Supabase cache
    sb_row = await get_cached_summary(sb_key)
    if sb_row and sb_row.get("awards"):
        write_payload("ftc_past_awards", event_key, sb_row["awards"])
        return sb_row["awards"]

    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()
    prev_season = year - 1

    # Get teams at this event
    raw_teams = await client.get_event_teams(year, event_code)
    if not raw_teams:
        return {"past_season_awards": []}

    team_nums = [t.get("teamNumber", 0) for t in raw_teams if t.get("teamNumber")]
    team_names = {
        t.get("teamNumber"): t.get("nameShort") or t.get("nameFull") or f"Team {t.get('teamNumber')}"
        for t in raw_teams if t.get("teamNumber")
    }

    # Fetch previous season awards for each team (parallel, with semaphore)
    sem = asyncio.Semaphore(10)

    async def _fetch(num: int):
        async with sem:
            try:
                return num, await client.get_team_awards(prev_season, num)
            except Exception:
                return num, []

    results = await asyncio.gather(*[_fetch(n) for n in team_nums])

    # Build event code → event name lookup so chips show readable names.
    # Collect all unique event codes first, then batch-resolve.
    all_event_codes: set[str] = set()
    for _, awards in results:
        for a in awards:
            ec = a.get("eventCode")
            if ec:
                all_event_codes.add(ec)

    # Resolve event codes → names from the season event list (cached by the client)
    event_name_map: dict[str, str] = {}
    scrimmage_codes: set[str] = set()
    NON_COMP_TYPES = {"0", "12", "14", "15"}  # Scrimmage, Kickoff, PracticeDay, Volunteer
    if all_event_codes:
        try:
            season_events = await client.get_events(prev_season)
            for ev in season_events:
                ec = ev.get("code", "")
                if ec in all_event_codes:
                    event_name_map[ec] = ev.get("name", ec)
                    if str(ev.get("type", "")) in NON_COMP_TYPES:
                        scrimmage_codes.add(ec)
        except Exception:
            pass  # Fallback: event code shown as-is

    # Build summary
    past_awards: list[dict] = []
    for num, awards in results:
        if not awards:
            continue
        interesting = [
            a for a in awards
            if a.get("awardId") in _FTC_INTERESTING_AWARD_IDS
            and a.get("eventCode", "") not in scrimmage_codes
        ]
        if not interesting:
            continue
        team_entry = {
            "team_number": num,
            "nickname": team_names.get(num, f"Team {num}"),
            "awards": [],
        }
        for a in interesting:
            award_type = _FTC_AWARD_TYPE_MAP.get(a.get("awardId"), "other")
            ec = a.get("eventCode", "")
            team_entry["awards"].append({
                "name": a.get("name", ""),
                "event_name": event_name_map.get(ec, ec),
                "type": award_type,
            })
        past_awards.append(team_entry)

    # Sort: inspire first, then winners, then finalists
    def _sort_key(t):
        types = set(a["type"] for a in t["awards"])
        if "inspire" in types:
            return 0
        if "winner" in types:
            return 1
        return 2
    past_awards.sort(key=_sort_key)

    result = {"past_season_awards": past_awards, "prev_season": prev_season}
    write_payload("ftc_past_awards", event_key, dict(result))
    if past_awards:
        await set_cached_summary(sb_key, awards=result)
    return result


# ── FTC Current Season Awards (big 3 at prior events) ─────

async def get_ftc_current_season_awards(event_key: str) -> dict:
    """Fetch current-season Inspire / Winner / Finalist awards for teams at this event,
    earned at *other* events earlier this season.

    Returns {"season_awards": [{ team_number, nickname, awards: [{name, event_name, type}] }], "season": int}
    """
    sb_key = f"ftc_{event_key}"

    # 1) Disk cache (10 min TTL)
    cached = read_payload("ftc_season_awards", event_key, ttl=600)
    if cached:
        cached.pop("_ts", None)
        return cached

    # 2) Supabase cache
    sb_row = await get_cached_summary(sb_key)
    if sb_row and sb_row.get("summary"):
        write_payload("ftc_season_awards", event_key, sb_row["summary"])
        return sb_row["summary"]

    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()

    # Get teams at this event
    raw_teams = await client.get_event_teams(year, event_code)
    if not raw_teams:
        return {"season_awards": [], "season": year}

    team_nums = [t.get("teamNumber", 0) for t in raw_teams if t.get("teamNumber")]
    team_names = {
        t.get("teamNumber"): t.get("nameShort") or t.get("nameFull") or f"Team {t.get('teamNumber')}"
        for t in raw_teams if t.get("teamNumber")
    }

    # Fetch current season awards for each team (parallel, with semaphore)
    sem = asyncio.Semaphore(10)

    async def _fetch(num: int):
        async with sem:
            try:
                return num, await client.get_team_awards(year, num)
            except Exception:
                return num, []

    results = await asyncio.gather(*[_fetch(n) for n in team_nums])

    # Collect event codes for name resolution (exclude current event)
    all_event_codes: set[str] = set()
    for _, awards in results:
        for a in awards:
            ec = a.get("eventCode", "")
            if ec and ec.upper() != event_code.upper():
                all_event_codes.add(ec)

    # Resolve event codes → names
    event_name_map: dict[str, str] = {}
    scrimmage_codes: set[str] = set()
    NON_COMP_TYPES = {"0", "12", "14", "15"}  # Scrimmage, Kickoff, PracticeDay, Volunteer
    if all_event_codes:
        try:
            season_events = await client.get_events(year)
            for ev in season_events:
                ec = ev.get("code", "")
                if ec in all_event_codes:
                    event_name_map[ec] = ev.get("name", ec)
                    if str(ev.get("type", "")) in NON_COMP_TYPES:
                        scrimmage_codes.add(ec)
        except Exception:
            pass

    # Build summary — only big 3 from OTHER events (exclude scrimmages)
    season_awards: list[dict] = []
    for num, awards in results:
        if not awards:
            continue
        interesting = [
            a for a in awards
            if a.get("awardId") in _FTC_INTERESTING_AWARD_IDS
            and (a.get("eventCode", "").upper() != event_code.upper())
            and a.get("eventCode", "") not in scrimmage_codes
        ]
        if not interesting:
            continue
        team_entry = {
            "team_number": num,
            "nickname": team_names.get(num, f"Team {num}"),
            "awards": [],
        }
        for a in interesting:
            award_type = _FTC_AWARD_TYPE_MAP.get(a.get("awardId"), "other")
            ec = a.get("eventCode", "")
            team_entry["awards"].append({
                "name": a.get("name", ""),
                "event_name": event_name_map.get(ec, ec),
                "type": award_type,
            })
        season_awards.append(team_entry)

    # Sort: inspire first, then winners, then finalists
    def _sort_key(t):
        types = set(a["type"] for a in t["awards"])
        if "inspire" in types:
            return 0
        if "winner" in types:
            return 1
        return 2
    season_awards.sort(key=_sort_key)

    result = {"season_awards": season_awards, "season": year}
    write_payload("ftc_season_awards", event_key, dict(result))
    if season_awards:
        await set_cached_summary(sb_key, summary=result)
    return result


# ── FTC Team Awards Summary (for PbP) ─────────────────────

_FTC_AWARD_NAME_MAP: dict[int, str] = {
    11: "Inspire Award",
    13: "Winning Alliance",
    12: "Finalist Alliance",
    1:  "Think Award",
    2:  "Connect Award",
    3:  "Innovate Award",
    4:  "Design Award",
    5:  "Motivate Award",
    6:  "Control Award",
    7:  "Promote Award",
    9:  "Compass Award",
    10: "Judges' Award",
}

# "Blue banner" equivalent for FTC: Inspire + Winner
_FTC_BLUE_BANNER_IDS = {_FTC_INSPIRE_ID, _FTC_WINNER_ID}


async def get_ftc_team_awards_summary(team_numbers: list[int]) -> dict:
    """Return recent FTC awards for a batch of teams (last 3 seasons).

    Mirrors the FRC `get_awards_summary` shape so the frontend renderer
    can handle both uniformly.  Returns dict keyed by team number:
    {
      team_number: {
        team_number, blue_banner_count, blue_banners: [...],
        recent_awards: [{ name, year, event_key, event_name, is_blue_banner }]
      }
    }
    """
    client = get_ftc_client()
    current_year = date.today().year
    recent_cutoff = current_year - 3
    seasons = [y for y in range(current_year, recent_cutoff - 1, -1)]

    # Batch-resolve event names for each season we query
    _event_name_cache: dict[tuple[int, str], str] = {}

    async def _resolve_event_names(season: int, codes: set[str]):
        if not codes:
            return
        # Only fetch if we have unknown codes for this season
        unknown = {c for c in codes if (season, c) not in _event_name_cache}
        if not unknown:
            return
        try:
            events = await client.get_events(season)
            for ev in events:
                ec = ev.get("code", "")
                if ec:
                    _event_name_cache[(season, ec)] = ev.get("name", ec)
        except Exception:
            pass

    sem = asyncio.Semaphore(10)

    async def _fetch_team(num: int) -> dict:
        blue_banners: list[dict] = []
        recent_awards: list[dict] = []
        all_event_codes: dict[int, set[str]] = {}

        for season in seasons:
            async with sem:
                try:
                    awards = await client.get_team_awards(season, num)
                except Exception:
                    continue

            for a in awards:
                award_id = a.get("awardId")
                ec = a.get("eventCode", "")
                if ec and season not in all_event_codes:
                    all_event_codes[season] = set()
                if ec:
                    all_event_codes[season].add(ec)

                is_banner = award_id in _FTC_BLUE_BANNER_IDS
                entry = {
                    "name": a.get("name") or _FTC_AWARD_NAME_MAP.get(award_id, f"Award #{award_id}"),
                    "year": season,
                    "event_key": ec,
                    "event_name": ec,  # placeholder — resolved below
                    "is_blue_banner": is_banner,
                }
                if is_banner:
                    blue_banners.append(entry)
                recent_awards.append(entry)

        # Resolve event names
        for season, codes in all_event_codes.items():
            await _resolve_event_names(season, codes)

        # Fill in resolved event names
        for a in recent_awards:
            resolved = _event_name_cache.get((a["year"], a["event_key"]))
            if resolved:
                a["event_name"] = resolved
        for a in blue_banners:
            resolved = _event_name_cache.get((a["year"], a["event_key"]))
            if resolved:
                a["event_name"] = resolved

        # Sort newest first
        recent_awards.sort(key=lambda a: a.get("year", 0), reverse=True)

        return {
            "team_number": num,
            "blue_banner_count": len(blue_banners),
            "blue_banners": blue_banners,
            "recent_awards": recent_awards,
        }

    results = await asyncio.gather(*[_fetch_team(n) for n in team_numbers])
    return {str(r["team_number"]): r for r in results}


async def get_score_breakdown(
    event_key: str, level: str, match_number: int,
) -> dict | None:
    """Return detailed score breakdown for a single FTC match.

    Normalises the raw FTC Events API scores into the same shape
    the frontend expects: {available, game_year, program, red, blue, winning_alliance}.
    """
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()
    scores = await client.get_scores(
        year, event_code, level, match_number=match_number,
    )
    if not scores:
        return None

    raw = scores[0] if len(scores) == 1 else scores[0]
    alliances = raw.get("alliances", [])
    if not alliances:
        return {"available": False}

    # Build per-alliance breakdown dicts
    red_bd = None
    blue_bd = None
    for a in alliances:
        side = (a.get("alliance") or "").lower()
        bd = _build_ftc_breakdown(a)
        if side == "red":
            red_bd = bd
        elif side == "blue":
            blue_bd = bd

    if not red_bd and not blue_bd:
        return {"available": False}

    red_score = red_bd["totalPoints"] if red_bd else 0
    blue_score = blue_bd["totalPoints"] if blue_bd else 0
    winning = ""
    if red_score > blue_score:
        winning = "red"
    elif blue_score > red_score:
        winning = "blue"

    return {
        "available": True,
        "game_year": year,
        "program": "FTC",
        "winning_alliance": winning,
        "red": {
            "score": red_score,
            "breakdown": red_bd or {},
        },
        "blue": {
            "score": blue_score,
            "breakdown": blue_bd or {},
        },
    }


def _build_ftc_breakdown(a: dict) -> dict:
    """Build a normalised FTC DECODE breakdown from raw alliance data."""
    # Classifier grid (9 slots)
    auto_grid = a.get("autoClassifierState", [])
    teleop_grid = a.get("teleopClassifierState", [])

    # Per-robot data
    robots = []
    for i in (1, 2):
        auto_left = a.get(f"robot{i}Auto", False)
        teleop_end = a.get(f"robot{i}Teleop", "NONE")
        end_map = {"NONE": "None", "FULL": "Full Ascent", "PARTIAL": "Partial Ascent"}
        robots.append({
            "robot_number": i,
            "auto_leave": auto_left,
            "endgame": end_map.get(teleop_end, teleop_end),
            "endgame_raw": teleop_end,
        })

    auto_points = a.get("autoPoints", 0)
    teleop_points = a.get("teleopPoints", 0)
    total_points = a.get("totalPoints", 0)
    foul_committed = a.get("foulPointsCommitted", 0)

    return {
        # Robots
        "robots": robots,
        # Auto
        "autoLeavePoints": a.get("autoLeavePoints", 0),
        "autoArtifactPoints": a.get("autoArtifactPoints", 0),
        "autoPatternPoints": a.get("autoPatternPoints", 0),
        "autoClassifiedArtifacts": a.get("autoClassifiedArtifacts", 0),
        "autoOverflowArtifacts": a.get("autoOverflowArtifacts", 0),
        "autoClassifierState": auto_grid,
        "autoPoints": auto_points,
        # Teleop / Driver-Controlled
        "teleopArtifactPoints": a.get("teleopArtifactPoints", 0),
        "teleopDepotPoints": a.get("teleopDepotPoints", 0),
        "teleopPatternPoints": a.get("teleopPatternPoints", 0),
        "teleopBasePoints": a.get("teleopBasePoints", 0),
        "teleopClassifiedArtifacts": a.get("teleopClassifiedArtifacts", 0),
        "teleopOverflowArtifacts": a.get("teleopOverflowArtifacts", 0),
        "teleopDepotArtifacts": a.get("teleopDepotArtifacts", 0),
        "teleopClassifierState": teleop_grid,
        "teleopPoints": teleop_points,
        # Fouls
        "foulPointsCommitted": foul_committed,
        "majorFouls": a.get("majorFouls", 0),
        "minorFouls": a.get("minorFouls", 0),
        # Ranking points
        "movementRP": a.get("movementRP", False),
        "goalRP": a.get("goalRP", False),
        "patternRP": a.get("patternRP", False),
        # Totals
        "totalPoints": total_points,
        "preFoulTotal": a.get("preFoulTotal", 0),
        # Randomization
        "randomization": a.get("randomization") or 0,
    }


def _normalise_match(m: dict, year: int, event_code: str, level: str) -> dict:
    """Convert an FTC hybrid schedule match to our frontend format."""
    match_num = m.get("matchNumber", 0)
    teams = m.get("teams", [])

    red_teams = [t for t in teams if (t.get("station") or "").startswith("Red")]
    blue_teams = [t for t in teams if (t.get("station") or "").startswith("Blue")]

    red_nums = [t.get("teamNumber", 0) for t in red_teams]
    blue_nums = [t.get("teamNumber", 0) for t in blue_teams]

    red_score = m.get("scoreRedFinal")
    blue_score = m.get("scoreBlueFinal")

    # Determine winner
    winning = ""
    if red_score is not None and blue_score is not None:
        if red_score > blue_score:
            winning = "red"
        elif blue_score > red_score:
            winning = "blue"

    comp_level = "qm" if level == "qual" else "sf"
    match_key = f"{year}ftc{event_code}_{comp_level}{match_num}"

    return {
        "key": match_key,
        "comp_level": comp_level,
        "set_number": m.get("series", 1),
        "match_number": match_num,
        "time": m.get("startTime"),
        "actual_time": m.get("actualStartTime"),
        "predicted_time": m.get("startTime"),
        "winning_alliance": winning,
        "red": {
            "score": red_score if red_score is not None else -1,
            "team_keys": [f"ftc{n}" for n in red_nums],
            "team_numbers": red_nums,
            "surrogate_team_keys": [
                f"ftc{t.get('teamNumber', 0)}" for t in red_teams
                if t.get("surrogate")
            ],
        },
        "blue": {
            "score": blue_score if blue_score is not None else -1,
            "team_keys": [f"ftc{n}" for n in blue_nums],
            "team_numbers": blue_nums,
            "surrogate_team_keys": [
                f"ftc{t.get('teamNumber', 0)}" for t in blue_teams
                if t.get("surrogate")
            ],
        },
        "program": "FTC",
    }


async def get_ftc_world_record(season: int | None = None) -> dict | None:
    """Return the FTC world record match from FTC Scout, with resolved event name."""
    scout = get_ftcscout_client()
    client = get_ftc_client()
    year = season or current_ftc_season()
    rec = await scout.get_world_record(year)
    if not rec:
        return None
    # Resolve event_code → human-readable event name
    ec = rec.get("event_code", "")
    if ec and rec.get("event_name") == ec:
        try:
            events = await client.get_events(year)
            for ev in events:
                if ev.get("code", "") == ec:
                    rec["event_name"] = ev.get("name", ec)
                    break
        except Exception:
            pass
    return rec


async def get_team_lookup(team_number: int, season: int, include_history: bool = False) -> dict:
    """Build a team lookup card from FTC Events API + FTC Scout."""
    client = get_ftc_client()
    scout = get_ftcscout_client()

    # Fetch team info, awards, FTC Scout quick stats, and events in parallel
    # Note: avatar skipped in gather — FTC API returns 501 for /avatars.
    info_task = client.get_team_info(season, team_number)
    awards_task = client.get_team_awards(season, team_number)
    scout_task = scout.get_team_quick_stats(team_number, season)
    events_task = client.get_team_events(season, team_number)

    info, awards, scout_data, events = await asyncio.gather(
        info_task, awards_task, scout_task, events_task,
        return_exceptions=True,
    )

    if isinstance(info, Exception) or not info:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"FTC team {team_number} not found.")
    if isinstance(awards, Exception):
        awards = []
    if isinstance(scout_data, Exception):
        scout_data = None
    if isinstance(events, Exception):
        events = []

    # Try avatar separately (bypasses circuit breaker since API returns 501)
    avatar = None
    try:
        avatar = await client.get_team_avatar(season, team_number)
    except Exception:
        pass

    loc = info.get("city", "")
    state = info.get("stateProv", "")
    country = info.get("country", "")
    location_str = ", ".join(filter(None, [loc, state, country]))

    qs = (scout_data or {}).get("quick_stats", {})
    tot = qs.get("tot", {})
    auto = qs.get("auto", {})
    dc = qs.get("dc", {})

    # Build events_this_season list
    events_this_season = _build_events_list(events, season)

    # Separate alliance selections from real awards (current season)
    _ALLIANCE_AWARD_IDS = {_FTC_WINNER_ID, _FTC_FINALIST_ID}
    # Build event code → name map from the team's events this season
    _event_name_map = {ev.get("code", ""): ev.get("name", "") for ev in events}
    current_real_awards = [
        {"name": a.get("name", ""),
         "event": _event_name_map.get(a.get("eventCode", ""), a.get("eventCode", "")),
         "award_id": a.get("awardId")}
        for a in awards if a.get("awardId") not in _ALLIANCE_AWARD_IDS
    ]
    current_alliance_picks = [
        {"name": a.get("name", ""),
         "event": _event_name_map.get(a.get("eventCode", ""), a.get("eventCode", "")),
         "award_id": a.get("awardId")}
        for a in awards if a.get("awardId") in _ALLIANCE_AWARD_IDS
    ]

    # Build per-event results for current season from awards + events
    current_event_results = _build_event_results(events, awards, season)

    result = {
        "team_number": team_number,
        "team_key": f"ftc{team_number}",
        "nickname": info.get("nameShort") or info.get("nameFull") or f"Team {team_number}",
        "name": info.get("nameFull", ""),
        "school_name": (scout_data or {}).get("school_name", "") or info.get("schoolName", ""),
        "city": loc,
        "state_prov": state,
        "country": country,
        "location": location_str,
        "rookie_year": info.get("rookieYear"),
        "website": info.get("website", ""),
        "season": season,
        "quick_stats": qs,
        "opr_global": round(tot.get("value", 0), 2) if tot.get("value") else None,
        "opr_auto_global": round(auto.get("value", 0), 2) if auto.get("value") else None,
        "opr_dc_global": round(dc.get("value", 0), 2) if dc.get("value") else None,
        "global_rank": tot.get("rank"),
        "total_teams": qs.get("count"),
        "awards": current_real_awards,
        "alliance_selections": current_alliance_picks,
        "event_results": current_event_results,
        "events_this_season": events_this_season,
        "season_achievements": None,
        "all_awards": None,
        "program": "FTC",
    }

    if include_history:
        rookie_year = info.get("rookieYear") or _FTC_FIRST_SEASON
        first_year = max(rookie_year, _FTC_FIRST_SEASON)
        history_seasons = list(range(first_year, season + 1))

        async def _fetch_season(y: int):
            if y == season:
                return y, events, awards
            evs = await client.get_team_events(y, team_number)
            aws = await client.get_team_awards(y, team_number)
            return y, evs, aws

        season_data = await asyncio.gather(
            *[_fetch_season(y) for y in history_seasons],
            return_exceptions=True,
        )

        all_awards_list: list[dict] = []
        all_event_results: list[dict] = []
        season_achievements: list[dict] = []

        for item in season_data:
            if isinstance(item, Exception):
                continue
            y, evs, aws = item
            if isinstance(evs, Exception):
                evs = []
            if isinstance(aws, Exception):
                aws = []

            # Resolve event code → name for this season using the team's event list
            _ev_name_map_y = {ev.get("code", ""): ev.get("name", "") for ev in evs}
            # Include ALL awards (real + alliance) — prestige badge counting needs alliance picks
            for a in aws:
                all_awards_list.append({
                    "name": a.get("name", ""),
                    "event": _ev_name_map_y.get(a.get("eventCode", ""), a.get("eventCode", "")),
                    "year": y,
                })

            # Build per-event results for this season
            all_event_results.extend(_build_event_results(evs, aws, y))

            achievement = _ftc_season_achievement(evs, aws, y)
            season_achievements.append(achievement)

        result["all_awards"] = all_awards_list
        # Promote full history into event_results so the iOS season history section
        # (which decodes event_results) shows all seasons, not just the current one.
        result["event_results"] = all_event_results
        result["all_event_results"] = all_event_results
        result["season_achievements"] = season_achievements

    return result


# ── FTC event type ranking for season achievements ──────────
_FTC_EVENT_TYPE_RANK = {
    6: (6, "FIRST Championship"),
    4: (5, "Championship"),
    7: (4, "Super Qualifier"),
    17: (3, "Premier"),
    3: (3, "League Tournament"),
    2: (2, "Qualifier"),
    1: (1, "League Meet"),
    0: (0, "Scrimmage"),
}


def _build_events_list(events: list[dict], season: int) -> list[dict]:
    """Convert raw FTC Events API event list to simplified dicts."""
    _type_label = {
        "0": "Scrimmage", "1": "League Meet", "2": "Qualifier",
        "3": "League Tournament", "4": "Championship", "6": "FIRST Championship",
        "7": "Super Qualifier", "10": "Off-Season", "17": "Premier",
    }
    result = []
    for ev in events:
        et = str(ev.get("type", ""))
        result.append({
            "event_code": ev.get("code", ""),
            "event_name": ev.get("name", ""),
            "event_type": _type_label.get(et, "Qualifier"),
            "city": ev.get("city", ""),
            "state_prov": ev.get("stateprov", ""),
            "start_date": ev.get("dateStart", ""),
            "end_date": ev.get("dateEnd", ""),
            "year": season,
        })
    return result


_EVENT_TYPE_LABEL = {
    "0": "Scrimmage", "1": "League Meet", "2": "Qualifier",
    "3": "League Tournament", "4": "Championship", "6": "FIRST Championship",
    "7": "Super Qualifier", "10": "Off-Season", "17": "Premier",
}


def _build_event_results(events: list[dict], awards: list[dict], year: int) -> list[dict]:
    """Build FRC-style event results rows from events + awards for a single season."""
    from datetime import datetime

    now = datetime.utcnow()

    # Group awards by event code
    awards_by_event: dict[str, list[dict]] = {}
    for a in awards:
        ec = a.get("eventCode", "")
        if ec:
            awards_by_event.setdefault(ec, []).append(a)

    results: list[dict] = []
    for ev in events:
        # Skip future events
        date_end = ev.get("dateEnd", "")
        if date_end:
            try:
                end_dt = datetime.fromisoformat(str(date_end).replace("Z", ""))
                if end_dt > now:
                    continue
            except (ValueError, TypeError):
                pass

        ec = ev.get("code", "")
        et = str(ev.get("type", ""))
        ev_awards = awards_by_event.get(ec, [])

        # Determine alliance selection and playoff result from awards
        alliance_str = None
        playoff_result = None
        real_awards_at_event: list[str] = []
        for a in ev_awards:
            aid = a.get("awardId")
            name = a.get("name", "")
            if aid == _FTC_WINNER_ID:
                playoff_result = "Winner"
                # Parse alliance info from award name, e.g. "Winning Alliance Captain"
                alliance_str = _parse_alliance_role(name, "Winner")
            elif aid == _FTC_FINALIST_ID:
                if playoff_result != "Winner":
                    playoff_result = "Finalist"
                alliance_str = alliance_str or _parse_alliance_role(name, "Finalist")
            else:
                real_awards_at_event.append(name)

        results.append({
            "event_name": ev.get("name", ec),
            "event_code": ec,
            "event_type": _EVENT_TYPE_LABEL.get(et, "Qualifier"),
            "year": year,
            "date_end": str(date_end) if date_end else "",
            "alliance": alliance_str,
            "playoff_result": playoff_result,
            "awards": real_awards_at_event,
        })
    return results


def _parse_alliance_role(award_name: str, prefix: str) -> str:
    """Parse an alliance role from award name like 'Winning Alliance - Captain'."""
    name = award_name.strip()
    # Remove the prefix ("Winning Alliance" or "Finalist Alliance")
    for p in [f"{prefix} Alliance", f"{prefix}ing Alliance"]:
        if name.lower().startswith(p.lower()):
            role = name[len(p):].strip().lstrip('-').strip()
            if not role:
                return prefix
            # "Captain", "1st Team Selected", etc.
            return f"Alliance {role}"
    return prefix


def _ftc_season_achievement(events: list[dict], awards: list[dict], year: int) -> dict:
    """Determine the highest achievement for a team in a given FTC season."""
    from datetime import datetime
    now = datetime.utcnow()

    if not events:
        return {"year": year, "achievement": "No events", "event_name": ""}

    # Build event code → (rank, label, name) map — skip future events
    event_info: dict[str, tuple[int, str, str]] = {}
    for ev in events:
        et = ev.get("type")
        if et is None:
            continue
        # Skip future events
        date_end = ev.get("dateEnd", "")
        if date_end:
            try:
                end_dt = datetime.fromisoformat(str(date_end).replace("Z", ""))
                if end_dt > now:
                    continue
            except (ValueError, TypeError):
                pass
        ec = ev.get("code", "")
        rank_info = _FTC_EVENT_TYPE_RANK.get(int(et) if isinstance(et, (int, str)) and str(et).isdigit() else -1)
        if rank_info:
            event_info[ec] = (rank_info[0], rank_info[1], ev.get("name", ""))

    # Build event code → best award boost
    award_by_event: dict[str, str] = {}
    for a in awards:
        ec = a.get("eventCode", "")
        name = (a.get("name") or "").lower()
        if "winning alliance" in name or "winner" in name:
            award_by_event[ec] = "Winner"
        elif ("finalist alliance" in name or "finalist" in name) and award_by_event.get(ec) != "Winner":
            award_by_event[ec] = "Finalist"

    # Find best (event_rank + award_boost) combination
    best_score = -1
    best_achievement = "Competed"
    best_event_name = ""

    for ec, (rank, label, ev_name) in event_info.items():
        boost = award_by_event.get(ec, "")
        # Score: event_rank * 10 + award bonus (Winner=2, Finalist=1)
        score = rank * 10 + (2 if boost == "Winner" else (1 if boost == "Finalist" else 0))
        if score > best_score:
            best_score = score
            # Show stage of play: Winner/Finalist at the event, or just "Qualifications"
            if boost:
                best_achievement = boost
            else:
                best_achievement = "Qualifications"
            best_event_name = ev_name

    return {"year": year, "achievement": best_achievement, "event_name": best_event_name}


async def get_team_opr_history(team_number: int, season: int) -> list[dict]:
    """Return OPR history across seasons for an FTC team."""
    scout = get_ftcscout_client()
    return await scout.get_team_opr_history(team_number, season)


# Earliest season with FTC Events API match data
_FTC_FIRST_SEASON = 2019


async def get_ftc_head_to_head(
    team_a: int, team_b: int, *, all_time: bool = False, seasons: int = 3,
) -> dict:
    """Find every playoff match where two FTC teams faced or allied each other.

    FTC Events API data goes back to 2019.  By default checks the past 3
    seasons; ``all_time=True`` checks from 2019 to the current season.
    """
    client = get_ftc_client()
    current = current_ftc_season()

    if all_time:
        year_range = list(range(_FTC_FIRST_SEASON, current + 1))
    else:
        year_range = list(range(max(_FTC_FIRST_SEASON, current - seasons + 1), current + 1))

    _sem = asyncio.Semaphore(6)

    async def _safe(coro):
        async with _sem:
            try:
                return await coro
            except Exception:
                return None

    results: list[dict] = []

    for check_year in year_range:
        # Find common events by fetching each team's matches and extracting event codes
        matches_a_raw, matches_b_raw = await asyncio.gather(
            _safe(client.get_matches(check_year, "", team_number=team_a)),
            _safe(client.get_matches(check_year, "", team_number=team_b)),
        )
        matches_a_raw = matches_a_raw or []
        matches_b_raw = matches_b_raw or []

        events_a = {m.get("eventCode", "") for m in matches_a_raw if m.get("eventCode")}
        events_b = {m.get("eventCode", "") for m in matches_b_raw if m.get("eventCode")}
        common_events = events_a & events_b
        if not common_events:
            continue

        # Build event name map
        all_events = await _safe(client.get_events(check_year))
        event_names: dict[str, str] = {}
        if all_events:
            for ev in all_events:
                event_names[ev.get("code", "")] = ev.get("name", ev.get("code", ""))

        # Check playoff matches in each common event
        for ev_code in common_events:
            playoff = await _safe(client.get_schedule_hybrid(check_year, ev_code, "playoff"))
            if not playoff:
                continue

            for m in playoff:
                teams_in = m.get("teams", [])
                red_raw = [t for t in teams_in if (t.get("station") or "").startswith("Red")]
                blue_raw = [t for t in teams_in if (t.get("station") or "").startswith("Blue")]
                red_nums = {t.get("teamNumber", 0) for t in red_raw}
                blue_nums = {t.get("teamNumber", 0) for t in blue_raw}

                a_red, a_blue = team_a in red_nums, team_a in blue_nums
                b_red, b_blue = team_b in red_nums, team_b in blue_nums
                if not (a_red or a_blue) or not (b_red or b_blue):
                    continue

                red_score = m.get("scoreRedFinal")
                blue_score = m.get("scoreBlueFinal")
                match_num = m.get("matchNumber", 0)
                series = m.get("series", 1)
                desc = m.get("description", "")
                _, label, _ = _parse_ftc_bracket_label(desc, series, match_num)

                winner_alliance = ""
                if red_score is not None and blue_score is not None:
                    if red_score > blue_score:
                        winner_alliance = "red"
                    elif blue_score > red_score:
                        winner_alliance = "blue"

                match_key = f"{check_year}ftc{ev_code}_{series}m{match_num}"
                ev_name = event_names.get(ev_code, ev_code)

                if (a_red and b_blue) or (a_blue and b_red):
                    # Opponents
                    a_side = "red" if a_red else "blue"
                    a_won = winner_alliance == a_side
                    results.append({
                        "event_key": f"{check_year}ftc{ev_code.lower()}",
                        "event_name": ev_name,
                        "match_key": match_key,
                        "match_label": label,
                        "comp_level": label,
                        "year": check_year,
                        "red_teams": [str(n) for n in sorted(red_nums) if n],
                        "blue_teams": [str(n) for n in sorted(blue_nums) if n],
                        "red_score": red_score or 0,
                        "blue_score": blue_score or 0,
                        "winner": str(team_a) if a_won else (str(team_b) if winner_alliance else "tie"),
                        "relationship": "opponents",
                    })
                elif (a_red and b_red) or (a_blue and b_blue):
                    # Allies
                    side = "red" if (a_red and b_red) else "blue"
                    results.append({
                        "event_key": f"{check_year}ftc{ev_code.lower()}",
                        "event_name": ev_name,
                        "match_key": match_key,
                        "match_label": label,
                        "comp_level": label,
                        "year": check_year,
                        "red_teams": [str(n) for n in sorted(red_nums) if n],
                        "blue_teams": [str(n) for n in sorted(blue_nums) if n],
                        "red_score": red_score or 0,
                        "blue_score": blue_score or 0,
                        "winner": "both" if winner_alliance == side else "neither",
                        "relationship": "allies",
                    })

    # Summarise
    opp = [r for r in results if r["relationship"] == "opponents"]
    ally = [r for r in results if r["relationship"] == "allies"]
    a_wins = sum(1 for r in opp if r["winner"] == str(team_a))
    b_wins = sum(1 for r in opp if r["winner"] == str(team_b))

    # Collect team nicknames
    team_nicknames: dict[str, str] = {}
    for tn in (team_a, team_b):
        info = await _safe(client.get_team_info(current_ftc_season(), tn))
        if info:
            name = info.get("nameShort") or info.get("nameFull") or ""
            if name:
                team_nicknames[str(tn)] = name

    return {
        "team_a": team_a,
        "team_b": team_b,
        "opponent_matches": opp,
        "ally_matches": ally,
        "h2h_summary": {
            "total_opponent_matches": len(opp),
            "team_a_wins": a_wins,
            "team_b_wins": b_wins,
            "total_ally_matches": len(ally),
        },
        "years_checked": year_range,
        "all_time": all_time,
        "team_nicknames": team_nicknames,
    }


# ── FTC Event Connections ──────────────────────────────────

_CONNECTIONS_TTL = 3600  # 1 hour disk cache TTL

_ftc_alltime_warm_tasks: set[str] = set()


async def get_ftc_event_connections(
    event_key: str, *, all_time: bool = False, lookback: int = 3,
) -> list[dict]:
    """Public entry point — 3-tier cache-aside: disk → Supabase → build."""
    cache_key = f"{event_key}_all" if all_time else event_key

    def _has_h2h(conns: list[dict]) -> bool:
        """Return True if the connections list already contains H2H win data."""
        for c in conns:
            if c.get("opponents_at"):
                return "h2h_wins_a" in c
        return True  # no opponent pairs → nothing to check

    # 1) Disk cache
    cached = read_payload("connections", cache_key, _CONNECTIONS_TTL)
    if cached:
        conns = cached.get("connections", [])
        if _has_h2h(conns):
            cached.pop("_ts", None)
            if not all_time:
                _maybe_warm_ftc_alltime(event_key)
            return conns
        # Stale cache (pre-H2H) — invalidate so we rebuild with H2H data
        invalidate("connections", cache_key)

    # 2) Supabase cache
    sb_key = f"conn_{cache_key}"
    sb_row = await get_cached_summary(sb_key)
    if sb_row and sb_row.get("summary"):
        conns = sb_row["summary"].get("connections", [])
        if _has_h2h(conns):
            write_payload("connections", cache_key, sb_row["summary"])
            if not all_time:
                _maybe_warm_ftc_alltime(event_key)
            return conns
        # Stale Supabase entry — fall through to rebuild

    # 3) Build from scratch
    result = await _build_ftc_connections(event_key, all_time=all_time, lookback=lookback)

    payload = {"connections": result}
    write_payload("connections", cache_key, payload)
    if result:
        await set_cached_summary(sb_key, summary=payload)

    if not all_time:
        _maybe_warm_ftc_alltime(event_key)

    return result


def _maybe_warm_ftc_alltime(event_key: str):
    """Kick off background build of all-time FTC connections if not cached."""
    all_key = f"{event_key}_all"
    if all_key in _ftc_alltime_warm_tasks:
        return
    cached = read_payload("connections", all_key, _CONNECTIONS_TTL)
    if cached:
        return
    _ftc_alltime_warm_tasks.add(all_key)
    asyncio.ensure_future(_warm_ftc_alltime(event_key, all_key))


async def _warm_ftc_alltime(event_key: str, all_key: str):
    """Background: build and cache all-time FTC connections."""
    try:
        await get_ftc_event_connections(event_key, all_time=True)
    except Exception:
        pass
    finally:
        _ftc_alltime_warm_tasks.discard(all_key)


async def get_ftc_match_connections(
    event_key: str, team_numbers: list[int], *, all_time: bool = False,
) -> list[dict]:
    """Filter full-event FTC connections to teams on the field."""
    all_conns = await get_ftc_event_connections(event_key, all_time=all_time)
    if not all_conns:
        return []
    team_set = set(team_numbers)
    return [
        c for c in all_conns
        if c.get("team_a") in team_set and c.get("team_b") in team_set
    ]


async def _build_ftc_connections(
    event_key: str, *, all_time: bool = False, lookback: int = 3,
) -> list[dict]:
    """Find pairs of teams at an FTC event that share prior playoff history.

    Uses the FTC Events API ``events?teamNumber=`` endpoint to discover
    each team's past events, then fetches alliances + playoff matches for
    common events to classify partner / opponent relationships.

    Returns the same shape as the FRC ``get_event_connections`` function.
    """
    client = get_ftc_client()
    year, event_code = _parse_ftc_key(event_key)

    # 1) Get team list for the current event
    teams = await client.get_event_teams(year, event_code)
    if not teams:
        return []

    team_numbers = [t["teamNumber"] for t in teams]
    name_map: dict[int, str] = {
        t["teamNumber"]: t.get("nameShort") or t.get("nameFull", "")
        for t in teams
    }

    # Determine season range to check
    if all_time:
        check_years = list(range(_FTC_FIRST_SEASON, year + 1))
    else:
        check_years = list(range(max(_FTC_FIRST_SEASON, year - lookback + 1), year + 1))

    _sem = asyncio.Semaphore(8)

    async def _safe(coro):
        async with _sem:
            try:
                return await coro
            except Exception:
                return None

    # 2) For each team, get their events per season
    #    team_number -> set of (season, event_code) tuples
    team_events: dict[int, set[tuple[int, str]]] = {n: set() for n in team_numbers}
    event_name_map: dict[str, str] = {}  # "season:code" -> display name

    async def _fetch_team_events(num: int, s: int):
        evts = await _safe(client.get_team_events(s, num))
        return num, s, evts or []

    # Batch: all teams × all seasons
    tasks = []
    for num in team_numbers:
        for s in check_years:
            tasks.append(_fetch_team_events(num, s))

    results = await asyncio.gather(*tasks)
    for num, s, evts in results:
        for ev in evts:
            code = ev.get("code", "")
            if not code:
                continue
            # Skip the current event itself
            if s == year and code.upper() == event_code.upper():
                continue
            team_events[num].add((s, code))
            key = f"{s}:{code}"
            if key not in event_name_map:
                event_name_map[key] = ev.get("name", code)

    # 3) Find team pairs that share common events
    pair_common: dict[tuple[int, int], set[tuple[int, str]]] = {}
    events_to_fetch: set[tuple[int, str]] = set()
    for i in range(len(team_numbers)):
        for j in range(i + 1, len(team_numbers)):
            ta, tb = team_numbers[i], team_numbers[j]
            common = team_events[ta] & team_events[tb]
            if common:
                pair_common[(ta, tb)] = common
                events_to_fetch.update(common)

    if not events_to_fetch:
        return []

    # 4) Fetch alliances + playoff matches for each common event
    async def _fetch_alliances(s: int, code: str):
        data = await _safe(client.get_alliances(s, code))
        return (s, code), data

    async def _fetch_playoff_matches(s: int, code: str):
        data = await _safe(client.get_matches(s, code, level="playoff"))
        return (s, code), data

    alliance_results = await asyncio.gather(
        *[_fetch_alliances(s, c) for s, c in events_to_fetch]
    )
    match_results = await asyncio.gather(
        *[_fetch_playoff_matches(s, c) for s, c in events_to_fetch]
    )

    alliance_cache: dict[tuple[int, str], list] = {}
    match_cache: dict[tuple[int, str], list] = {}

    for key, data in alliance_results:
        if data is not None:
            alliance_cache[key] = data

    for key, data in match_results:
        if data is not None:
            match_cache[key] = data

    # 5) Classify each pair's history at common events
    connections: list[dict] = []

    for (ta, tb), common in pair_common.items():
        partner_events: list[dict] = []
        opponent_events: list[dict] = []

        for s, code in common:
            ek = f"{s}:{code}"
            display_name = event_name_map.get(ek, code)
            ftc_event_key = f"{s}ftc{code.lower()}"

            # Check partnership: were they on the same alliance?
            were_partners = False
            alliance_result = None
            for al in alliance_cache.get((s, code), []):
                # Alliance members can be dicts with teamNumber or plain ints
                def _team_num(slot):
                    if isinstance(slot, dict):
                        return slot.get("teamNumber")
                    if isinstance(slot, (int, float)):
                        return int(slot)
                    return None
                members = [
                    _team_num(al.get(k))
                    for k in ("captain", "round1", "round2", "round3")
                ]
                members = [m for m in members if m is not None]
                if ta in members and tb in members:
                    were_partners = True
                    break

            if were_partners:
                # Try to find highest playoff stage they played together
                highest_label = None
                highest_order = -1
                for m in match_cache.get((s, code), []):
                    teams_in_match = [
                        t.get("teamNumber")
                        for t in m.get("teams", [])
                    ]
                    # Check same alliance (both red or both blue)
                    red_teams = [
                        t.get("teamNumber") for t in m.get("teams", [])
                        if t.get("station", "").startswith("Red")
                    ]
                    blue_teams = [
                        t.get("teamNumber") for t in m.get("teams", [])
                        if t.get("station", "").startswith("Blue")
                    ]
                    same_alliance = (
                        (ta in red_teams and tb in red_teams) or
                        (ta in blue_teams and tb in blue_teams)
                    )
                    if same_alliance:
                        desc = m.get("description", "")
                        series = m.get("series", 0)
                        match_num = m.get("matchNumber", 0)
                        _cl, label, sort_key = _parse_ftc_bracket_label(desc, series, match_num)
                        order = sort_key[0] * 100 + sort_key[1]
                        if order > highest_order:
                            highest_order = order
                            highest_label = label

                partner_events.append({
                    "event_key": ftc_event_key,
                    "event_name": display_name,
                    "year": s,
                    "stage": highest_label or "Alliance",
                    "result": alliance_result,
                })

            # Check opponents: different alliances in same playoff match
            highest_label = None
            highest_order = -1
            h2h_a_wins = 0
            h2h_b_wins = 0
            for m in match_cache.get((s, code), []):
                red_teams = [
                    t.get("teamNumber") for t in m.get("teams", [])
                    if t.get("station", "").startswith("Red")
                ]
                blue_teams = [
                    t.get("teamNumber") for t in m.get("teams", [])
                    if t.get("station", "").startswith("Blue")
                ]
                opposing = (
                    (ta in red_teams and tb in blue_teams) or
                    (ta in blue_teams and tb in red_teams)
                )
                if opposing:
                    desc = m.get("description", "")
                    series = m.get("series", 0)
                    match_num = m.get("matchNumber", 0)
                    _cl, label, sort_key = _parse_ftc_bracket_label(desc, series, match_num)
                    order = sort_key[0] * 100 + sort_key[1]
                    if order > highest_order:
                        highest_order = order
                        highest_label = label
                    # Track H2H wins
                    red_score = m.get("scoreRedFinal")
                    blue_score = m.get("scoreBlueFinal")
                    if red_score is not None and blue_score is not None:
                        if ta in red_teams and tb in blue_teams:
                            if red_score > blue_score:
                                h2h_a_wins += 1
                            elif blue_score > red_score:
                                h2h_b_wins += 1
                        elif ta in blue_teams and tb in red_teams:
                            if blue_score > red_score:
                                h2h_a_wins += 1
                            elif red_score > blue_score:
                                h2h_b_wins += 1

            if highest_label:
                opponent_events.append({
                    "event_key": ftc_event_key,
                    "event_name": display_name,
                    "year": s,
                    "stage": highest_label,
                    "team_a_wins": h2h_a_wins,
                    "team_b_wins": h2h_b_wins,
                })

        if partner_events or opponent_events:
            # Deduplicate: keep only highest stage per event
            def _stage_rank(stage: str) -> int:
                if "final" in stage.lower() or "finals" in stage.lower():
                    return 4
                if "semi" in stage.lower():
                    return 3
                if "round" in stage.lower():
                    try:
                        return int(stage.split()[1])
                    except (IndexError, ValueError):
                        return 1
                return 0

            def _dedup(events: list[dict]) -> list[dict]:
                best: dict[str, dict] = {}
                for e in events:
                    ek = e["event_key"]
                    if ek not in best or _stage_rank(e["stage"]) > _stage_rank(best[ek]["stage"]):
                        if ek in best and "team_a_wins" in e:
                            e = dict(e)
                            e["team_a_wins"] += best[ek].get("team_a_wins", 0)
                            e["team_b_wins"] += best[ek].get("team_b_wins", 0)
                        best[ek] = e
                return sorted(best.values(), key=lambda x: x["year"], reverse=True)

            deduped_opponents = _dedup(opponent_events)
            h2h_wins_a = sum(e.get("team_a_wins", 0) for e in deduped_opponents)
            h2h_wins_b = sum(e.get("team_b_wins", 0) for e in deduped_opponents)
            connections.append({
                "team_a": ta,
                "team_a_name": name_map.get(ta, ""),
                "team_b": tb,
                "team_b_name": name_map.get(tb, ""),
                "partnered_at": _dedup(partner_events),
                "opponents_at": deduped_opponents,
                "h2h_wins_a": h2h_wins_a,
                "h2h_wins_b": h2h_wins_b,
            })

    connections.sort(
        key=lambda c: len(c["partnered_at"]) + len(c["opponents_at"]),
        reverse=True,
    )
    return connections


def _parse_ftc_key(event_key: str) -> tuple[int, str]:
    """Parse '2025ftcXYZ' → (2025, 'XYZ').

    FTC event codes are uppercase (e.g. 'USCALACOSB').
    The key stored by the frontend is lowercased ('2025ftcuscalacosb'),
    so we uppercase the code portion to match what FTC APIs expect.
    """
    key = event_key.lower()
    if "ftc" in key:
        idx = key.index("ftc")
        year_str = key[:idx]
        code = key[idx + 3:].upper()  # FTC codes are always uppercase
        return int(year_str), code
    # Fallback: assume first 4 chars are year
    return int(event_key[:4]), event_key[4:].upper()
