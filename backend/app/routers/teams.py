"""Team lookup endpoints — stats, highest stage, head-to-head, TIMS overrides."""
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from ..services import team_service
from ..services.error_utils import raise_api_error
from ..services.supabase_client import get_supabase

router = APIRouter()


# ── TIMS Override Models ────────────────────────────────────
class TimsOverrideBody(BaseModel):
    """Fields the user can override.  Send only the fields to change;
    null values clear the override for that field."""
    custom_nickname: Optional[str] = None
    custom_sponsor_read: Optional[str] = None
    custom_robot_name: Optional[str] = None
    custom_motto: Optional[str] = None
    author_device_id: str


# ── Notes Models ────────────────────────────────────────────
class NoteCreateBody(BaseModel):
    content: str
    team_key: Optional[str] = None
    match_key: Optional[str] = None
    event_key: Optional[str] = None
    category: Optional[str] = None
    author_device_id: str


class NoteUpdateBody(BaseModel):
    content: Optional[str] = None
    team_key: Optional[str] = None
    match_key: Optional[str] = None
    event_key: Optional[str] = None
    category: Optional[str] = None


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


# ═════════════════════════════════════════════════════════════
#  TIMS Overrides CRUD
# ═════════════════════════════════════════════════════════════

@router.get("/{team_key}/tims-overrides")
async def get_tims_overrides(team_key: str):
    """Return the active TIMS override for a team, or {} if none."""
    try:
        sb = await get_supabase()
        resp = (
            await sb.table("tims_overrides")
            .select("*")
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )
        if resp.data:
            return resp.data[0]
        return {}
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load TIMS overrides for {team_key}.")


@router.put("/{team_key}/tims-overrides")
async def upsert_tims_overrides(team_key: str, body: TimsOverrideBody):
    """Create or update TIMS overrides for a team.

    Only non-null fields in the body will be set as overrides.
    Sending null for a field clears that specific override.
    """
    try:
        sb = await get_supabase()

        # Check for existing active override
        existing = (
            await sb.table("tims_overrides")
            .select("id")
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

        row = {
            "team_key": team_key,
            "custom_nickname": body.custom_nickname,
            "custom_sponsor_read": body.custom_sponsor_read,
            "custom_robot_name": body.custom_robot_name,
            "custom_motto": body.custom_motto,
            "author_device_id": body.author_device_id,
            "is_deleted": False,
        }

        if existing.data:
            row["id"] = existing.data[0]["id"]

        resp = await sb.table("tims_overrides").upsert(row).execute()
        return resp.data[0] if resp.data else row
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not save TIMS overrides for {team_key}.")


@router.delete("/{team_key}/tims-overrides")
async def reset_tims_overrides(team_key: str):
    """Reset TIMS overrides for a team (soft-delete → reverts to FIRST defaults)."""
    try:
        sb = await get_supabase()
        await (
            sb.table("tims_overrides")
            .update({"is_deleted": True})
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .execute()
        )
        return {"status": "reset", "team_key": team_key}
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not reset TIMS overrides for {team_key}.")


# ═════════════════════════════════════════════════════════════
#  Notes — CRUD + query endpoints
# ═════════════════════════════════════════════════════════════

@router.get("/{team_key}/notes")
async def get_team_notes(
    team_key: str,
    event_key: Optional[str] = None,
    sort: str = Query("desc", pattern="^(asc|desc)$", description="Sort by created_at"),
):
    """Return all notes tagged with this team.

    If event_key is provided, filter to notes from that event.
    Otherwise return ALL notes for this team across all events
    (historical notes for caster prep).
    """
    try:
        sb = await get_supabase()
        q = (
            sb.table("notes")
            .select("*")
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .order("created_at", desc=(sort == "desc"))
        )
        if event_key:
            q = q.eq("event_key", event_key)
        resp = await q.execute()
        return resp.data or []
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load notes for {team_key}.")


@router.post("/notes", status_code=201)
async def create_note(body: NoteCreateBody):
    """Create a new note. Tag it with any combination of team/match/event."""
    if not body.content or not body.content.strip():
        raise HTTPException(status_code=400, detail="Note content cannot be empty.")
    try:
        sb = await get_supabase()
        row = {
            "content": body.content.strip(),
            "team_key": body.team_key,
            "match_key": body.match_key,
            "event_key": body.event_key,
            "category": body.category,
            "author_device_id": body.author_device_id,
            "is_deleted": False,
        }
        resp = await sb.table("notes").insert(row).execute()
        return resp.data[0]
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not create note.")


@router.put("/notes/{note_id}")
async def update_note(note_id: str, body: NoteUpdateBody):
    """Update an existing note's content or tags."""
    try:
        sb = await get_supabase()
        updates = {k: v for k, v in body.model_dump().items() if v is not None}
        if not updates:
            raise HTTPException(status_code=400, detail="Nothing to update.")
        resp = (
            await sb.table("notes")
            .update(updates)
            .eq("id", note_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Note not found.")
        return resp.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not update note.")


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    """Soft-delete a note."""
    try:
        sb = await get_supabase()
        resp = (
            await sb.table("notes")
            .update({"is_deleted": True})
            .eq("id", note_id)
            .eq("is_deleted", False)
            .execute()
        )
        if not resp.data:
            raise HTTPException(status_code=404, detail="Note not found.")
        return {"status": "deleted", "id": note_id}
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail="Could not delete note.")
