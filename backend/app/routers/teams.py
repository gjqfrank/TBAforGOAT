"""Team lookup endpoints — stats, highest stage, head-to-head."""
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from ..services import team_service
from ..services.error_utils import raise_api_error

router = APIRouter()


@router.get("/awards-summary")
async def awards_summary(teams: str = Query(..., description="Comma-separated team numbers")):
    """Blue banner count + recent awards (last 3 seasons) for a batch of teams."""
    try:
        nums = [int(t.strip()) for t in teams.split(",") if t.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid team numbers")
    if not nums or len(nums) > 12:
        raise HTTPException(status_code=400, detail="Provide 1-12 team numbers")
    try:
        return await team_service.get_awards_summary(nums)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not load awards summary.")


@router.get("/{team_number}/stats")
async def team_stats(team_number: int, year: Optional[int] = None):
    try:
        return await team_service.get_team_stats(team_number, year)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load stats for team {team_number}.")


@router.get("/head-to-head/{team_a}/{team_b}")
async def head_to_head(
    team_a: int,
    team_b: int,
    year: Optional[int] = None,
    all_time: bool = Query(False),
):
    try:
        return await team_service.get_head_to_head(team_a, team_b, year, all_time=all_time)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load head-to-head for teams {team_a} vs {team_b}.")
