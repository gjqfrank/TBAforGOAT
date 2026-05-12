"""FTC Event endpoints — info, teams, summary, season list."""
from fastapi import APIRouter, HTTPException, Query, Response
from ..services import ftc_event_service, payload_cache
from ..services.ftc_event_service import current_ftc_season
from ..services.ftc_client import get_ftc_client
from ..services.ftcscout_client import get_ftcscout_client
from ..services.gatool_client import get_gatool_client
from ..services.supabase_client import get_season_record, set_season_record
from ..services.error_utils import raise_api_error
import asyncio
import httpx

router = APIRouter()

# ── FTC Avatar CSS proxy (FIRST scoring server has no CORS headers) ──
_AVATAR_CSS_URL = "https://ftc-scoring.firstinspires.org/avatars/composed/{year}.css"
_avatar_css_cache: dict[int, str] = {}


@router.get("/teams/awards-summary")
async def ftc_team_awards_summary(teams: str = Query(..., description="Comma-separated FTC team numbers")):
    """Recent FTC awards (last 3 seasons) for a batch of FTC teams."""
    try:
        nums = [int(t.strip()) for t in teams.split(",") if t.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid team numbers")
    if not nums or len(nums) > 12:
        raise HTTPException(status_code=400, detail="Provide 1-12 team numbers")
    try:
        return await ftc_event_service.get_ftc_team_awards_summary(nums)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not load FTC awards summary.")


@router.get("/season/current")
async def current_season():
    """Return the active FTC kickoff year (e.g. 2025 for DECODE 2025-2026)."""
    return {"season": current_ftc_season()}


@router.get("/season/high-scores")
async def ftc_season_high_scores(
    season: int = Query(None),
    limit: int = Query(10, ge=1, le=25),
):
    """Top match scores and top OPR teams for an FTC season (from FTC Scout).

    Caching hierarchy:
    1. Disk cache (``payload_cache``) — 10-min TTL, survives restarts.
    2. Supabase ``season_records`` — persistent, served if FTC Scout is down.
    3. Live FTC Scout GraphQL fetch — updates both caches on success.

    Scrimmage events (type 0) are always excluded from the matches list.
    """
    season = season or current_ftc_season()
    cache_key = f"{season}_{limit}"

    # ── Build valid competition event-code set (excludes scrimmages/kickoffs) ──
    # get_season_events already filters NON_COMPETITION_TYPES; the resulting
    # dict is used both for event-name enrichment AND as a scrimmage allowlist.
    event_names: dict[str, str] = {}
    valid_event_codes: set[str] = set()
    try:
        events = await ftc_event_service.get_season_events(season)
        for ev in events:
            code = (ev.get("event_code") or ev.get("code") or "").lower()
            if code:
                valid_event_codes.add(code)
                event_names[code] = ev.get("name") or ev.get("event_name") or code
    except Exception:
        pass  # degrade gracefully — filtering is skipped if events unavailable

    def _filter_scrimmages(data: dict) -> dict:
        """Remove scrimmage matches and re-apply the requested limit."""
        if not valid_event_codes:
            return data
        data["matches"] = [
            m for m in data.get("matches", [])
            if m.get("event_code", "").lower() in valid_event_codes
        ][:limit]
        return data

    try:
        # ── 1. Disk cache ───────────────────────────────────
        cached = payload_cache.read_payload("ftc_season_high", cache_key, 600)
        if cached:
            return _filter_scrimmages(dict(cached))

        stale = payload_cache.read_stale("ftc_season_high", cache_key)

        # ── 2. Supabase ─────────────────────────────────────
        sb_row = await get_season_record(f"ftc_season_high_{season}_{limit}")
        if sb_row and sb_row.get("payload"):
            sb_payload = dict(sb_row["payload"])
            sb_payload["matches"] = list(sb_payload.get("matches", []))
            # Enrich event_name if still raw (Supabase row predates enrichment or
            # CMP subdivision events were missing from the static season file).
            if event_names and any(
                m.get("event_name") == m.get("event_code")
                for m in sb_payload.get("matches", [])
            ):
                for m in sb_payload["matches"]:
                    c = m.get("event_code", "").lower()
                    if c and event_names.get(c):
                        m["event_name"] = event_names[c]
            _filter_scrimmages(sb_payload)
            payload_cache.write_payload("ftc_season_high", cache_key, sb_payload)
            return sb_payload

        # ── 3. Live fetch from FTC Scout ────────────────────
        try:
            scout = get_ftcscout_client()
            data = await scout.get_season_high_scores(season, limit=limit)

            # Enrich event_name with friendly names
            for m in data.get("matches", []):
                code = m.get("event_code", "").lower()
                if code and code in event_names:
                    m["event_name"] = event_names[code]

            # Filter scrimmages before persisting so caches stay clean
            _filter_scrimmages(data)

            # Persist to disk and Supabase
            payload_cache.write_payload("ftc_season_high", cache_key, data)
            asyncio.create_task(
                set_season_record(
                    f"ftc_season_high_{season}_{limit}",
                    season,
                    "ftc_season_high_scores",
                    data,
                )
            )
            return data

        except Exception:
            if stale:
                return _filter_scrimmages(dict(stale))
            raise

    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC season high scores for {season}.")


@router.get("/season/{year}")
async def season_events(year: int, include_offseason: bool = Query(False)):
    """List all FTC events for a season."""
    try:
        return await ftc_event_service.get_season_events(year, include_offseason=include_offseason)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC season {year} events.")


@router.get("/season/{year}/summary")
async def season_summary(year: int):
    """High-level FTC season info."""
    try:
        client = get_ftc_client()
        return await client.get_season_summary(year)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC season {year} summary.")


@router.get("/{event_key}/gatool-updates")
async def ftc_gatool_updates(event_key: str):
    """Return GATool community updates (sponsors, notes, etc.) for all FTC teams at an event."""
    try:
        year = int(event_key[:4])
        event_code = event_key[4:]
        # Strip "ftc" prefix (e.g. "ftcTRTUQ1" → "TRTUQ1")
        if event_code.lower().startswith("ftc"):
            event_code = event_code[3:]
        client = get_gatool_client()
        return await client.get_ftc_event_community_updates(year, event_code)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load GATool updates for FTC event '{event_key}'.")


@router.get("/{event_key}/info")
async def event_info(event_key: str):
    try:
        return await ftc_event_service.get_event_info(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC event info for '{event_key}'.")


@router.get("/{event_key}/teams")
async def event_teams(event_key: str):
    try:
        return await ftc_event_service.get_event_teams_with_stats(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC teams for event '{event_key}'.")


@router.get("/{event_key}/fast-rankings")
async def fast_rankings(event_key: str):
    """Lightweight FTC rankings."""
    try:
        return await ftc_event_service.get_fast_rankings(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC rankings for event '{event_key}'.")


@router.get("/{event_key}/refresh-rankings")
async def refresh_rankings(event_key: str):
    """Clear cached rankings, return fresh data."""
    get_ftc_client().clear_cache()
    return await ftc_event_service.get_event_teams_with_stats(event_key)


@router.get("/{event_key}/clear-cache")
async def clear_cache(event_key: str):
    get_ftc_client().clear_cache()
    return {"status": "FTC cache cleared"}


@router.get("/{event_key}/awards")
async def event_awards(event_key: str):
    """FTC event awards."""
    try:
        return await ftc_event_service.get_event_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC awards for event '{event_key}'.")


@router.get("/{event_key}/past-awards")
async def ftc_past_awards(event_key: str):
    """Previous-season Inspire/Winner/Finalist awards for FTC teams at an event."""
    try:
        return await ftc_event_service.get_ftc_past_season_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC past awards for event '{event_key}'.")


@router.get("/world-record/{season}")
async def ftc_world_record(season: int):
    """FTC world record match from FTC Scout."""
    try:
        result = await ftc_event_service.get_ftc_world_record(season)
        if not result:
            raise HTTPException(status_code=404, detail="No FTC world record found.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC world record for season {season}.")


@router.get("/avatar-css/{year}")
async def ftc_avatar_css(year: int):
    """Proxy the FTC scoring server's avatar CSS (no CORS headers on origin)."""
    if year < 2019 or year > 2030:
        raise HTTPException(status_code=400, detail="Invalid year")
    if year in _avatar_css_cache:
        return Response(
            content=_avatar_css_cache[year],
            media_type="text/css",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(_AVATAR_CSS_URL.format(year=year))
            resp.raise_for_status()
        _avatar_css_cache[year] = resp.text
        return Response(
            content=resp.text,
            media_type="text/css",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch FTC avatar CSS: {e}")


@router.get("/{event_key}/season-awards")
async def ftc_season_awards(event_key: str):
    """Current-season Inspire/Winner/Finalist awards for FTC teams at an event."""
    try:
        return await ftc_event_service.get_ftc_current_season_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC season awards for event '{event_key}'.")


@router.get("/team/{team_number}")
async def team_lookup(team_number: int, season: int | None = Query(None)):
    """FTC individual team lookup using FTC Events API + FTC Scout."""
    season = season or current_ftc_season()
    try:
        return await ftc_event_service.get_team_lookup(team_number, season)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC team {team_number}.")


@router.get("/team/{team_number}/opr-history")
async def team_opr_history(team_number: int, season: int | None = Query(None)):
    """FTC team OPR history across seasons."""
    season = season or current_ftc_season()
    try:
        return await ftc_event_service.get_team_opr_history(team_number, season)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load OPR history for FTC team {team_number}.")


@router.get("/{event_key}/summary/connections")
async def ftc_event_connections(
    event_key: str,
    all_time: bool = Query(False, description="Search all-time instead of last 3 years"),
    teams: str = Query(None, description="Comma-separated FTC team numbers. If omitted, checks all teams at the event."),
):
    """Prior playoff connections for FTC teams at an event (cache-aside)."""
    try:
        if teams:
            team_numbers = [int(t.strip()) for t in teams.split(",") if t.strip()]
            return await ftc_event_service.get_ftc_match_connections(event_key, team_numbers, all_time=all_time)
        return await ftc_event_service.get_ftc_event_connections(event_key, all_time=all_time)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC connections for event '{event_key}'.")
