"""Storylines router — AI-generated broadcast narratives."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from ..services import storyline_service
from ..services.error_utils import raise_api_error

router = APIRouter()


class StorylineRequest(BaseModel):
    mode: str  # "match" or "team"
    event_key: str
    match_key: Optional[str] = None
    team_number: Optional[int] = None


@router.get("/status")
async def storyline_status():
    """Check if the AI storyline feature is available."""
    return {"available": storyline_service.is_available()}


@router.post("/generate")
async def generate_storyline(req: StorylineRequest):
    """Generate an AI broadcast storyline (full response)."""
    if not storyline_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI Storylines are not available — no Anthropic API key configured.",
        )

    if req.mode not in ("match", "team"):
        raise HTTPException(status_code=400, detail="Mode must be 'match' or 'team'.")

    if req.mode == "match" and not req.match_key:
        raise HTTPException(status_code=400, detail="match_key is required for match mode.")

    if req.mode == "team" and not req.team_number:
        raise HTTPException(status_code=400, detail="team_number is required for team mode.")

    try:
        result = await storyline_service.generate_storyline(
            mode=req.mode,
            event_key=req.event_key,
            match_key=req.match_key,
            team_number=req.team_number,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not generate storyline.")


@router.post("/generate/stream")
async def generate_storyline_stream(req: StorylineRequest):
    """Generate an AI broadcast storyline via Server-Sent Events.

    SSE events:
      event: start   — {cache_key, cached}
      event: token   — {text}  (streamed LLM tokens, only when not cached)
      event: done    — full structured response payload
      event: error   — {detail}
    """
    if not storyline_service.is_available():
        raise HTTPException(
            status_code=503,
            detail="AI Storylines are not available — no Anthropic API key configured.",
        )

    if req.mode not in ("match", "team"):
        raise HTTPException(status_code=400, detail="Mode must be 'match' or 'team'.")

    if req.mode == "match" and not req.match_key:
        raise HTTPException(status_code=400, detail="match_key is required for match mode.")

    if req.mode == "team" and not req.team_number:
        raise HTTPException(status_code=400, detail="team_number is required for team mode.")

    return StreamingResponse(
        storyline_service.generate_storyline_stream(
            mode=req.mode,
            event_key=req.event_key,
            match_key=req.match_key,
            team_number=req.team_number,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
