"""GoatScout scouting data endpoints — per-team metrics per event."""
from typing import Optional, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from ..services.supabase_client import get_supabase
from ..services.error_utils import raise_api_error

router = APIRouter()


class GoatScoutBody(BaseModel):
    """Metrics is a free-form dict of metric_name → value (string)."""
    metrics: dict[str, Any]
    author_device_id: str
    author_name: Optional[str] = None


class GoatScoutImportBody(BaseModel):
    teams: list[dict]


@router.get("/{event_key}")
async def list_goatscout(event_key: str):
    """Return all GoatScout data for an event."""
    try:
        sb = await get_supabase()
        resp = (
            await sb.table("goatscout_data")
            .select("*")
            .eq("event_key", event_key)
            .eq("is_deleted", False)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load GoatScout data for {event_key}.")


@router.get("/{event_key}/{team_key}")
async def get_goatscout(event_key: str, team_key: str):
    """Return GoatScout data for a single team in an event."""
    try:
        sb = await get_supabase()
        resp = (
            await sb.table("goatscout_data")
            .select("*")
            .eq("event_key", event_key)
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]
        return {}
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load GoatScout data for {team_key}.")


@router.put("/{event_key}/{team_key}")
async def upsert_goatscout(event_key: str, team_key: str, body: GoatScoutBody):
    """Create or update GoatScout data for a team (field-level merge)."""
    try:
        sb = await get_supabase()

        existing = (
            await sb.table("goatscout_data")
            .select("*")
            .eq("event_key", event_key)
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

        if existing.data:
            old_metrics = existing.data[0].get("metrics") or {}
            merged = {**old_metrics, **body.metrics}
            row = {
                "id": existing.data[0]["id"],
                "team_key": team_key,
                "event_key": event_key,
                "metrics": merged,
                "author_device_id": body.author_device_id,
                "is_deleted": False,
            }
        else:
            row = {
                "team_key": team_key,
                "event_key": event_key,
                "metrics": body.metrics,
                "author_device_id": body.author_device_id,
                "is_deleted": False,
            }

        if body.author_name:
            row["author_name"] = body.author_name

        resp = await sb.table("goatscout_data").upsert(row).execute()
        saved = resp.data[0] if resp.data else row

        # Write history log
        history_row = {
            "team_key": team_key,
            "event_key": event_key,
            "author_name": body.author_name or "Unknown",
            "snapshot": row.get("metrics", {}),
        }
        try:
            await sb.table("goatscout_data_history").insert(history_row).execute()
        except Exception:
            pass

        return saved
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not save GoatScout data for {team_key}.")


@router.post("/{event_key}/import")
async def import_goatscout(event_key: str, body: GoatScoutImportBody):
    """Batch import GoatScout data from CSV-parsed JSON."""
    try:
        sb = await get_supabase()
        results = []
        for entry in body.teams:
            team_key = entry.get("team_key")
            metrics = entry.get("metrics", {})
            if not team_key:
                continue

            existing = (
                await sb.table("goatscout_data")
                .select("*")
                .eq("event_key", event_key)
                .eq("team_key", team_key)
                .eq("is_deleted", False)
                .limit(1)
                .execute()
            )

            if existing.data:
                old_metrics = existing.data[0].get("metrics") or {}
                merged = {**old_metrics, **metrics}
                row = {
                    "id": existing.data[0]["id"],
                    "team_key": team_key,
                    "event_key": event_key,
                    "metrics": merged,
                    "is_deleted": False,
                }
            else:
                row = {
                    "team_key": team_key,
                    "event_key": event_key,
                    "metrics": metrics,
                    "author_device_id": entry.get("author_device_id", "csv-import"),
                    "is_deleted": False,
                }

            if entry.get("author_name"):
                row["author_name"] = entry["author_name"]

            resp = await sb.table("goatscout_data").upsert(row).execute()
            if resp.data:
                results.append(resp.data[0])

        return {"imported": len(results), "total": len(body.teams)}
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not import GoatScout data for {event_key}.")


@router.delete("/{event_key}/{team_key}")
async def delete_goatscout(event_key: str, team_key: str):
    """Soft-delete GoatScout data for a team."""
    try:
        sb = await get_supabase()
        await (
            sb.table("goatscout_data")
            .update({"is_deleted": True})
            .eq("event_key", event_key)
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .execute()
        )
        return {"status": "deleted", "team_key": team_key, "event_key": event_key}
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not delete GoatScout data for {team_key}.")
