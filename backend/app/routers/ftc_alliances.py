"""FTC Alliance endpoints."""
from fastapi import APIRouter, HTTPException
from ..services import ftc_event_service
from ..services.error_utils import raise_api_error

router = APIRouter()


@router.get("/{event_key}")
async def alliances(event_key: str):
    """Return FTC alliance selections for an event."""
    try:
        return await ftc_event_service.get_alliances(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC alliances for '{event_key}'.")
