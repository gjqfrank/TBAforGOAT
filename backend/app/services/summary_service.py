"""Event Summary — demographics, Hall of Fame, prior connections, top scorers."""
from __future__ import annotations

import asyncio
from datetime import date
from .region_service import _load_region_stats, get_event_history
from .tba_client import get_tba_client
from .statbotics_client import get_epa_map

# Concurrency limit for outbound API calls within this module
_API_SEMAPHORE = asyncio.Semaphore(10)


# ── Static HoF / Impact lookup (built once from region_stats.json) ───
_HOF_BY_NUM: dict[int, dict] | None = None
_IMPACT_BY_NUM: dict[int, dict] | None = None


def _ensure_award_lookups():
    """Flatten region_stats.json into dicts keyed by team_number."""
    global _HOF_BY_NUM, _IMPACT_BY_NUM
    if _HOF_BY_NUM is not None:
        return
    _HOF_BY_NUM = {}
    _IMPACT_BY_NUM = {}
    for _region, data in _load_region_stats().items():
        for entry in data.get("hof_teams", []):
            num = entry["team_number"]
            if num not in _HOF_BY_NUM:
                _HOF_BY_NUM[num] = entry
            else:
                # merge years from another region listing
                existing = _HOF_BY_NUM[num]
                existing["years"] = sorted(set(existing["years"]) | set(entry.get("years", [])))
        for entry in data.get("impact_finalists", []):
            num = entry["team_number"]
            if num not in _IMPACT_BY_NUM:
                _IMPACT_BY_NUM[num] = entry
            else:
                existing = _IMPACT_BY_NUM[num]
                existing["years"] = sorted(set(existing["years"]) | set(entry.get("years", [])))


async def _safe(coro):
    try:
        async with _API_SEMAPHORE:
            return await coro
    except Exception:
        return None


async def get_event_summary(event_key: str) -> dict:
    """Build the full event summary payload."""
    client = get_tba_client()
    year = int(event_key[:4])
    current_year = date.today().year

    # Parallel fetch: event info, teams (full detail), rankings, OPRs, matches
    event_info, teams, rankings, oprs, epa_data, matches_raw = await asyncio.gather(
        _safe(client.get_event(event_key)),
        client.get_event_teams_full(event_key),
        _safe(client.get_event_rankings(event_key)),
        _safe(client.get_event_oprs(event_key)),
        _safe(get_epa_map(event_key)),
        _safe(client.get_event_matches(event_key)),
    )
    if epa_data is None:
        epa_data = {}

    if not teams:
        return {"error": "No teams found for this event."}

    # Determine the event's home country for foreign-team detection
    event_country = (event_info or {}).get("country", "") or ""

    # ── Demographics ────────────────────────────────────────
    total = len(teams)
    rookie_count = 0
    veteran_count = 0   # any team older than 1 year
    countries: set[str] = set()
    foreign_count = 0   # teams from a different country than the event
    team_ages: list[int] = []  # years since rookie_year for all teams

    for t in teams:
        ry = t.get("rookie_year")
        country = t.get("country", "") or ""
        if country:
            countries.add(country)
        # "Foreign" = different country from the event's host country
        if event_country and country and country != event_country:
            foreign_count += 1
        if ry:
            team_ages.append(year - ry)
        if ry and ry == year:
            rookie_count += 1
        elif ry and ry < year:
            veteran_count += 1

    avg_team_age = round(sum(team_ages) / len(team_ages), 1) if team_ages else 0

    demographics = {
        "total_teams": total,
        "rookie_count": rookie_count,
        "rookie_pct": round(100 * rookie_count / total, 1) if total else 0,
        "veteran_count": veteran_count,
        "veteran_pct": round(100 * veteran_count / total, 1) if total else 0,
        "avg_team_age": avg_team_age,
        "foreign_count": foreign_count,
        "foreign_pct": round(100 * foreign_count / total, 1) if total else 0,
        "event_country": event_country,
        "country_count": len(countries),
        "countries": sorted(countries),
    }

    # ── Hall of Fame & Impact Award (instant lookup from region_stats.json) ─
    _ensure_award_lookups()
    hof_teams = []
    impact_finalists = []
    for t in teams:
        num = t.get("team_number")
        info = {
            "team_number": num,
            "nickname": t.get("nickname", ""),
            "city": t.get("city", ""),
            "state_prov": t.get("state_prov", ""),
            "country": t.get("country", ""),
        }
        if num in _HOF_BY_NUM:
            hof_teams.append({**info, "impact_years": _HOF_BY_NUM[num].get("years", [])})
        elif num in _IMPACT_BY_NUM:
            impact_finalists.append({**info, "impact_years": _IMPACT_BY_NUM[num].get("years", [])})

    # ── Top 3 OPR contributors ──────────────────────────────
    top_scorers = _compute_top_scorers(teams, oprs, rankings, epa_data)

    # ── High scores (by match) ──────────────────────────────
    name_map_full = {f"frc{t['team_number']}": t.get("nickname", "") for t in teams}
    high_scores = _compute_high_scores(matches_raw, name_map_full)

    return {
        "event_key": event_key,
        "demographics": demographics,
        "hall_of_fame": hof_teams,
        "impact_finalists": impact_finalists,
        "top_scorers": top_scorers,
        "high_scores": high_scores,
    }


async def get_event_summary_awards(event_key: str) -> dict:
    """Deferred summary data — event history champions & previous-season awards.

    This is intentionally separated from the main summary so the UI can
    render the lightweight demographics / HoF / OPR data immediately and
    lazy-load this heavier section in the background.

    For championship divisions (event_type 3/4) the payload is different:
    instead of recurring-event champions and previous-season awards, we
    return current-season winners, impact recipients, and returning
    Einstein contenders.
    """
    client = get_tba_client()
    year = int(event_key[:4])

    # Parallel: event history + team list + event info (for type detection)
    event_history, teams, event_info = await asyncio.gather(
        _safe(get_event_history(event_key)),
        client.get_event_teams_full(event_key),
        _safe(client.get_event(event_key)),
    )
    current_event_type = (event_info or {}).get("event_type", -1)

    if not teams:
        return {"past_event_champions": [], "past_season_awards": []}

    # ── Championship division: specialised payload ──────────
    if current_event_type in _CHAMPIONSHIP_EVENT_TYPES:
        return await _build_champs_awards(client, teams, year)

    # ── Regular event flow ──────────────────────────────────
    # Fetch alliances for every historical event instance (parallel, nearly
    # free — piggybacked on the already-cached year scan inside get_event_history).
    alliance_cache: dict[str, list] = {}
    if event_history and event_history.get("timeline"):
        hist_keys = [yr["event_key"] for yr in event_history["timeline"]
                     if yr.get("event_key")]
        alliance_results = await asyncio.gather(
            *[_safe(client.get_event_alliances(ek)) for ek in hist_keys]
        )
        for ek, alliances in zip(hist_keys, alliance_results):
            if alliances:
                alliance_cache[ek] = alliances

    # Returning event champions & finalists (from event history)
    past_event_champions = _extract_past_event_champions(
        event_history, teams, year, alliance_cache,
    )

    # Previous season awards for all teams
    prev_year = year - 1
    prev_award_results = await asyncio.gather(
        *[_safe(client.get_team_awards_year(f"frc{t['team_number']}", prev_year))
          for t in teams]
    )
    past_season_awards = await _build_past_season_awards(
        client, teams, prev_award_results, prev_year,
    )

    return {
        "past_event_champions": past_event_champions,
        "past_season_awards": past_season_awards,
    }


# ── Advancement data ────────────────────────────────────────

_ADVANCEMENT_AWARD_TYPES = {
    0: "Impact Award",
    9: "Engineering Inspiration",
    10: "Rookie All-Star",
}


async def get_event_advancement(event_key: str) -> dict:
    """Build advancement data — event-level point standings, awards, winners,
    and (for district events) the overall district rankings."""
    client = get_tba_client()

    # Parallel fetch: event info, teams, district points, awards, alliances
    event_info, teams, dp_raw, awards_raw, alliances = await asyncio.gather(
        _safe(client.get_event(event_key)),
        client.get_event_teams_full(event_key),
        _safe(client.get(f"/event/{event_key}/district_points")),
        _safe(client.get(f"/event/{event_key}/awards")),
        _safe(client.get_event_alliances(event_key)),
    )

    if not teams:
        return {}

    ev = event_info or {}
    event_type_num = ev.get("event_type", -1)
    district_info = ev.get("district")
    is_district = event_type_num in (1, 2, 5)
    year = int(event_key[:4])

    name_map = {f"frc{t['team_number']}": t.get("nickname", "") for t in teams}
    team_nums = {t["team_number"] for t in teams}

    # ── All awards by team (for display) ────────────────────
    all_awards_by_team: dict[int, list[str]] = {}
    # Use TBA's award name directly — hardcoded mappings are unreliable
    # because TBA award_type numbers vary by event type (Regional vs District).
    if awards_raw and isinstance(awards_raw, list):
        for a in awards_raw:
            aname = a.get("name", f"Award #{a.get('award_type', '?')}")
            # Strip "Regional " / "District " prefix for cleaner display
            for prefix in ("Regional ", "District ", "Division "):
                if aname.startswith(prefix):
                    aname = aname[len(prefix):]
                    break
            for r in a.get("recipient_list", []):
                tk = r.get("team_key")
                if tk:
                    num = int(tk.replace("frc", ""))
                    all_awards_by_team.setdefault(num, []).append(aname)

    # ── For 2026+ regionals, use FRC v3.2 eventdetail (authoritative) ──
    if not is_district and year >= 2026:
        return await _build_regional_advancement(
            event_key, year, teams, name_map, team_nums,
            all_awards_by_team, dp_raw, awards_raw, alliances,
            client, ev, district_info,
        )

    # ── District / pre-2026 fallback: use TBA district_points ──
    point_standings = _build_tba_point_standings(dp_raw, name_map)

    # Advancement-qualifying awards
    advancement_awards = []
    if awards_raw and isinstance(awards_raw, list):
        for a in awards_raw:
            atype = a.get("award_type")
            if atype in _ADVANCEMENT_AWARD_TYPES:
                for r in a.get("recipient_list", []):
                    tk = r.get("team_key")
                    if tk:
                        num = int(tk.replace("frc", ""))
                        advancement_awards.append({
                            "team_number": num,
                            "nickname": name_map.get(tk, ""),
                            "award": _ADVANCEMENT_AWARD_TYPES[atype],
                        })

    # Event winners (winning alliance)
    event_winners = _extract_event_winners(alliances, name_map)

    # Build qualified_teams from TBA data (district / legacy)
    pts_map = {t["team_number"]: t for t in point_standings}
    qualified_teams = []
    seen_qualified: set[int] = set()
    for w in event_winners:
        num = w["team_number"]
        if num in seen_qualified:
            continue
        seen_qualified.add(num)
        pts = pts_map.get(num, {})
        qualified_teams.append({
            "team_number": num,
            "nickname": w["nickname"],
            "method": "Backup Bot" if w.get("is_backup") else "Event Winner",
            "total_points": pts.get("total", 0),
            "qual_points": pts.get("qual_points", 0),
            "alliance_points": pts.get("alliance_points", 0),
            "elim_points": pts.get("elim_points", 0),
            "award_points": pts.get("award_points", 0),
            "awards": all_awards_by_team.get(num, []),
        })
    for aa in advancement_awards:
        if aa["award"] != "Impact Award":
            continue
        num = aa["team_number"]
        if num in seen_qualified:
            continue
        seen_qualified.add(num)
        pts = pts_map.get(num, {})
        qualified_teams.append({
            "team_number": num,
            "nickname": aa["nickname"],
            "method": "Impact Award",
            "total_points": pts.get("total", 0),
            "qual_points": pts.get("qual_points", 0),
            "alliance_points": pts.get("alliance_points", 0),
            "elim_points": pts.get("elim_points", 0),
            "award_points": pts.get("award_points", 0),
            "awards": all_awards_by_team.get(num, []),
        })

    result: dict = {
        "event_type": "district" if is_district else "regional",
        "qualified_teams": qualified_teams,
        "point_standings": point_standings,
        "advancement_awards": advancement_awards,
        "event_winners": event_winners,
    }

    # ── District-wide rankings (one extra API call) ──────────
    if is_district and district_info and district_info.get("key"):
        dk = district_info["key"]
        dr_raw = await _safe(client.get(f"/district/{dk}/rankings"))
        if dr_raw and isinstance(dr_raw, list):
            district_rankings = []
            for dr in dr_raw:
                tk = dr.get("team_key", "")
                num = int(tk.replace("frc", "")) if tk.startswith("frc") else 0
                district_rankings.append({
                    "team_number": num,
                    "rank": dr.get("rank", 0),
                    "point_total": dr.get("point_total", 0),
                    "rookie_bonus": dr.get("rookie_bonus", 0),
                    "event_count": len(dr.get("event_points", [])),
                    "at_this_event": num in team_nums,
                })
            result["district_rankings"] = district_rankings
            result["district_name"] = (
                district_info.get("display_name")
                or district_info.get("abbreviation", "").upper()
            )

    # ── Regional cumulative points (2026+ with universal points) ─
    # NOTE: For 2026+ regionals the code takes the v3.2 fast-path above,
    # so this block only fires for pre-2026 regionals (unlikely).
    if not is_district and point_standings:
        yr = int(event_key[:4])
        if yr >= 2026:
            result["regional_season"] = await _build_regional_season_points(
                client, teams, event_key, yr
            )
            result["regional_pool"] = await _fetch_regional_pool_for_event(
                team_nums, yr
            )

    return result


# ─── helpers ────────────────────────────────────────────────

def _build_tba_point_standings(dp_raw, name_map) -> list[dict]:
    """Build point standings from TBA district_points response."""
    point_standings = []
    if dp_raw and isinstance(dp_raw, dict):
        pts = dp_raw.get("points", dp_raw)
        if isinstance(pts, dict):
            for tk, pt in pts.items():
                if not isinstance(pt, dict):
                    continue
                num = int(tk.replace("frc", ""))
                point_standings.append({
                    "team_number": num,
                    "nickname": name_map.get(tk, ""),
                    "qual_points": pt.get("qual_points", 0),
                    "alliance_points": pt.get("alliance_points", 0),
                    "elim_points": pt.get("elim_points", 0),
                    "award_points": pt.get("award_points", 0),
                    "total": pt.get("total", 0),
                })
    point_standings.sort(key=lambda x: x["total"], reverse=True)
    return point_standings


def _extract_event_winners(alliances, name_map) -> list[dict]:
    """Extract the winning alliance from TBA alliances data."""
    event_winners = []
    if alliances:
        for al in alliances:
            status = al.get("status", {})
            if isinstance(status, dict) and status.get("status") == "won":
                backup = al.get("backup") or {}
                backup_in = backup.get("in")
                for tk in al.get("picks", []):
                    num = int(tk.replace("frc", ""))
                    event_winners.append({
                        "team_number": num,
                        "nickname": name_map.get(tk, ""),
                        "is_backup": False,
                    })
                if backup_in:
                    num = int(backup_in.replace("frc", ""))
                    event_winners.append({
                        "team_number": num,
                        "nickname": name_map.get(backup_in, ""),
                        "is_backup": True,
                    })
                break
    return event_winners


async def _build_regional_advancement(
    event_key: str, year: int,
    teams: list[dict], name_map: dict, team_nums: set[int],
    all_awards_by_team: dict[int, list[str]],
    dp_raw, awards_raw, alliances,
    client, ev: dict, district_info,
) -> dict:
    """Build advancement for 2026+ regionals using the FRC v3.2 eventdetail
    endpoint, which has the authoritative regional point rankings and
    qualification flags (award points are weighted differently than TBA)."""
    from .frc_client import get_frc_client
    frc = get_frc_client()

    event_code = event_key[4:].upper()
    try:
        event_detail = await frc.get_regional_pool_event(year, event_code)
    except Exception:
        event_detail = None

    team_details = (event_detail or {}).get("teamDetails", [])

    if not team_details:
        # Fallback to TBA data if v3.2 is unavailable
        point_standings = _build_tba_point_standings(dp_raw, name_map)
        event_winners = _extract_event_winners(alliances, name_map)
        return {
            "event_type": "regional",
            "qualified_teams": [],
            "point_standings": point_standings,
            "event_winners": event_winners,
        }

    # ── Build point standings from FRC v3.2 (authoritative) ──
    point_standings = []
    qualified_teams = []
    for td in team_details:
        num = td.get("teamNumber", 0)
        rd = td.get("regionalDetails") or {}
        nickname = name_map.get(f"frc{num}", td.get("teamName", ""))

        entry = {
            "team_number": num,
            "nickname": nickname,
            "qual_points": rd.get("qualificationPerformancePoints", 0),
            "alliance_points": rd.get("allianceSelectionPoints", 0),
            "elim_points": rd.get("playoffAdvancementPoints", 0),
            "award_points": rd.get("awardPoints", 0),
            "total": td.get("regionalPoints", 0),
        }
        point_standings.append(entry)

        # Check if this team qualified at THIS event
        qualified = td.get("qualifiedFirstCmp", False)
        qual_event = (td.get("qualifiedFirstCmpEventCode") or "").upper()
        if qualified and qual_event == event_code:
            # Determine qualification method
            award_name = td.get("qualifiedFirstCmpAwardName")
            status = td.get("championshipStatus", "")
            week = td.get("qualifiedFirstCmpEventWeek")
            if award_name:
                method = award_name
            elif "Ranking" in status:
                method = "Directly Qualified"
            elif week is not None:
                method = f"Pool W{week}"
            else:
                method = "Qualified"

            qualified_teams.append({
                "team_number": num,
                "nickname": nickname,
                "method": method,
                "total_points": td.get("regionalPoints", 0),
                "qual_points": rd.get("qualificationPerformancePoints", 0),
                "alliance_points": rd.get("allianceSelectionPoints", 0),
                "elim_points": rd.get("playoffAdvancementPoints", 0),
                "award_points": rd.get("awardPoints", 0),
                "awards": all_awards_by_team.get(num, []),
            })

    point_standings.sort(key=lambda x: x["total"], reverse=True)
    qualified_teams.sort(key=lambda x: x["total_points"], reverse=True)

    event_winners = _extract_event_winners(alliances, name_map)

    return {
        "event_type": "regional",
        "qualified_teams": qualified_teams,
        "point_standings": point_standings,
        "event_winners": event_winners,
    }


async def _fetch_regional_pool_for_event(
    team_nums: set[int], year: int,
) -> list[dict]:
    """Return global regional pool rank + qualification status for
    teams at this event (uses FRC Events API v3.2)."""
    from .frc_client import get_frc_client
    frc = get_frc_client()
    try:
        all_teams = await frc.get_regional_pool(year)
    except Exception:
        return []
    # Filter to teams at this event
    result = []
    for t in all_teams:
        if t.get("teamNumber") in team_nums:
            result.append({
                "team_number": t["teamNumber"],
                "rank": t.get("rank"),
                "total_points": t.get("totalPoints"),
                "qualified": t.get("qualifiedFirstCmp", False),
                "declined": t.get("declinedFirstCmp", False),
                "status": t.get("championshipStatus", ""),
                "qual_method": t.get("qualifiedFirstCmpAwardName") or "",
            })
    result.sort(key=lambda x: x.get("rank") or 9999)
    return result


async def _build_regional_season_points(
    client, teams: list[dict], current_event_key: str, year: int,
) -> list[dict]:
    """Aggregate district-style points across all regionals for each team
    at this event (2026+ universal point system)."""
    team_keys = [f"frc{t['team_number']}" for t in teams]
    name_map = {f"frc{t['team_number']}": t.get("nickname", "") for t in teams}

    # Round 1: fetch each team's events for this year (parallel, cached)
    event_results = await asyncio.gather(
        *[_safe(client.get_team_events(tk, year)) for tk in team_keys]
    )

    # Collect unique event keys (skip current event, offseason, championship)
    _SKIP_TYPES = {3, 4, 99, 100, -1}
    unique_event_keys: set[str] = set()
    team_event_map: dict[str, list[str]] = {}  # team_key -> [event_keys]
    for tk, events in zip(team_keys, event_results):
        if not events:
            continue
        ek_list = []
        for ev in events:
            ek = ev.get("key", "")
            etype = ev.get("event_type", -1)
            if etype in _SKIP_TYPES:
                continue
            ek_list.append(ek)
            unique_event_keys.add(ek)
        team_event_map[tk] = ek_list

    if not unique_event_keys:
        return []

    # Round 2: fetch district_points for each unique event (parallel, cached)
    ek_list_unique = list(unique_event_keys)
    dp_results = await asyncio.gather(
        *[_safe(client.get(f"/event/{ek}/district_points")) for ek in ek_list_unique]
    )
    dp_cache: dict[str, dict] = {}
    for ek, dp_raw in zip(ek_list_unique, dp_results):
        if dp_raw and isinstance(dp_raw, dict):
            dp_cache[ek] = dp_raw.get("points", dp_raw)

    # Aggregate per team
    season_totals: dict[str, dict] = {}
    for tk in team_keys:
        total = 0
        events_played = 0
        for ek in team_event_map.get(tk, []):
            pts = dp_cache.get(ek, {})
            team_pts = pts.get(tk)
            if team_pts and isinstance(team_pts, dict):
                total += team_pts.get("total", 0)
                events_played += 1
        if events_played > 0:
            num = int(tk.replace("frc", ""))
            season_totals[tk] = {
                "team_number": num,
                "nickname": name_map.get(tk, ""),
                "season_total": total,
                "events_played": events_played,
            }

    result = sorted(season_totals.values(), key=lambda x: x["season_total"], reverse=True)
    # Add rank
    for i, entry in enumerate(result, 1):
        entry["rank"] = i
    return result


# ── Helpers for past-event and past-season award data ───────

def _extract_past_event_champions(
    event_history: dict | None, teams: list[dict], current_year: int,
    alliance_cache: dict | None = None,
) -> list[dict]:
    """Cross-reference the event's historical timeline with the current
    participant list to find teams that previously won / were finalists here.

    *alliance_cache* maps ``event_key`` to the raw TBA alliances list;
    when supplied, each year entry will include the team's alliance pick
    label (Captain / 1st Pick / …).
    """
    if not event_history or not event_history.get("timeline"):
        return []

    _PICK_LABELS = ['Captain', '1st Pick', '2nd Pick', '3rd Pick', 'Backup']
    if alliance_cache is None:
        alliance_cache = {}

    team_nums = {t["team_number"] for t in teams}
    name_map = {t["team_number"]: t.get("nickname", "") for t in teams}

    champ_map: dict[int, dict] = {}  # team_number -> {years_won, years_finalist}

    for yr_data in event_history["timeline"]:
        yr = yr_data["year"]
        ek = yr_data.get("event_key", "")
        if yr >= current_year:
            continue

        # Build team_key -> {pick_label, alliance_number} from alliances
        pick_map: dict[str, dict] = {}
        alliances_raw = alliance_cache.get(ek, [])
        if alliances_raw:
            for al in alliances_raw:
                name_parts = (al.get("name") or "").split()
                al_num = al.get("number") or (name_parts[-1] if name_parts else "")
                backup_in = (al.get("backup") or {}).get("in")
                for idx, tk in enumerate(al.get("picks", [])):
                    if idx < len(_PICK_LABELS):
                        label = "Backup" if tk == backup_in else _PICK_LABELS[idx]
                        pick_map[tk] = {"pick": label, "alliance": al_num}

        for w in yr_data.get("winners", []):
            num = w["team_number"]
            if num in team_nums:
                champ_map.setdefault(num, {"years_won": [], "years_finalist": []})
                info = pick_map.get(f"frc{num}", {})
                champ_map[num]["years_won"].append(
                    {"year": yr, "pick": info.get("pick", ""), "alliance": info.get("alliance", "")}
                )

        for f in yr_data.get("finalists", []):
            num = f["team_number"]
            if num in team_nums:
                champ_map.setdefault(num, {"years_won": [], "years_finalist": []})
                info = pick_map.get(f"frc{num}", {})
                champ_map[num]["years_finalist"].append(
                    {"year": yr, "pick": info.get("pick", ""), "alliance": info.get("alliance", "")}
                )

    result = []
    for num in sorted(champ_map):
        d = champ_map[num]
        result.append({
            "team_number": num,
            "nickname": name_map.get(num, ""),
            "years_won": sorted(d["years_won"], key=lambda x: x["year"]),
            "years_finalist": sorted(d["years_finalist"], key=lambda x: x["year"]),
        })
    return result


_AWARD_TYPE_IMPACT = 0
_AWARD_TYPE_WINNER = 1
_AWARD_TYPE_FINALIST = 2
_CHAMPIONSHIP_EVENT_TYPES = {3, 4}  # Championship Division / Finals
_EINSTEIN_EVENT_TYPE = 4             # Championship Finals (Einstein)


async def _build_champs_awards(
    client, teams: list[dict], year: int,
) -> dict:
    """Build the awards payload for a championship division event.

    Returns three lists instead of the normal past-event/past-season pair:
    * **season_winners** — teams that won a regional/district event this season
    * **season_impact** — teams that won the Impact Award this season
    * **einstein_contenders** — teams that competed on Einstein in a prior year
    """
    _PICK_LABELS = ['Captain', '1st Pick', '2nd Pick', '3rd Pick', 'Backup']
    name_map = {t["team_number"]: t.get("nickname", "") for t in teams}
    team_nums = {t["team_number"] for t in teams}

    # ── 1) Current-season awards for every team (parallel) ──
    award_results = await asyncio.gather(
        *[_safe(client.get_team_awards_year(f"frc{t['team_number']}", year))
          for t in teams]
    )

    winners: dict[int, list[dict]] = {}   # team_num -> [{event_key, event_name, pick, alliance}]
    impact: dict[int, list[dict]] = {}    # team_num -> [{event_key, event_name}]
    alliance_event_keys: set[str] = set()
    award_event_keys: set[str] = set()

    for t, awards in zip(teams, award_results):
        if not awards:
            continue
        num = t["team_number"]
        for a in awards:
            atype = a.get("award_type")
            ek = a.get("event_key", "")
            if atype == _AWARD_TYPE_IMPACT:
                impact.setdefault(num, []).append({"event_key": ek})
                award_event_keys.add(ek)
            elif atype == _AWARD_TYPE_WINNER:
                winners.setdefault(num, []).append({"event_key": ek})
                award_event_keys.add(ek)
                alliance_event_keys.add(ek)

    # Batch-fetch event info + alliances for winner events
    ek_list = sorted(award_event_keys)
    alliance_ek_list = sorted(alliance_event_keys)
    info_results, *alliance_results = await asyncio.gather(
        asyncio.gather(*[_safe(client.get_event(ek)) for ek in ek_list]),
        *[_safe(client.get_event_alliances(ek)) for ek in alliance_ek_list],
    )

    event_names: dict[str, str] = {}
    event_types: dict[str, int] = {}
    for ek, info in zip(ek_list, info_results):
        if info:
            event_names[ek] = info.get("short_name") or info.get("name", ek)
            event_types[ek] = info.get("event_type", -1)
        else:
            event_names[ek] = ek
            event_types[ek] = -1

    # Build pick maps (team_key -> {pick, alliance}) for winner events
    pick_maps: dict[str, dict[str, dict]] = {}
    for ek, alliances in zip(alliance_ek_list, alliance_results):
        if not alliances:
            continue
        pm: dict[str, dict] = {}
        for al in alliances:
            name_parts = (al.get("name") or "").split()
            al_num = al.get("number") or (name_parts[-1] if name_parts else "")
            backup_in = (al.get("backup") or {}).get("in")
            for idx, tk in enumerate(al.get("picks", [])):
                if idx < len(_PICK_LABELS):
                    label = "Backup" if tk == backup_in else _PICK_LABELS[idx]
                    pm[tk] = {"pick": label, "alliance": al_num}
        pick_maps[ek] = pm

    # Assemble season_winners (exclude champs-level wins)
    season_winners = []
    for num in sorted(winners):
        entries = []
        for w in winners[num]:
            ek = w["event_key"]
            if event_types.get(ek) in _CHAMPIONSHIP_EVENT_TYPES:
                continue
            info = pick_maps.get(ek, {}).get(f"frc{num}", {})
            entry: dict = {
                "type": "winner",
                "event_key": ek,
                "event_name": event_names.get(ek, ek),
            }
            if info.get("pick"):
                entry["pick"] = info["pick"]
                entry["alliance"] = info.get("alliance", "")
            entries.append(entry)
        if entries:
            season_winners.append({
                "team_number": num,
                "nickname": name_map.get(num, ""),
                "awards": entries,
            })

    # Assemble season_impact (exclude champs-level)
    season_impact = []
    for num in sorted(impact):
        entries = []
        for a in impact[num]:
            ek = a["event_key"]
            if event_types.get(ek) in _CHAMPIONSHIP_EVENT_TYPES:
                continue
            entries.append({
                "type": "impact",
                "event_key": ek,
                "event_name": event_names.get(ek, ek),
            })
        if entries:
            season_impact.append({
                "team_number": num,
                "nickname": name_map.get(num, ""),
                "awards": entries,
            })

    # ── 2) Returning Einstein contenders ────────────────────
    # Find all Einstein (type 4) events from the previous year, then
    # check which of *this division's* teams competed there.
    prev_year = year - 1
    prev_events = await _safe(client.get_events_by_year(prev_year))
    einstein_keys = [
        ev["key"] for ev in (prev_events or [])
        if ev.get("event_type") == _EINSTEIN_EVENT_TYPE
    ]

    einstein_contenders: list[dict] = []
    if einstein_keys:
        einstein_team_results = await asyncio.gather(
            *[_safe(client.get_event_teams(ek)) for ek in einstein_keys]
        )
        prev_einstein_teams: set[int] = set()
        for ek_teams in einstein_team_results:
            if ek_teams:
                for et in ek_teams:
                    num = et.get("team_number")
                    if num:
                        prev_einstein_teams.add(num)

        for num in sorted(team_nums & prev_einstein_teams):
            einstein_contenders.append({
                "team_number": num,
                "nickname": name_map.get(num, ""),
            })

    return {
        "is_championship": True,
        "season_winners": season_winners,
        "season_impact": season_impact,
        "einstein_contenders": einstein_contenders,
    }


async def _build_past_season_awards(
    client, teams: list[dict], prev_award_results: list, prev_year: int,
    *, include_champs: bool = False,
) -> list[dict]:
    """Given per-team award results for the previous season, return a list
    of teams that earned Impact / Winner / Finalist.  Championship-level
    awards are included when *include_champs* is True (i.e. the current
    event is itself a championship division or finals)."""
    _PICK_LABELS = ['Captain', '1st Pick', '2nd Pick', '3rd Pick', 'Backup']
    name_map = {t["team_number"]: t.get("nickname", "") for t in teams}
    team_award_map: dict[int, list[dict]] = {}
    award_event_keys: set[str] = set()
    # Track which events have winner/finalist awards (need alliances)
    alliance_event_keys: set[str] = set()

    for t, awards in zip(teams, prev_award_results):
        if not awards:
            continue
        num = t["team_number"]
        for a in awards:
            atype = a.get("award_type")
            if atype not in (_AWARD_TYPE_IMPACT, _AWARD_TYPE_WINNER, _AWARD_TYPE_FINALIST):
                continue
            ek = a.get("event_key", "")
            label = {0: "impact", 1: "winner", 2: "finalist"}.get(atype, "")
            team_award_map.setdefault(num, []).append({"type": label, "event_key": ek})
            award_event_keys.add(ek)
            if atype in (_AWARD_TYPE_WINNER, _AWARD_TYPE_FINALIST):
                alliance_event_keys.add(ek)

    if not team_award_map:
        return []

    # Batch-fetch event info + alliances (for winner/finalist pick labels)
    ek_list = list(award_event_keys)
    alliance_ek_list = list(alliance_event_keys)
    infos, *alliance_results = await asyncio.gather(
        asyncio.gather(*[_safe(client.get_event(ek)) for ek in ek_list]),
        *[_safe(client.get_event_alliances(ek)) for ek in alliance_ek_list],
    )

    event_names: dict[str, str] = {}
    event_types: dict[str, int] = {}
    for ek, info in zip(ek_list, infos):
        if info:
            event_names[ek] = info.get("short_name") or info.get("name", ek)
            event_types[ek] = info.get("event_type", -1)
        else:
            event_names[ek] = ek
            event_types[ek] = -1

    # Build team_key -> {pick, alliance} for each event
    pick_maps: dict[str, dict[str, dict]] = {}
    for ek, alliances in zip(alliance_ek_list, alliance_results):
        if not alliances:
            continue
        pm: dict[str, dict] = {}
        for al in alliances:
            name_parts = (al.get("name") or "").split()
            al_num = al.get("number") or (name_parts[-1] if name_parts else "")
            backup_in = (al.get("backup") or {}).get("in")
            for idx, tk in enumerate(al.get("picks", [])):
                if idx < len(_PICK_LABELS):
                    label = "Backup" if tk == backup_in else _PICK_LABELS[idx]
                    pm[tk] = {"pick": label, "alliance": al_num}
        pick_maps[ek] = pm

    result = []
    for num in sorted(team_award_map):
        filtered = []
        for a in team_award_map[num]:
            ek = a["event_key"]
            if not include_champs and event_types.get(ek) in _CHAMPIONSHIP_EVENT_TYPES:
                continue
            info = {}
            if a["type"] in ("winner", "finalist"):
                info = pick_maps.get(ek, {}).get(f"frc{num}", {})
            entry: dict = {
                "type": a["type"],
                "event_key": ek,
                "event_name": event_names.get(ek, ek),
            }
            if info.get("pick"):
                entry["pick"] = info["pick"]
                entry["alliance"] = info.get("alliance", "")
            filtered.append(entry)
        if filtered:
            result.append({
                "team_number": num,
                "nickname": name_map.get(num, ""),
                "awards": filtered,
            })
    return result


async def get_event_summary_stats(event_key: str) -> dict:
    """Lighter refresh — just OPR/rankings-based stats (no history scan)."""
    client = get_tba_client()
    # Clear cache for rankings/OPRs/matches so we get fresh data
    for suffix in ["/rankings", "/oprs", "/matches"]:
        endpoint = f"/event/{event_key}{suffix}"
        if endpoint in client._cache:
            del client._cache[endpoint]

    teams, rankings, oprs, epa_data, matches_raw = await asyncio.gather(
        client.get_event_teams(event_key),
        _safe(client.get_event_rankings(event_key)),
        _safe(client.get_event_oprs(event_key)),
        _safe(get_epa_map(event_key)),
        _safe(client.get_event_matches(event_key)),
    )
    if epa_data is None:
        epa_data = {}

    name_map = {t["key"]: t.get("nickname", "") for t in (teams or [])}
    return {
        "top_scorers": _compute_top_scorers(teams, oprs, rankings, epa_data),
        "high_scores": _compute_high_scores(matches_raw, name_map),
    }


def _compute_top_scorers(teams, oprs, rankings, epa_data: dict | None = None) -> list[dict]:
    """Return top-3 teams by OPR."""
    if not oprs or not oprs.get("oprs"):
        return []
    if epa_data is None:
        epa_data = {}

    name_map = {t["key"]: t for t in (teams or [])}
    rank_map: dict[str, int] = {}
    if rankings and rankings.get("rankings"):
        for r in rankings["rankings"]:
            rank_map[r["team_key"]] = r.get("rank", 0)

    scored = []
    for tk, opr_val in oprs["oprs"].items():
        t = name_map.get(tk, {})
        epa_info = epa_data.get(tk, {})
        scored.append({
            "team_key": tk,
            "team_number": t.get("team_number", int(tk.replace("frc", ""))),
            "nickname": t.get("nickname", ""),
            "opr": round(opr_val, 2),
            "epa": epa_info.get("epa"),
            "rank": rank_map.get(tk, "-"),
        })

    scored.sort(key=lambda x: x["opr"], reverse=True)
    return scored[:3]


_COMP_LEVEL_LABELS_SHORT = {
    "qm": "Qual", "ef": "Eighths", "qf": "QF",
    "sf": "SF", "f": "F",
}


def _match_label(m: dict) -> str:
    """Build a human-friendly match label, e.g. 'Qual 42' or 'SF 2-1'."""
    cl = m.get("comp_level", "qm")
    prefix = _COMP_LEVEL_LABELS_SHORT.get(cl, cl.upper())
    mn = m.get("match_number", "?")
    if cl == "qm":
        return f"{prefix} {mn}"
    sn = m.get("set_number", "")
    return f"{prefix} {sn}-{mn}" if sn else f"{prefix} {mn}"


def _compute_high_scores(matches_raw: list | None, name_map: dict) -> list[dict]:
    """Return top-3 highest single-alliance scores across all completed matches."""
    if not matches_raw:
        return []

    entries: list[dict] = []
    for m in matches_raw:
        # Skip unplayed matches
        if m.get("winning_alliance") is None and m.get("alliances", {}).get("red", {}).get("score", -1) < 0:
            continue
        for color in ("red", "blue"):
            alliance = m.get("alliances", {}).get(color, {})
            score = alliance.get("score", -1)
            if score <= 0:
                continue
            team_keys = alliance.get("team_keys", [])
            teams = []
            for tk in team_keys:
                num = int(tk.replace("frc", ""))
                teams.append({
                    "team_number": num,
                    "nickname": name_map.get(tk, ""),
                })
            entries.append({
                "score": score,
                "match": _match_label(m),
                "match_key": m.get("key", ""),
                "color": color,
                "teams": teams,
            })

    entries.sort(key=lambda x: x["score"], reverse=True)
    return entries[:3]


COMP_LEVEL_LABELS = {
    "qm": "Quals", "ef": "Eighths", "qf": "Quarters",
    "sf": "Semi-Finals", "f": "Finals",
}

# Double-elimination bracket (2023+): set_number → (round, bracket)
_DOUBLE_ELIM_MAP = {
    1: (1, "Upper"), 2: (1, "Upper"), 3: (1, "Upper"), 4: (1, "Upper"),
    5: (2, "Lower"), 6: (2, "Lower"), 7: (2, "Upper"), 8: (2, "Upper"),
    9: (3, "Lower"), 10: (3, "Lower"),
    11: (4, "Upper"), 12: (4, "Lower"),
    13: (5, "Lower"),
}
_DOUBLE_ELIM_ROUND_LABELS = {
    1: "Round 1", 2: "Round 2", 3: "Round 3",
    4: "Semis", 5: "Semis",
}


def _resolve_de_stage(match: dict) -> tuple[int, str]:
    """Return (order, label) for a double-elim match based on set_number."""
    cl = match.get("comp_level", "qm")
    if cl == "f":
        return (10, "Finals")
    sn = match.get("set_number", 0)
    if cl == "sf" and sn in _DOUBLE_ELIM_MAP:
        rnd, bracket = _DOUBLE_ELIM_MAP[sn]
        label = _DOUBLE_ELIM_ROUND_LABELS.get(rnd, f"Round {rnd}")
        return (rnd, f"{label} ({bracket})")
    # Fallback for non-double-elim comp_levels
    order = {"ef": 1, "qf": 2, "sf": 3, "f": 4}.get(cl, 0)
    return (order, COMP_LEVEL_LABELS.get(cl, cl))


async def get_event_connections(event_key: str, all_time: bool = False) -> list[dict]:
    """Public entry point to fetch connections with configurable lookback."""
    client = get_tba_client()
    year = int(event_key[:4])
    teams = await client.get_event_teams_full(event_key)
    if not teams:
        return []
    lookback = None if all_time else 3
    return await _find_playoff_connections(teams, event_key, year, lookback_years=lookback)


async def get_match_connections(event_key: str, team_numbers: list[int], all_time: bool = False) -> list[dict]:
    """Fetch prior playoff connections for a specific set of teams (e.g. the 6 on the field)."""
    client = get_tba_client()
    year = int(event_key[:4])
    # Build minimal team dicts from team numbers
    team_keys = [f"frc{n}" for n in team_numbers]
    tasks = [client.get_team(tk) for tk in team_keys]
    raw_teams = await asyncio.gather(*tasks)
    teams = [t for t in raw_teams if t]
    if not teams:
        return []
    lookback = None if all_time else 3
    return await _find_playoff_connections(teams, event_key, year, lookback_years=lookback)


async def _find_playoff_connections(
    teams: list[dict], event_key: str, year: int, lookback_years: int | None = 3
) -> list[dict]:
    """Find pairs of teams at this event who have prior playoff history.
    
    lookback_years: number of past seasons to check, or None for all-time (back to rookie year).
    """
    client = get_tba_client()
    team_keys = [t["key"] for t in teams]
    name_map = {t["key"]: t.get("nickname", "") for t in teams}

    if lookback_years is not None:
        # Include current year so earlier events in the same season count
        check_years = list(range(max(2015, year - lookback_years), year + 1))
    else:
        # All-time: go back to the earliest rookie year among the teams
        rookie_years = [t.get("rookie_year", year) for t in teams if t.get("rookie_year")]
        earliest = min(rookie_years) if rookie_years else 2015
        check_years = list(range(max(2000, earliest), year + 1))

    if not check_years:
        return []

    # Build event lists per team for the check years
    async def _events_for(tk: str, y: int):
        data = await _safe(client.get_team_events(tk, y))
        return (tk, y, data or [])

    tasks = []
    for tk in team_keys:
        for y in check_years:
            tasks.append(_events_for(tk, y))

    results = await asyncio.gather(*tasks)

    # team -> set of event_keys (excluding current and offseason/preseason)
    # Also build event name map from fetched data
    _SKIP_EVENT_TYPES = {99, 100, -1}  # Offseason, Preseason, Unknown
    team_events: dict[str, set[str]] = {}
    event_name_map: dict[str, str] = {}  # event_key -> short/display name
    for tk, _y, events in results:
        if tk not in team_events:
            team_events[tk] = set()
        for ev in events:
            ek = ev["key"]
            if ev.get("event_type", -1) in _SKIP_EVENT_TYPES:
                continue
            if ek != event_key:
                team_events[tk].add(ek)
            if ek not in event_name_map:
                event_name_map[ek] = ev.get("short_name") or ev.get("name", ek)

    # Find pairs with common events
    common_events_to_fetch: set[str] = set()
    pair_common: dict[tuple[str, str], set[str]] = {}
    for i in range(len(team_keys)):
        for j in range(i + 1, len(team_keys)):
            ta, tb = team_keys[i], team_keys[j]
            common = team_events.get(ta, set()) & team_events.get(tb, set())
            if common:
                pair_common[(ta, tb)] = common
                common_events_to_fetch.update(common)

    if not common_events_to_fetch:
        return []

    # Fetch alliance data for those events
    async def _alliances_for(ek: str):
        data = await _safe(client.get_event_alliances(ek))
        return (ek, data)

    alliance_results = await asyncio.gather(
        *[_alliances_for(ek) for ek in common_events_to_fetch]
    )
    alliance_cache = {ek: data for ek, data in alliance_results if data}

    # Also fetch matches to check playoff opponents
    async def _matches_for(ek: str):
        data = await _safe(client.get_event_matches(ek))
        return (ek, data)

    match_results = await asyncio.gather(
        *[_matches_for(ek) for ek in common_events_to_fetch]
    )
    match_cache = {ek: data for ek, data in match_results if data}

    connections = []
    seen_pairs: set[str] = set()

    for (ta, tb), common in pair_common.items():
        pair_id = f"{ta}+{tb}"
        if pair_id in seen_pairs:
            continue

        partner_events = []
        opponent_events = []

        for ek in common:
            event_year = int(ek[:4])

            # Check partnership (same alliance) — find highest stage reached together
            were_partners = False
            alliance_result = None  # "winner", "finalist", or None
            for al in alliance_cache.get(ek, []):
                picks = al.get("picks", [])
                if ta in picks and tb in picks:
                    were_partners = True
                    # Check alliance playoff result
                    status = al.get("status", {})
                    if isinstance(status, dict):
                        s = status.get("status", "")
                        if s == "won":
                            alliance_result = "winner"
                        elif status.get("level", "") == "f":
                            alliance_result = "finalist"
                    break

            if were_partners:
                # Find highest playoff stage they played together
                partner_highest_label = None
                partner_highest_order = -1
                is_de = event_year >= 2023
                for m in match_cache.get(ek, []):
                    cl = m.get("comp_level", "qm")
                    if cl == "qm":
                        continue
                    red = m.get("alliances", {}).get("red", {}).get("team_keys", [])
                    blue = m.get("alliances", {}).get("blue", {}).get("team_keys", [])
                    if (ta in red and tb in red) or (ta in blue and tb in blue):
                        if is_de:
                            order, label = _resolve_de_stage(m)
                        else:
                            order = {"ef": 1, "qf": 2, "sf": 3, "f": 4}.get(cl, 0)
                            label = COMP_LEVEL_LABELS.get(cl, cl)
                        if order > partner_highest_order:
                            partner_highest_order = order
                            partner_highest_label = label

                partner_events.append({
                    "event_key": ek,
                    "event_name": event_name_map.get(ek, ek),
                    "year": event_year,
                    "stage": partner_highest_label or "Alliance",
                    "result": alliance_result,
                })

            # Check playoff opponents — capture highest comp_level
            highest_label = None
            highest_order = -1
            is_de = event_year >= 2023
            for m in match_cache.get(ek, []):
                cl = m.get("comp_level", "qm")
                if cl == "qm":
                    continue
                red = m.get("alliances", {}).get("red", {}).get("team_keys", [])
                blue = m.get("alliances", {}).get("blue", {}).get("team_keys", [])
                if (ta in red and tb in blue) or (ta in blue and tb in red):
                    if is_de:
                        order, label = _resolve_de_stage(m)
                    else:
                        order = {"ef": 1, "qf": 2, "sf": 3, "f": 4}.get(cl, 0)
                        label = COMP_LEVEL_LABELS.get(cl, cl)
                    if order > highest_order:
                        highest_order = order
                        highest_label = label

            if highest_label:
                opponent_events.append({
                    "event_key": ek,
                    "event_name": event_name_map.get(ek, ek),
                    "year": event_year,
                    "stage": highest_label,
                })

        if partner_events or opponent_events:
            seen_pairs.add(pair_id)

            # Deduplicate per event — keep only the highest stage per event_key
            def _stage_rank(stage: str) -> int:
                _STATIC = {"Alliance": 0, "Playoffs": 0, "Eighths": 1, "Quarters": 2, "Semi-Finals": 3, "Semis": 3, "Finals": 4}
                if stage in _STATIC:
                    return _STATIC[stage]
                # Handle "Round N (Upper/Lower)" and "Semis (Upper/Lower)"
                if stage.startswith("Round "):
                    return int(stage.split()[1].rstrip(")")) if stage.split()[1][0].isdigit() else 3
                if stage.startswith("Semis"):
                    return 3
                return 0

            def _dedup_by_event(events):
                best: dict[str, dict] = {}
                for e in events:
                    ek = e["event_key"]
                    if ek not in best or _stage_rank(e["stage"]) > _stage_rank(best[ek]["stage"]):
                        best[ek] = e
                return sorted(best.values(), key=lambda x: x["year"], reverse=True)

            connections.append({
                "team_a": int(ta.replace("frc", "")),
                "team_a_name": name_map.get(ta, ""),
                "team_b": int(tb.replace("frc", "")),
                "team_b_name": name_map.get(tb, ""),
                "partnered_at": _dedup_by_event(partner_events),
                "opponents_at": _dedup_by_event(opponent_events),
            })

    # Sort by most connections
    connections.sort(
        key=lambda c: len(c["partnered_at"]) + len(c["opponents_at"]),
        reverse=True,
    )
    return connections
