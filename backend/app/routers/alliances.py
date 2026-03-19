"""Alliance selection endpoints."""
from fastapi import APIRouter, HTTPException
from ..services import alliance_service
from ..services.error_utils import raise_api_error

router = APIRouter()


@router.get("/{event_key}")
async def get_alliances(event_key: str):
    try:
        return await alliance_service.get_alliances_with_stats(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load alliances for event '{event_key}'.")
