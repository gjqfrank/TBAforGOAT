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
    custom_organization: Optional[str] = None
    custom_location: Optional[str] = None
    custom_top_sponsors: Optional[str] = None
    custom_pronunciation: Optional[str] = None
    custom_hardware: Optional[str] = None          # JSON array string
    custom_auto_strategy: Optional[str] = None     # JSON array string
    custom_teleop_strategy: Optional[str] = None   # JSON array string
    custom_number_display: Optional[str] = None    # e.g. "11-370" for 11370
    author_device_id: str
    author_name: Optional[str] = None              # display name of editor
    author_event_key: Optional[str] = None         # event being viewed


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

    Only fields explicitly sent in the body are written.  Fields not
    included are left untouched so concurrent edits from different
    casters merge instead of last-writer-wins.
    """
    try:
        sb = await get_supabase()

        # Check for existing active override
        existing = (
            await sb.table("tims_overrides")
            .select("*")
            .eq("team_key", team_key)
            .eq("is_deleted", False)
            .limit(1)
            .execute()
        )

        # Determine which fields the caller explicitly sent
        sent = body.model_dump(exclude_unset=True)

        _OV_FIELDS = ("custom_nickname", "custom_sponsor_read",
                      "custom_robot_name", "custom_motto",
                      "custom_organization", "custom_location",
                      "custom_top_sponsors", "custom_pronunciation",
                      "custom_hardware", "custom_auto_strategy",
                      "custom_teleop_strategy", "custom_number_display")

        if existing.data:
            # Merge: start from existing row, overlay only sent fields
            row = {
                "id": existing.data[0]["id"],
                "team_key": team_key,
                "author_device_id": body.author_device_id,
                "is_deleted": False,
            }
            for field in _OV_FIELDS:
                row[field] = sent[field] if field in sent else existing.data[0].get(field)
        else:
            # New row: only populate fields that were sent
            row = {
                "team_key": team_key,
                "author_device_id": body.author_device_id,
                "is_deleted": False,
            }
            for field in _OV_FIELDS:
                if field in sent:
                    row[field] = sent[field]

        # Audit columns
        if body.author_name:
            row["author_name"] = body.author_name
        if body.author_event_key:
            row["author_event_key"] = body.author_event_key

        resp = await sb.table("tims_overrides").upsert(row).execute()
        saved = resp.data[0] if resp.data else row

        # ── Write history log ───────────────────────────────
        snapshot = {f: row.get(f) for f in _OV_FIELDS if row.get(f) is not None}
        history_row = {
            "team_key": team_key,
            "author_name": body.author_name or "Unknown",
            "author_event_key": body.author_event_key,
            "snapshot": snapshot,
        }
        try:
            await sb.table("tims_overrides_history").insert(history_row).execute()
        except Exception:
            pass  # non-fatal: don't block the save

        return saved
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not save TIMS overrides for {team_key}.")


@router.get("/{team_key}/tims-overrides/history")
async def get_tims_overrides_history(team_key: str):
    """Return edit history for a team's TIMS overrides (newest first)."""
    try:
        sb = await get_supabase()
        resp = (
            await sb.table("tims_overrides_history")
            .select("id, author_name, author_event_key, snapshot, created_at")
            .eq("team_key", team_key)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load TIMS history for {team_key}.")


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
