"""Event-related business logic — teams, rankings, OPRs, EPA."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date
from .tba_client import get_tba_client
from .frc_client import get_frc_client
from .statbotics_client import get_epa_map
from .inflight import coalesce
from .supabase_client import (
    get_supabase,
    merge_event_teams,
    read_events_by_year,
    read_event,
    read_event_teams_full,
    read_matches,
    read_team_avatars,
)

log = logging.getLogger(__name__)

# Concurrency limit for outbound API calls within this module
_API_SEMAPHORE = asyncio.Semaphore(10)


def _sb_teams_valid(sb_rows: list[dict]) -> bool:
    """Return True if Supabase event_teams data is rich enough to use.

    A "valid cache hit" requires that at least one row has rank OR opr data
    inside ``raw_data``.  If workers have only pushed EPA (Statbotics)
    without any TBA/FRC data, the rows exist but are too incomplete to
    serve—fall through to the API path instead.
    """
    for r in sb_rows:
        rd = r.get("raw_data") or {}
        if isinstance(rd, str):
            rd = json.loads(rd)
        if rd.get("rank") is not None or rd.get("opr") is not None:
            return True
    return False

# TBA event types to exclude from the season dropdown (off-season, preseason, unlabeled)
_EXCLUDE_TYPES = {99, 100, -1}

# Region groupings for FRC events
_REGION_MAP = {
    # US regions (split per district where applicable)
    "New England": {"NH", "MA", "CT", "RI", "VT", "ME"},
    "New York": {"NY"},
    "Mid-Atlantic": {"NJ", "PA", "DE"},
    "Chesapeake": {"VA", "MD", "DC"},
    "North Carolina": {"NC"},
    "South Carolina": {"SC"},
    "Georgia": {"GA"},
    "Southeast": {"FL", "AL", "MS", "TN", "KY", "WV", "LA", "AR"},
    "Indiana": {"IN"},
    "Michigan": {"MI"},
    "Midwest": {"OH", "IL", "MN", "IA", "MO", "ND", "SD", "NE", "KS"},
    "Wisconsin": {"WI"},
    "Texas": {"TX"},
    "Mountain": {"MT", "WY", "CO", "NM", "AZ", "UT", "ID", "NV"},
    "California": {"CA"},
    "Pacific Northwest": {"WA", "OR"},
    "Pacific": {"HI", "AK"},
}


# Pre-district regions that transitioned to a district system.
# Maps the old region name to the current district name so that
# the region resolves to a key that exists in region_stats.json.
_REGION_MERGE = {
    "Israel": "FIRST Israel",
    "Texas": "FIRST In Texas",
    "California": "FIRST California",
    "Wisconsin": "FIRST Wisconsin",
    "Indiana": "FIRST Indiana Robotics",
    "Michigan": "FIRST in Michigan",
    "North Carolina": "FIRST North Carolina",
    "South Carolina": "FIRST South Carolina",
    "Georgia": "Peachtree",
    "Chesapeake": "FIRST Chesapeake",
    "Mid-Atlantic": "FIRST Mid-Atlantic",
}

# Canadian province codes → district (where one exists).
_CANADA_PROVINCE_DISTRICT = {
    "ON": "FIRST Canada - Ontario",
    "Ontario": "FIRST Canada - Ontario",
}


def _resolve_region(country: str, state_prov: str, district: dict | None) -> str:
    """Return a human-readable region string for an event."""
    if district and district.get("abbreviation"):
        return district["display_name"] or district["abbreviation"].upper()

    if country and country not in ("USA", ""):
        # Canadian events: route by province if a district mapping exists
        if "Canada" in country or "canada" in country.lower():
            dist = _CANADA_PROVINCE_DISTRICT.get(state_prov)
            if dist:
                return dist
            return "Canada"
        # Map known FRC countries to their region_stats.json key
        _COUNTRY_LABELS = (
            "Türkiye", "Israel", "China", "Australia",
            "Brazil", "Mexico", "Chinese Taipei",
            "India", "Japan", "Chile", "Colombia", "Egypt", "Poland",
        )
        for label in _COUNTRY_LABELS:
            if label.lower() in country.lower() or country.lower() in label.lower():
                return _REGION_MERGE.get(label, label)
        return country

    # US state lookup
    for region, states in _REGION_MAP.items():
        if state_prov in states:
            return _REGION_MERGE.get(region, region)
    return "Other"


async def get_season_events(year: int, include_offseason: bool = False) -> list[dict]:
    """Return a lightweight list of events for *year*.

    Reads from Supabase first; falls back to TBA if Supabase has no data.
    By default off-season / preseason events are excluded.
    Pass *include_offseason=True* to include event_type 99.
    """
    # ── Try Supabase first ──────────────────────────────────
    try:
        sb_rows = await read_events_by_year(year)
    except Exception as e:
        log.warning("Supabase events read failed for %d: %s", year, e)
        sb_rows = []

    if sb_rows:
        # When including offseason, only exclude truly junk types (-1, 100)
        exclude = {100, -1} if include_offseason else _EXCLUDE_TYPES
        events = []
        for row in sb_rows:
            raw = row.get("raw_data") or {}
            if isinstance(raw, str):
                raw = json.loads(raw)
            etype = raw.get("event_type", -1)
            if etype in exclude:
                continue
            events.append({
                "key": row["event_key"],
                "name": row.get("name", ""),
                "short_name": raw.get("short_name") or row.get("name", ""),
                "week": raw.get("week"),
                "start_date": str(row.get("start_date", "")),
                "end_date": str(row.get("end_date", "")),
                "city": raw.get("city", ""),
                "state_prov": raw.get("state_prov", ""),
                "country": raw.get("country", ""),
                "event_type": etype,
                "event_type_string": raw.get("event_type_string", ""),
                "district": raw.get("district"),
                "region": (
                    "FIRST Championship"
                    if etype in {3, 4, 6}
                    else _resolve_region(
                        raw.get("country", ""),
                        raw.get("state_prov", ""),
                        raw.get("district"),
                    )
                ),
            })
        events.sort(key=lambda e: (e["name"] or "").lower())
        return events

    # ── Fallback: TBA ───────────────────────────────────────
    client = get_tba_client()
    raw = await client.get_events_by_year(year)

    # When including offseason, only exclude truly junk types (-1, 100)
    exclude = {100, -1} if include_offseason else _EXCLUDE_TYPES

    events = []
    for ev in raw:
        etype = ev.get("event_type", -1)
        if etype in exclude:
            continue

        events.append({
            "key": ev["key"],
            "name": ev.get("name", ""),
            "short_name": ev.get("short_name") or ev.get("name", ""),
            "week": ev.get("week"),           # 0-indexed week or None for CMP
            "start_date": ev.get("start_date", ""),
            "end_date": ev.get("end_date", ""),
            "city": ev.get("city", ""),
            "state_prov": ev.get("state_prov", ""),
            "country": ev.get("country", ""),
            "event_type": etype,
            "event_type_string": ev.get("event_type_string", ""),
            "district": ev.get("district"),
            "region": (
                "FIRST Championship"
                if etype in {3, 4, 6}
                else _resolve_region(
                    ev.get("country", ""),
                    ev.get("state_prov", ""),
                    ev.get("district"),
                )
            ),
        })

    events.sort(key=lambda e: (e["name"] or "").lower())
    return events


async def _safe(coro):
    """Await *coro*; return None on any error (rankings/OPRs may not exist yet)."""
    try:
        return await coro
    except Exception:
        return None


async def _load_tims_overrides(team_keys: list[str]) -> dict[str, dict]:
    """Load active TIMS overrides from Supabase for the given team keys.

    Returns ``{team_key: {custom_nickname, custom_sponsor_read, ...}}``
    with only non-null override fields included.
    """
    if not team_keys:
        return {}
    try:
        sb = await get_supabase()
        resp = (
            await sb.table("tims_overrides")
            .select("team_key, custom_nickname, custom_sponsor_read, "
                    "custom_robot_name, custom_motto, custom_organization, "
                    "custom_location, custom_top_sponsors, custom_pronunciation, "
                    "custom_hardware, custom_auto_strategy, custom_teleop_strategy, "
                    "custom_number_display, "
                    "author_name, author_event_key, updated_at")
            .in_("team_key", team_keys)
            .eq("is_deleted", False)
            .execute()
        )
        result: dict[str, dict] = {}
        for row in resp.data or []:
            overrides = {}
            for field in ("custom_nickname", "custom_sponsor_read",
                          "custom_robot_name", "custom_motto",
                          "custom_organization", "custom_location",
                          "custom_top_sponsors", "custom_pronunciation",
                          "custom_hardware", "custom_auto_strategy",
                          "custom_teleop_strategy", "custom_number_display",
                          "author_name", "author_event_key", "updated_at"):
                if row.get(field) is not None:
                    overrides[field] = row[field]
            if overrides:
                result[row["team_key"]] = overrides
        return result
    except Exception as e:
        log.warning("Failed to load TIMS overrides: %s", e)
        return {}


def _apply_tims_overrides(team: dict, overrides: dict) -> None:
    """Mutate a team dict in-place, replacing FIRST defaults with user edits."""
    if "custom_nickname" in overrides:
        team["nickname"] = overrides["custom_nickname"]
    if "custom_sponsor_read" in overrides:
        team["sponsor_read"] = overrides["custom_sponsor_read"]
    if "custom_robot_name" in overrides:
        team["robot_name"] = overrides["custom_robot_name"]
    if "custom_motto" in overrides:
        team["motto"] = overrides["custom_motto"]
    if "custom_organization" in overrides:
        team["school_name"] = overrides["custom_organization"]
    if "custom_location" in overrides:
        parts = [p.strip() for p in overrides["custom_location"].split(",", 1)]
        if len(parts) >= 2:
            team["city"] = parts[0]
            team["state_prov"] = parts[1]
        else:
            team["city"] = overrides["custom_location"]
    if "custom_top_sponsors" in overrides:
        team["top_sponsors"] = overrides["custom_top_sponsors"]
    if "custom_pronunciation" in overrides:
        team["name_pronounce"] = overrides["custom_pronunciation"]
    if "custom_hardware" in overrides:
        team["hardware"] = overrides["custom_hardware"]
    if "custom_auto_strategy" in overrides:
        team["auto_strategy"] = overrides["custom_auto_strategy"]
    if "custom_teleop_strategy" in overrides:
        team["teleop_strategy"] = overrides["custom_teleop_strategy"]
    if "custom_number_display" in overrides:
        team["number_display"] = overrides["custom_number_display"]
    # Audit metadata (for frontend display of "Last updated by")
    if "author_name" in overrides:
        team["tims_author"] = overrides["author_name"]
    if "author_event_key" in overrides:
        team["tims_event_key"] = overrides["author_event_key"]
    if "updated_at" in overrides:
        team["tims_updated_at"] = overrides["updated_at"]
    team["has_tims_overrides"] = True


def _event_status(start_date: str, end_date: str) -> str:
    """Return 'upcoming', 'ongoing', or 'completed' based on today's date."""
    from datetime import date, timedelta
    today = date.today()
    try:
        sd = date.fromisoformat(start_date)
        ed = date.fromisoformat(end_date)
    except (ValueError, TypeError):
        return "unknown"
    # Give 1 extra day buffer after end_date for late result uploads
    if today > ed + timedelta(days=1):
        return "completed"
    if today >= sd:
        return "ongoing"
    return "upcoming"


async def get_event_info(event_key: str) -> dict:
    """Single-flight coalesced event info lookup."""
    return await coalesce(f"event_info:{event_key}", _get_event_info_impl, event_key)


async def _get_event_info_impl(event_key: str) -> dict:
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
        etype = raw.get("event_type", -1)
        region = "" if etype in (3, 4) else _resolve_region(
            raw.get("country", ""),
            raw.get("state_prov", ""),
            raw.get("district"),
        )
        return {
            "key": row["event_key"],
            "name": row.get("name", ""),
            "year": int(event_key[:4]) if event_key[:4].isdigit() else None,
            "city": raw.get("city", ""),
            "state_prov": raw.get("state_prov", ""),
            "country": raw.get("country", ""),
            "event_type_string": raw.get("event_type_string", ""),
            "event_type": etype,
            "start_date": start,
            "end_date": end,
            "status": _event_status(start, end),
            "region": region,
        }

    # ── Fallback: TBA ───────────────────────────────────────
    client = get_tba_client()
    ev = await client.get_event(event_key)
    start = ev.get("start_date", "")
    end = ev.get("end_date", "")
    etype = ev.get("event_type", -1)
    # CMP Division (3) and Einstein (4) aren't region-specific
    region = "" if etype in (3, 4) else _resolve_region(
        ev.get("country", ""),
        ev.get("state_prov", ""),
        ev.get("district"),
    )
    return {
        "key": ev["key"],
        "name": ev.get("name", ""),
        "year": ev.get("year"),
        "city": ev.get("city", ""),
        "state_prov": ev.get("state_prov", ""),
        "country": ev.get("country", ""),
        "event_type_string": ev.get("event_type_string", ""),
        "event_type": etype,
        "start_date": start,
        "end_date": end,
        "status": _event_status(start, end),
        "region": region,
    }


async def get_event_teams_with_stats(event_key: str) -> list[dict]:
    """Return every team at the event enriched with rank, record, and OPR.

    Reads from Supabase first (populated by workers); falls back to
    TBA + Statbotics if Supabase has no data for this event.

    Uses single-flight coalescing: if 8 iPads hit a cache miss at once,
    only one request goes to TBA — the rest await the same Future.
    """
    return await coalesce(
        f"event_teams:{event_key}",
        _get_event_teams_with_stats_impl,
        event_key,
    )


async def _get_event_teams_with_stats_impl(event_key: str) -> list[dict]:
    """Inner implementation — always called at most once per key."""
    year = int(event_key[:4]) if event_key[:4].isdigit() else date.today().year

    # ── Try Supabase first ──────────────────────────────────
    try:
        sb_rows = await read_event_teams_full(event_key)
    except Exception as e:
        log.warning("Supabase event_teams read failed for %s: %s", event_key, e)
        sb_rows = []

    if sb_rows and _sb_teams_valid(sb_rows):
        # Read avatars from Supabase team_avatars table
        all_keys = [r["team_key"] for r in sb_rows]
        try:
            avatar_map = await read_team_avatars(all_keys, year)
        except Exception:
            avatar_map = {}

        result = []
        for r in sb_rows:
            tk = r["team_key"]
            raw = r.get("raw_data") or {}
            if isinstance(raw, str):
                raw = json.loads(raw)
            tims = r.get("tims_data") or {}
            if isinstance(tims, str):
                tims = json.loads(tims)
            frc_d = r.get("frc_data") or {}
            if isinstance(frc_d, str):
                frc_d = json.loads(frc_d)
            epa_block = raw.get("epa") or {}

            # Total RP from sort_orders (same logic as FRC API path)
            sort_orders = raw.get("sort_orders") or []
            mp = raw.get("matches_played", 0)
            if sort_orders and isinstance(sort_orders[0], (int, float)):
                ranking_points = round(sort_orders[0] * mp, 1) if mp else None
            else:
                ranking_points = None

            result.append({
                "team_key": tk,
                "team_number": r.get("team_number", 0),
                "nickname": r.get("nickname", ""),
                "school_name": frc_d.get("schoolName") or tims.get("school_name", ""),
                "city": frc_d.get("city") or tims.get("city", ""),
                "state_prov": frc_d.get("stateProv") or tims.get("state_prov", ""),
                "country": frc_d.get("country") or tims.get("country", ""),
                "rookie_year": tims.get("rookie_year") or frc_d.get("rookieYear"),
                "avatar": avatar_map.get(tk),
                "rank": raw.get("rank", "-"),
                "wins": raw.get("wins", 0),
                "losses": raw.get("losses", 0),
                "ties": raw.get("ties", 0),
                "qual_average": raw.get("qual_average", 0),
                "ranking_points": ranking_points,
                "opr": round(raw.get("opr", 0), 2) if raw.get("opr") else 0,
                "epa": epa_block.get("epa"),
                "epa_auto": epa_block.get("epa_auto"),
                "epa_teleop": epa_block.get("epa_teleop"),
                "epa_endgame": epa_block.get("epa_endgame"),
            })

        result.sort(key=lambda x: x["rank"] if isinstance(x["rank"], int) else 999)

        # ── Merge TIMS overrides ────────────────────────────
        all_team_keys = [t["team_key"] for t in result]
        tims_map = await _load_tims_overrides(all_team_keys)
        for t in result:
            overrides = tims_map.get(t["team_key"])
            if overrides:
                _apply_tims_overrides(t, overrides)

        # ── Backfill EPA from Statbotics if missing in Supabase ─
        if not any(t.get("epa") for t in result):
            try:
                epa_map = await get_epa_map(event_key)
                if epa_map:
                    for t in result:
                        epa_block = epa_map.get(t["team_key"]) or {}
                        t["epa"] = epa_block.get("epa")
                        t["epa_auto"] = epa_block.get("epa_auto")
                        t["epa_teleop"] = epa_block.get("epa_teleop")
                        t["epa_endgame"] = epa_block.get("epa_endgame")
                    # Persist to Supabase so future requests don't need live fetch
                    merge_rows = [
                        {"event_key": event_key, "team_key": tk,
                         "data": {"epa": epa}}
                        for tk, epa in epa_map.items()
                        if epa is not None
                    ]
                    if merge_rows:
                        asyncio.create_task(_safe(merge_event_teams(merge_rows)))
            except Exception as e:
                log.debug("EPA backfill skipped for %s: %s", event_key, e)

        return result

    # ── Fallback: TBA + Statbotics (original path) ──────────
    client = get_tba_client()
    teams = await client.get_event_teams_full(event_key)

    rankings, oprs, epa_data = await asyncio.gather(
        _safe(client.get_event_rankings(event_key)),
        _safe(client.get_event_oprs(event_key)),
        _safe(get_epa_map(event_key)),
    )

    epa_data = epa_data or {}

    # Fetch avatars for all teams in parallel (with concurrency limit)
    async def _fetch_avatar(tk: str):
        async with _API_SEMAPHORE:
            return await _safe(client.get_team_media(tk, year))

    avatar_tasks = {t["key"]: _fetch_avatar(t["key"]) for t in teams}
    avatar_keys = list(avatar_tasks.keys())
    avatar_results = await asyncio.gather(*avatar_tasks.values())
    avatar_map: dict[str, str | None] = {}
    for tk, media_list in zip(avatar_keys, avatar_results):
        avatar_map[tk] = None
        if media_list:
            for m in media_list:
                if m.get("type") == "avatar":
                    b64 = (m.get("details") or {}).get("base64Image")
                    if b64:
                        avatar_map[tk] = f"data:image/png;base64,{b64}"
                        break

    # Build fast lookups
    rank_map: dict[str, dict] = {}
    if rankings and rankings.get("rankings"):
        for r in rankings["rankings"]:
            rank_map[r["team_key"]] = r

    opr_map: dict[str, dict] = {}
    if oprs:
        for tk in oprs.get("oprs", {}):
            opr_map[tk] = {
                "opr": round(oprs["oprs"].get(tk, 0), 2),
            }

    result = []
    for t in teams:
        tk = t["key"]
        r = rank_map.get(tk, {})
        rec = r.get("record", {})
        o = opr_map.get(tk, {"opr": 0})
        epa = epa_data.get(tk, {})
        # Total RP: prefer extra_stats[0] (total RP), fall back to
        # matches_played * sort_orders[0] (avg RP)
        extra = r.get("extra_stats", [])
        sort_orders = r.get("sort_orders", [])
        if extra and isinstance(extra[0], (int, float)):
            ranking_points = round(extra[0], 1)
        elif sort_orders and isinstance(sort_orders[0], (int, float)):
            mp = r.get("matches_played", 0)
            ranking_points = round(sort_orders[0] * mp, 1) if mp else None
        else:
            ranking_points = None
        result.append(
            {
                "team_key": tk,
                "team_number": t["team_number"],
                "nickname": t.get("nickname", ""),
                "school_name": t.get("school_name", ""),
                "city": t.get("city", ""),
                "state_prov": t.get("state_prov", ""),
                "country": t.get("country", ""),
                "rookie_year": t.get("rookie_year"),
                "avatar": avatar_map.get(tk),
                "rank": r.get("rank", "-"),
                "wins": rec.get("wins", 0),
                "losses": rec.get("losses", 0),
                "ties": rec.get("ties", 0),
                "qual_average": r.get("qual_average", 0),
                "ranking_points": ranking_points,
                "opr": o["opr"],
                "epa": epa.get("epa", None),
                "epa_auto": epa.get("epa_auto", None),
                "epa_teleop": epa.get("epa_teleop", None),
                "epa_endgame": epa.get("epa_endgame", None),
            }
        )

    result.sort(key=lambda x: x["rank"] if isinstance(x["rank"], int) else 999)

    # ── Merge TIMS overrides (user-edited team names, sponsors, etc.) ──
    all_team_keys = [t["team_key"] for t in result]
    tims_map = await _load_tims_overrides(all_team_keys)
    for t in result:
        overrides = tims_map.get(t["team_key"])
        if overrides:
            _apply_tims_overrides(t, overrides)

    return result


async def get_fast_rankings(event_key: str) -> list[dict]:
    """Single-flight coalesced rankings lookup."""
    return await coalesce(f"fast_rankings:{event_key}", _get_fast_rankings_impl, event_key)


async def _get_fast_rankings_impl(event_key: str) -> list[dict]:
    """Return lightweight rank/record/RP data.

    Reads from Supabase (updated every 15s by match_poller) first.
    Falls back to FRC API → TBA if Supabase has no ranking data.
    """
    # ── Try Supabase first ──────────────────────────────────
    try:
        sb_rows = await read_event_teams_full(event_key)
    except Exception:
        sb_rows = []

    if sb_rows:
        # Check if any row has rank data (workers may not have polled yet)
        has_ranks = False
        for r in sb_rows:
            rd = r.get("raw_data") or {}
            if isinstance(rd, str):
                rd = json.loads(rd)
            if rd.get("rank") is not None:
                has_ranks = True
                break

        if has_ranks:
            result = []
            for r in sb_rows:
                raw = r.get("raw_data") or {}
                if isinstance(raw, str):
                    raw = json.loads(raw)
                if raw.get("rank") is None:
                    continue
                sort_orders = raw.get("sort_orders") or []
                mp = raw.get("matches_played", 0)
                if sort_orders and isinstance(sort_orders[0], (int, float)):
                    ranking_points = round(sort_orders[0] * mp, 1) if mp else None
                else:
                    ranking_points = None
                result.append({
                    "team_key": r["team_key"],
                    "rank": raw.get("rank", "-"),
                    "wins": raw.get("wins", 0),
                    "losses": raw.get("losses", 0),
                    "ties": raw.get("ties", 0),
                    "qual_average": raw.get("qual_average", 0),
                    "ranking_points": ranking_points,
                })
            result.sort(key=lambda x: x["rank"] if isinstance(x["rank"], int) else 999)
            return result

    # ── Fallback: FRC API → TBA ─────────────────────────────
    year = int(event_key[:4]) if event_key[:4].isdigit() else date.today().year
    event_code = event_key[4:]
    frc = get_frc_client()

    try:
        frc_rankings = await frc.get_rankings(year, event_code)
    except Exception:
        frc_rankings = None

    if not frc_rankings:
        # Fallback: clear TBA cache and fetch from TBA
        tba = get_tba_client()
        tba.clear_cache_for(f"/event/{event_key}/rankings")
        tba_rankings = await _safe(tba.get_event_rankings(event_key))
        if not tba_rankings or not tba_rankings.get("rankings"):
            return []
        result = []
        for r in tba_rankings["rankings"]:
            rec = r.get("record", {})
            extra = r.get("extra_stats", [])
            sort_orders = r.get("sort_orders", [])
            if extra and isinstance(extra[0], (int, float)):
                ranking_points = round(extra[0], 1)
            elif sort_orders and isinstance(sort_orders[0], (int, float)):
                mp = r.get("matches_played", 0)
                ranking_points = round(sort_orders[0] * mp, 1) if mp else None
            else:
                ranking_points = None
            result.append({
                "team_key": r["team_key"],
                "rank": r.get("rank", "-"),
                "wins": rec.get("wins", 0),
                "losses": rec.get("losses", 0),
                "ties": rec.get("ties", 0),
                "qual_average": r.get("qual_average", 0),
                "ranking_points": ranking_points,
            })
        result.sort(key=lambda x: x["rank"] if isinstance(x["rank"], int) else 999)
        return result

    # Map FRC API rankings to our lightweight format
    result = []
    for r in frc_rankings:
        team_num = r.get("teamNumber")
        tk = f"frc{team_num}"
        wins = r.get("wins", 0)
        losses = r.get("losses", 0)
        ties = r.get("ties", 0)
        matches_played = r.get("matchesPlayed", 0)
        qual_average = r.get("qualAverage", 0)

        # FRC API sort orders: sortOrder1 is usually avg RP
        # Total RP = avg RP * matches_played
        sort1 = r.get("sortOrder1", 0) or 0
        ranking_points = round(sort1 * matches_played, 1) if matches_played else None

        result.append({
            "team_key": tk,
            "rank": r.get("rank", "-"),
            "wins": wins,
            "losses": losses,
            "ties": ties,
            "qual_average": round(qual_average, 2) if qual_average else 0,
            "ranking_points": ranking_points,
        })

    result.sort(key=lambda x: x["rank"] if isinstance(x["rank"], int) else 999)
    return result


async def get_team_comparison(event_key: str, teams_csv: str) -> dict:
    """Compare 2-6 teams at an event with detailed stats.

    Reads team stats from Supabase first; falls back to TBA.
    Match scores are always read from Supabase (matches table) when available.
    """
    team_keys = [t.strip() for t in teams_csv.split(",") if t.strip()]
    if len(team_keys) < 2 or len(team_keys) > 6:
        raise ValueError("Provide between 2 and 6 team keys")

    # ── Try Supabase for team data + matches ────────────────
    sb_teams = []
    sb_matches = []
    try:
        sb_teams, sb_matches = await asyncio.gather(
            read_event_teams_full(event_key),
            read_matches(event_key),
        )
    except Exception:
        pass

    if sb_teams and _sb_teams_valid(sb_teams):
        # Build lookups from Supabase data
        team_raw_map: dict[str, dict] = {}
        team_info_map: dict[str, dict] = {}
        for r in sb_teams:
            tk = r["team_key"]
            raw = r.get("raw_data") or {}
            if isinstance(raw, str):
                raw = json.loads(raw)
            tims = r.get("tims_data") or {}
            if isinstance(tims, str):
                tims = json.loads(tims)
            frc_d = r.get("frc_data") or {}
            if isinstance(frc_d, str):
                frc_d = json.loads(frc_d)
            team_raw_map[tk] = raw
            team_info_map[tk] = {
                "team_number": r.get("team_number", 0),
                "nickname": r.get("nickname", ""),
                "city": frc_d.get("city") or tims.get("city", ""),
                "state_prov": frc_d.get("stateProv") or tims.get("state_prov", ""),
                "country": frc_d.get("country") or tims.get("country", ""),
            }

        # Compute per-team scores from matches
        team_scores: dict[str, list[int]] = {}
        for m in sb_matches:
            if m.get("comp_level") != "qm":
                continue
            alliances = m.get("alliances") or {}
            if isinstance(alliances, str):
                alliances = json.loads(alliances)
            for color in ("red", "blue"):
                alliance = alliances.get(color) or {}
                score = alliance.get("score", -1)
                if score < 0:
                    continue
                for tk in alliance.get("team_keys", []):
                    team_scores.setdefault(tk, []).append(score)

        comparison = []
        for tk in team_keys:
            raw = team_raw_map.get(tk, {})
            info = team_info_map.get(tk, {})
            epa_block = raw.get("epa") or {}
            scores = team_scores.get(tk, [])

            sort_orders = raw.get("sort_orders") or []
            avg_rp = round(sort_orders[0], 2) if sort_orders and isinstance(sort_orders[0], (int, float)) else 0

            comparison.append({
                "team_key": tk,
                "team_number": info.get("team_number", int(tk.replace("frc", ""))),
                "nickname": info.get("nickname", ""),
                "city": info.get("city", ""),
                "state_prov": info.get("state_prov", ""),
                "country": info.get("country", ""),
                "avatar": None,
                "rank": raw.get("rank", "-"),
                "wins": raw.get("wins", 0),
                "losses": raw.get("losses", 0),
                "ties": raw.get("ties", 0),
                "opr": round(raw.get("opr", 0), 2) if raw.get("opr") else 0,
                "epa": epa_block.get("epa"),
                "epa_auto": epa_block.get("epa_auto"),
                "epa_teleop": epa_block.get("epa_teleop"),
                "epa_endgame": epa_block.get("epa_endgame"),
                "avg_rp": avg_rp,
                "qual_average": round(sum(scores) / len(scores), 2) if scores else 0,
                "high_score": max(scores) if scores else 0,
                "matches_played": len(scores),
            })

        return {"event_key": event_key, "teams": comparison}

    # ── Fallback: TBA + Statbotics ──────────────────────────
    client = get_tba_client()

    # Fetch all required data in parallel
    matches_raw, rankings, oprs, teams_raw, epa_data = await asyncio.gather(
        _safe(client.get_event_matches(event_key)),
        _safe(client.get_event_rankings(event_key)),
        _safe(client.get_event_oprs(event_key)),
        _safe(client.get_event_teams_full(event_key)),
        _safe(get_epa_map(event_key)),
    )
    epa_data = epa_data or {}

    # Build team info lookup
    team_info: dict[str, dict] = {}
    for t in (teams_raw or []):
        team_info[t["key"]] = t

    # Build rank lookup
    rank_map: dict[str, dict] = {}
    if rankings and rankings.get("rankings"):
        for r in rankings["rankings"]:
            rank_map[r["team_key"]] = r

    # Build OPR lookup
    opr_data: dict[str, dict] = {}
    if oprs:
        for tk in oprs.get("oprs", {}):
            opr_data[tk] = {
                "opr": round(oprs["oprs"].get(tk, 0), 2),
            }

    # Compute per-team match stats from qual matches
    team_scores: dict[str, list[int]] = {}
    team_rp: dict[str, list[float]] = {}
    matches_raw = matches_raw or []
    for m in matches_raw:
        if m.get("comp_level") != "qm":
            continue
        for color in ("red", "blue"):
            score = m["alliances"][color].get("score", -1)
            if score < 0:
                continue
            for tk in m["alliances"][color].get("team_keys", []):
                team_scores.setdefault(tk, []).append(score)

    # Build comparison for each requested team
    comparison = []
    for tk in team_keys:
        info = team_info.get(tk, {})
        rk = rank_map.get(tk, {})
        rec = rk.get("record", {})
        o = opr_data.get(tk, {"opr": 0})
        epa = epa_data.get(tk, {})
        scores = team_scores.get(tk, [])

        # Ranking points from sort_orders
        sort_orders = rk.get("sort_orders", [])
        avg_rp = round(sort_orders[0], 2) if sort_orders and isinstance(sort_orders[0], (int, float)) else 0

        comparison.append({
            "team_key": tk,
            "team_number": info.get("team_number", int(tk.replace("frc", ""))),
            "nickname": info.get("nickname", ""),
            "city": info.get("city", ""),
            "state_prov": info.get("state_prov", ""),
            "country": info.get("country", ""),
            "avatar": None,
            "rank": rk.get("rank", "-"),
            "wins": rec.get("wins", 0),
            "losses": rec.get("losses", 0),
            "ties": rec.get("ties", 0),
            "opr": o["opr"],
            "epa": epa.get("epa", None),
            "epa_auto": epa.get("epa_auto", None),
            "epa_teleop": epa.get("epa_teleop", None),
            "epa_endgame": epa.get("epa_endgame", None),
            "avg_rp": avg_rp,
            "qual_average": round(sum(scores) / len(scores), 2) if scores else 0,
            "high_score": max(scores) if scores else 0,
            "matches_played": len(scores),
        })

    return {"event_key": event_key, "teams": comparison}
