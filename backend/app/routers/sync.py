"""POST /api/sync — Delta-sync endpoint for the Offline-First BFF.

Protocol
--------
The client sends:
  - event_key   : scope the delta to a single event
  - last_sync   : ISO 8601 timestamp of the client's last successful sync
                   (omit or null for a full initial sync)
  - pending_edits: list of locally created/updated notes & tims_overrides
                   the server should merge (LWW on updated_at)

The server returns:
  - server_time : ISO 8601 — client should store this and send it as
                  last_sync on the next call.  Captured BEFORE the
                  query so no rows can slip between the read and
                  the timestamp.
  - changes     : dict of table → list[row] with all rows changed
                  since last_sync for the requested event scope.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services.supabase_client import get_supabase, upsert_rows, fetch_changed

log = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response models ───────────────────────────────
class PendingEdit(BaseModel):
    """A single offline edit the client wants to push."""
    table: str = Field(..., pattern=r"^(notes|tims_overrides)$")
    row: dict


class SyncRequest(BaseModel):
    event_key: str = Field(..., min_length=3, max_length=32)
    last_sync: Optional[str] = None   # ISO 8601 or null for full sync
    pending_edits: list[PendingEdit] = Field(default_factory=list)


class SyncResponse(BaseModel):
    server_time: str
    changes: dict[str, list[dict]]


# ── Helpers ─────────────────────────────────────────────────
_EPOCH = "1970-01-01T00:00:00+00:00"

# Tables that are scoped to an event_key directly
_EVENT_SCOPED = ("events", "matches", "event_teams")

# User-editable tables that support LWW merge
_EDITABLE_TABLES = {"notes", "tims_overrides"}


async def _apply_pending_edits(edits: list[PendingEdit], event_key: str) -> None:
    """Apply client-side edits using Last-Write-Wins on updated_at."""
    if not edits:
        return

    sb = await get_supabase()

    for edit in edits:
        table = edit.table
        row = edit.row.copy()

        # Require an id for user-space rows
        row_id = row.get("id")
        if not row_id:
            log.warning("Rejecting edit with no id for table %s", table)
            continue

        # Validate updated_at is present
        client_ts = row.get("updated_at")
        if not client_ts:
            log.warning("Rejecting edit with no updated_at for %s/%s", table, row_id)
            continue

        # LWW: check if server row is newer
        try:
            resp = await sb.table(table).select("updated_at").eq(
                "id", row_id
            ).execute()

            if resp.data:
                server_ts = resp.data[0]["updated_at"]
                # Compare as ISO strings (both are UTC, lexicographic ordering works)
                if server_ts >= client_ts:
                    log.debug(
                        "LWW skip: %s/%s server=%s >= client=%s",
                        table, row_id, server_ts, client_ts,
                    )
                    continue
        except Exception as e:
            log.warning("LWW check failed for %s/%s: %s", table, row_id, e)
            # Fall through to upsert — if the row doesn't exist, this is an INSERT

        # Upsert the row (trigger will stamp updated_at on server side)
        try:
            await sb.table(table).upsert(row).execute()
            log.debug("Applied edit: %s/%s", table, row_id)
        except Exception as e:
            log.warning("Edit upsert failed: %s/%s: %s", table, row_id, e)


async def _fetch_delta(event_key: str, since: str) -> dict[str, list[dict]]:
    """Fetch all rows changed since `since` for the given event scope."""
    changes: dict[str, list[dict]] = {}

    # 1) Event metadata
    event_rows = await fetch_changed(
        "events", since, eq_filters={"event_key": event_key}
    )
    if event_rows:
        changes["events"] = event_rows

    # 2) Matches scoped to this event
    match_rows = await fetch_changed(
        "matches", since, eq_filters={"event_key": event_key}
    )
    if match_rows:
        changes["matches"] = match_rows

    # 3) Event-teams junction scoped to this event
    et_rows = await fetch_changed(
        "event_teams", since, eq_filters={"event_key": event_key}
    )
    if et_rows:
        changes["event_teams"] = et_rows

    # 4) Teams: fetch all teams whose team_key appears in event_teams
    #    for this event (we need the junction to scope team rows)
    if et_rows:
        team_keys = {r["team_key"] for r in et_rows}
    else:
        # If no event_teams changed, still check for updated team rows
        sb = await get_supabase()
        resp = await sb.table("event_teams").select("team_key").eq(
            "event_key", event_key
        ).execute()
        team_keys = {r["team_key"] for r in (resp.data or [])}

    if team_keys:
        team_rows = await fetch_changed("teams", since)
        # Filter to only teams at this event
        scoped_teams = [r for r in team_rows if r["team_key"] in team_keys]
        if scoped_teams:
            changes["teams"] = scoped_teams

    # 5) Notes — now using explicit team_key, match_key, event_key columns.
    #    For sync we send ALL notes changed since last_sync that are
    #    relevant to this event:
    #    - event_key matches this event
    #    - match_key starts with this event key (matches like "2026tuak_qm1")
    #    - team_key is one of the teams at this event (cross-event team notes)
    all_notes = await fetch_changed("notes", since)
    if all_notes:
        relevant_notes = []
        for n in all_notes:
            n_ek = n.get("event_key") or ""
            n_mk = n.get("match_key") or ""
            n_tk = n.get("team_key") or ""
            # Legacy: also check target_key for old rows
            n_legacy = n.get("target_key") or ""
            if (n_ek == event_key
                    or n_mk.startswith(event_key + "_")
                    or n_tk in team_keys
                    or n_legacy == event_key
                    or n_legacy.startswith(event_key + "_")
                    or n_legacy in team_keys):
                relevant_notes.append(n)
        if relevant_notes:
            changes["notes"] = relevant_notes

    # 6) tims_overrides — scoped by team_key at this event
    all_overrides = await fetch_changed("tims_overrides", since)
    if all_overrides:
        relevant = [r for r in all_overrides if r.get("team_key") in team_keys]
        if relevant:
            changes["tims_overrides"] = relevant

    return changes


# ── Endpoint ────────────────────────────────────────────────
@router.post("/", response_model=SyncResponse)
async def sync(req: SyncRequest):
    """Delta-sync endpoint.

    1. Capture server_time BEFORE any reads (prevents missed rows).
    2. Apply pending edits from the client (LWW).
    3. Fetch all rows changed since last_sync for the event scope.
    4. Return the delta + server_time.
    """
    try:
        sb = await get_supabase()
    except RuntimeError:
        raise HTTPException(
            status_code=503,
            detail="Sync service unavailable — Supabase not configured",
        )

    # 1) Capture server_time BEFORE reads
    server_time = datetime.now(timezone.utc).isoformat()

    # 2) Apply pending edits
    if req.pending_edits:
        await _apply_pending_edits(req.pending_edits, req.event_key)

    # 3) Determine since cutoff
    since = req.last_sync or _EPOCH

    # 4) Fetch delta
    try:
        changes = await _fetch_delta(req.event_key, since)
    except Exception as e:
        log.error("Delta fetch failed for %s: %s", req.event_key, e)
        raise HTTPException(status_code=500, detail="Sync delta fetch failed")

    return SyncResponse(server_time=server_time, changes=changes)
