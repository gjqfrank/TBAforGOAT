"""FTC Event endpoints — info, teams, summary, season list."""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from ..services import ftc_event_service
from ..services.ftc_client import get_ftc_client
from ..services.gatool_client import get_gatool_client
from ..services.error_utils import raise_api_error
import httpx

router = APIRouter()

# ── FTC Avatar CSS proxy (FIRST scoring server has no CORS headers) ──
_AVATAR_CSS_URL = "https://ftc-scoring.firstinspires.org/avatars/composed/{year}.css"
_avatar_css_cache: dict[int, str] = {}


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


@router.get("/{event_key}/summary/connections")
async def ftc_event_connections(
    event_key: str,
    all_time: bool = Query(False, description="Search all-time instead of last 3 seasons"),
):
    """Prior playoff connections between teams at an FTC event."""
    try:
        return await ftc_event_service.get_ftc_event_connections(event_key, all_time=all_time)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC connections for event '{event_key}'.")


@router.get("/{event_key}/past-awards")
async def ftc_past_awards(event_key: str):
    """Previous-season Inspire/Winner/Finalist awards for FTC teams at an event."""
    try:
        return await ftc_event_service.get_ftc_past_season_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC past awards for event '{event_key}'.")


@router.get("/{event_key}/season-awards")
async def ftc_season_awards(event_key: str):
    """Current-season Inspire/Winner/Finalist awards earned at prior events for FTC teams at an event."""
    try:
        return await ftc_event_service.get_ftc_current_season_awards(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC season awards for event '{event_key}'.")


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


@router.get("/team/{team_number}")
async def team_lookup(team_number: int, season: int = Query(2025), include_history: bool = Query(False)):
    """FTC individual team lookup using FTC Events API + FTC Scout."""
    try:
        return await ftc_event_service.get_team_lookup(team_number, season, include_history=include_history)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC team {team_number}.")


@router.get("/team/{team_number}/opr-history")
async def team_opr_history(team_number: int, season: int = Query(2025)):
    """FTC team OPR history across seasons."""
    try:
        return await ftc_event_service.get_team_opr_history(team_number, season)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load OPR history for FTC team {team_number}.")
