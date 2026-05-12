"""Event endpoints — info, teams with stats, summary, season list, compare."""
from fastapi import APIRouter, HTTPException, Query
from typing import List
from ..services import event_service
from ..services import summary_service
from ..services import region_service
from ..services import world_record_service
from ..services import payload_cache
from ..services.tba_client import get_tba_client
from ..services.frc_client import get_frc_client
from ..services.statbotics_client import get_statbotics_client
from ..services.alliance_service import get_alliances_with_stats
from ..services.gatool_client import get_gatool_client
from ..services.error_utils import raise_api_error
from ..services.supabase_client import get_season_record, set_season_record
import asyncio

router = APIRouter()


@router.get("/world-record")
async def world_record():
    """Return the season world high score (highest single-alliance match score)."""
    try:
        await world_record_service.seed_from_tba()
        rec = world_record_service.get_world_record()
        if not rec:
            return {"score": 0}
        return rec
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not load world record.")


@router.get("/season-high-scores")
async def season_high_scores(year: int = Query(2026)):
    """Top match scores and top EPA teams for a season (from Statbotics)."""
    try:
        # 1. Disk cache — Statbotics data changes infrequently
        cached = payload_cache.read_payload("season_high", str(year), 600)
        if cached:
            return cached

        # Keep stale data on hand so we can fall back if Statbotics is down
        stale = payload_cache.read_stale("season_high", str(year))

        # 2. Supabase cache — survives process restarts / cold starts
        sb_row = await get_season_record(f"frc_season_high_{year}")
        if sb_row and sb_row.get("payload"):
            payload = sb_row["payload"]
            payload_cache.write_payload("season_high", str(year), payload)
            return payload

        try:
            sb = get_statbotics_client()
            data = await sb.get_season_high_scores(year, limit=10)

            # Resolve event keys → friendly names from season data
            event_names: dict[str, str] = {}
            try:
                events = await event_service.get_season_events(year)
                for ev in events:
                    event_names[ev.get("key", "")] = ev.get("short_name") or ev.get("name") or ev.get("key", "")
            except Exception:
                pass

            for m in data.get("matches", []):
                ek = m.get("event_key", "")
                m["event_name"] = event_names.get(ek, ek)
                # Pretty match label from key (e.g. 2026caclv_sf1m1 → SF1-1)
                raw = m.get("key", "")
                m["match_label"] = _parse_match_label(raw)

            payload_cache.write_payload("season_high", str(year), data)
            asyncio.create_task(
                set_season_record(f"frc_season_high_{year}", year, "frc_season_high_scores", data)
            )
            return data
        except Exception:
            if stale:
                return stale
            raise
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load season high scores for {year}.")


@router.get("/season-most-wins")
async def season_most_wins(year: int = Query(2026), limit: int = Query(10, ge=1, le=50)):
    """Top teams by win count for a season (from Statbotics)."""
    try:
        cache_key = f"{year}_{limit}"
        cached = payload_cache.read_payload("season_most_wins", cache_key, 600)
        if cached:
            return cached.get("teams", [])

        sb = get_statbotics_client()
        teams = await sb.get_most_wins(year, limit=limit)
        data = {"teams": teams}

        payload_cache.write_payload("season_most_wins", cache_key, data)
        return teams
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load most wins for {year}.")


def _parse_match_label(match_key: str) -> str:
    """Convert a TBA match key suffix into a readable label.

    Examples: 2026abc_qm42 → QM 42, 2026abc_sf1m1 → SF1-1, 2026abc_f1m2 → F1-2
    """
    parts = match_key.split("_")
    if len(parts) < 2:
        return match_key
    raw = parts[-1]  # e.g. "sf1m1", "qm42", "f1m2"
    import re
    m = re.match(r"([a-z]+)(\d+)(?:m(\d+))?", raw)
    if not m:
        return raw
    comp, num1, num2 = m.group(1), m.group(2), m.group(3)
    labels = {"qm": "QM", "sf": "SF", "f": "F", "qf": "QF", "ef": "EF"}
    prefix = labels.get(comp, comp.upper())
    if num2:
        return f"{prefix}{num1}-{num2}"
    return f"{prefix} {num1}"


@router.get("/season/{year}")
async def season_events(year: int, include_offseason: bool = Query(False)):
    try:
        return await event_service.get_season_events(year, include_offseason=include_offseason)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load season {year} events.")


@router.get("/{event_key}/info")
async def event_info(event_key: str):
    try:
        return await event_service.get_event_info(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load event info for '{event_key}'.")


@router.get("/{event_key}/teams")
async def event_teams(event_key: str):
    try:
        return await event_service.get_event_teams_with_stats(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load teams for event '{event_key}'.")


@router.get("/{event_key}/summary")
async def event_summary(event_key: str):
    try:
        result = await summary_service.get_event_summary(event_key)
        if "error" in result:
            raise HTTPException(status_code=404, detail=result["error"])
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load summary for event '{event_key}'.")


@router.get("/{event_key}/summary/refresh-stats")
async def event_summary_refresh_stats(event_key: str):
    try:
        # Invalidate the summary disk cache so the next full load is fresh
        payload_cache.invalidate("summary", event_key)
        return await summary_service.get_event_summary_stats(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not refresh stats for event '{event_key}'.")


@router.get("/{event_key}/summary/awards")
async def event_summary_awards(event_key: str):
    """Deferred: past event champions & previous-season award winners."""
    try:
        return await summary_service.get_event_summary_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load awards for event '{event_key}'.")


@router.get("/{event_key}/summary/season-awards")
async def event_season_awards(event_key: str):
    """Current-season Impact/Winner/Finalist awards earned at prior events for teams at this event."""
    try:
        return await summary_service.get_current_season_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load season awards for event '{event_key}'.")


@router.get("/{event_key}/summary/advancement")
async def event_summary_advancement(event_key: str):
    """Deferred: advancement point standings, awards, winners, district rankings."""
    try:
        return await summary_service.get_event_advancement(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load advancement data for event '{event_key}'.")


@router.get("/{event_key}/summary/connections")
async def event_connections(
    event_key: str,
    all_time: bool = Query(False, description="Search all-time instead of last 3 years"),
    teams: str = Query(None, description="Comma-separated team numbers to check (e.g. '254,1678,118'). If omitted, checks all teams at the event."),
):
    try:
        if teams:
            team_numbers = [int(t.strip()) for t in teams.split(",") if t.strip()]
            return await summary_service.get_match_connections(event_key, team_numbers, all_time=all_time)
        return await summary_service.get_event_connections(event_key, all_time=all_time)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load connections for event '{event_key}'.")


@router.get("/{event_key}/refresh")
async def refresh_event(event_key: str):
    """Full refresh — clears all TBA + disk caches for an event and rebuilds.

    Use when data may be stale (e.g. a team won an award between polls)
    and the user wants the latest data immediately.
    """
    try:
        # 1. Clear TBA in-memory cache for this event
        client = get_tba_client()
        client.clear_cache_for(
            f"/event/{event_key}",
            f"/event/{event_key}/teams",
            f"/event/{event_key}/oprs",
            f"/event/{event_key}/rankings",
            f"/event/{event_key}/matches",
            f"/event/{event_key}/alliances",
            f"/event/{event_key}/awards",
        )

        # 2. Clear disk caches (summary, awards, snapshot)
        payload_cache.invalidate("summary", event_key)
        payload_cache.invalidate("awards", event_key)
        from .snapshot import invalidate_snapshot
        invalidate_snapshot(event_key)

        # 3. Rebuild snapshot (pulls fresh data from TBA)
        from .snapshot import _build_snapshot, _write_snapshot
        payload = await _build_snapshot(event_key)
        _write_snapshot(event_key, payload)

        return {"status": "refreshed", "event_key": event_key}
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not refresh event '{event_key}'.")


@router.get("/{event_key}/clear-cache")
async def clear_cache(event_key: str):
    try:
        get_tba_client().clear_cache()
        # Also clear disk-level caches for this event
        payload_cache.invalidate("summary", event_key)
        payload_cache.invalidate("awards", event_key)
        from .snapshot import invalidate_snapshot
        invalidate_snapshot(event_key)
        return {"status": "cache cleared"}
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not clear cache.")


@router.get("/{event_key}/refresh-rankings")
async def refresh_rankings(event_key: str):
    """Clear cached rankings/OPRs/teams for an event, then return fresh data."""
    client = get_tba_client()
    client.clear_cache_for(
        f"/event/{event_key}/rankings",
        f"/event/{event_key}/oprs",
        f"/event/{event_key}/teams",
    )
    try:
        return await event_service.get_event_teams_with_stats(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not refresh rankings for event '{event_key}'.")


@router.get("/{event_key}/fast-rankings")
async def fast_rankings(event_key: str):
    """Lightweight rankings from FRC Events API — rank, W-L-T, RP only.

    Much faster than /refresh-rankings because it skips avatars/OPRs/EPA
    and uses the FRC API (real-time from FIRST) instead of TBA.
    """
    try:
        return await event_service.get_fast_rankings(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load rankings for event '{event_key}'.")


@router.get("/{event_key}/compare")
async def compare_teams(
    event_key: str,
    teams: str = Query(..., description="Comma-separated team keys, e.g. frc254,frc1678"),
):
    """Compare 2-6 teams at an event with enriched stats."""
    try:
        return await event_service.get_team_comparison(event_key, teams)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not compare the requested teams.")


# ═══════════════════════════════════════════════════════════
#  Regional Advancement Pool (FRC Events API v3.2)
# ═══════════════════════════════════════════════════════════

@router.get("/regional-pool/{season}")
async def regional_pool(season: int):
    """Global regional advancement pool rankings for a season."""
    try:
        teams = await get_frc_client().get_regional_pool(season)
        return {"season": season, "teams": teams}
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load regional pool for season {season}.")


@router.get("/regional-pool/{season}/{event_code}")
async def regional_pool_event(season: int, event_code: str):
    """Per-event regional advancement detail."""
    try:
        return await get_frc_client().get_regional_pool_event(season, event_code)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load regional pool for event '{event_code}'.")


# ═══════════════════════════════════════════════════════════
#  Region / Event History
# ═══════════════════════════════════════════════════════════

@router.get("/region/{region_name}/facts")
async def region_facts(region_name: str):
    """Return pre-computed region/district facts (instant, from static JSON)."""
    data = region_service.get_region_facts(region_name)
    if not data:
        raise HTTPException(status_code=404, detail=f"No data for region: {region_name}")
    return data


@router.get("/regions/list")
async def regions_list():
    """Return all known region names."""
    try:
        return region_service.list_regions()
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not load regions list.")


@router.get("/{event_key}/history")
async def event_history(event_key: str):
    """Return the full history of a recurring event (awards, winners, timeline)."""
    try:
        return await region_service.get_event_history(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load history for event '{event_key}'.")


@router.get("/{event_key}/gatool-updates")
async def gatool_updates(event_key: str):
    """Return gatool community updates (sponsors, notes, etc.) for all teams at an event.

    Data provided by the FIRST Game Announcer Tool API (gatool.org).
    """
    try:
        year = int(event_key[:4])
        event_code = event_key[4:]
        # Strip "ftc" prefix for FTC event keys (e.g. "ftcTRTUQ1" → "TRTUQ1")
        if event_code.lower().startswith("ftc"):
            event_code = event_code[3:]
        client = get_gatool_client()
        return await client.get_event_community_updates(year, event_code)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load GATool updates for event '{event_key}'.")


# ═════════════════════════════════════════════════════════════
#  Notes — event-scoped and match-scoped queries
# ═════════════════════════════════════════════════════════════

@router.get("/{event_key}/notes")
async def get_event_notes(
    event_key: str,
    team_key: str = Query(None, description="Filter to notes about this team"),
    match_key: str = Query(None, description="Filter to notes about this match"),
    category: str = Query(None, description="Filter by category"),
    sort: str = Query("desc", pattern="^(asc|desc)$", description="Sort by created_at"),
):
    """Return all notes for an event, with optional team/match/category filters.

    Supports cross-dimensional queries:
    - /events/2026tuak/notes → all notes at event
    - /events/2026tuak/notes?team_key=frc254 → team notes at this event
    - /events/2026tuak/notes?match_key=2026tuak_qm42 → match notes
    - /events/2026tuak/notes?category=strategy → strategy notes
    - /events/2026tuak/notes?sort=asc → oldest first
    """
    try:
        from ..services.supabase_client import get_supabase
        sb = await get_supabase()

        q = (
            sb.table("notes")
            .select("*")
            .eq("event_key", event_key)
            .eq("is_deleted", False)
            .order("created_at", desc=(sort == "desc"))
        )
        if team_key:
            q = q.eq("team_key", team_key)
        if match_key:
            q = q.eq("match_key", match_key)
        if category:
            q = q.eq("category", category)

        resp = await q.execute()
        return resp.data or []
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load notes for event '{event_key}'.")
