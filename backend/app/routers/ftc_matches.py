"""FTC Match endpoints — all matches, playoffs, scores, breakdowns."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..services import ftc_event_service
from ..services.error_utils import raise_api_error

router = APIRouter()


@router.get("/head-to-head/{team_a}/{team_b}")
async def head_to_head(
    team_a: int,
    team_b: int,
    all_time: Optional[bool] = Query(False),
):
    """Cross-season FTC playoff head-to-head between two teams."""
    try:
        return await ftc_event_service.get_ftc_head_to_head(
            team_a, team_b, all_time=bool(all_time),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(
            e, fallback_detail=f"Could not load FTC head-to-head for {team_a} vs {team_b}.",
        )


@router.get("/{event_key}/all")
async def all_matches(event_key: str):
    """Return all FTC matches (qual + playoff) for an event."""
    try:
        return await ftc_event_service.get_all_matches(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC matches for '{event_key}'.")


@router.get("/{event_key}/playoffs")
async def playoff_matches(event_key: str):
    """Return FTC playoff matches for an event."""
    try:
        return await ftc_event_service.get_playoff_matches(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC playoff matches for '{event_key}'.")


@router.get("/{event_key}/scores")
async def fast_scores(event_key: str):
    """Quick score fetch for live poll."""
    try:
        return await ftc_event_service.get_match_scores(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC scores for '{event_key}'.")


@router.get("/match/{event_key}/{level}/{match_number}/breakdown")
async def match_breakdown(event_key: str, level: str, match_number: int):
    """Return detailed score breakdown for a single FTC match."""
    try:
        result = await ftc_event_service.get_score_breakdown(event_key, level, match_number)
        if not result:
            raise HTTPException(status_code=404, detail="Score breakdown not available.")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not load FTC score breakdown.")
