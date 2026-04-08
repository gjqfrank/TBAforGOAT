"""Async Supabase client singleton for the Offline-First BFF backend.

Uses the service-role key (bypasses RLS) — this client is strictly
server-side.  Never expose the service key to browsers or native apps.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from supabase import acreate_client, AsyncClient

from ..config import SUPABASE_URL, SUPABASE_SERVICE_KEY

log = logging.getLogger(__name__)

# ── Singleton ───────────────────────────────────────────────
_client: Optional[AsyncClient] = None


async def get_supabase() -> AsyncClient:
    """Return the shared async Supabase client, creating it on first call."""
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. "
                "Add them to your .env file."
            )
        _client = await acreate_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        log.info("Supabase async client initialized (%s)", SUPABASE_URL)
    return _client


async def close_supabase() -> None:
    """Tear down the client on app shutdown."""
    global _client
    if _client is not None:
        # postgrest-py AsyncClient exposes .aclose() on the underlying httpx client
        try:
            await _client.postgrest.aclose()
        except Exception:
            pass
        _client = None
        log.info("Supabase client closed")


# ── Convenience helpers ─────────────────────────────────────
# Thin wrappers so callers don't need to import the table builder API.

async def upsert_rows(table: str, rows: list[dict[str, Any]]) -> None:
    """Bulk upsert rows into a Supabase table (on conflict = PK)."""
    if not rows:
        return
    sb = await get_supabase()
    await sb.table(table).upsert(rows).execute()


async def fetch_changed(
    table: str,
    since: str,
    *,
    eq_filters: Optional[dict[str, str]] = None,
) -> list[dict[str, Any]]:
    """Return rows where updated_at > `since` (ISO 8601 timestamp).

    Optional eq_filters narrow the query (e.g. {"event_key": "2026tuak"}).
    Used by the /sync endpoint to build delta payloads.
    """
    sb = await get_supabase()
    query = sb.table(table).select("*").gt("updated_at", since)
    if eq_filters:
        for col, val in eq_filters.items():
            query = query.eq(col, val)
    result = await query.execute()
    return result.data or []


# ── Event Summary Cache ─────────────────────────────────────

async def get_cached_summary(event_key: str) -> Optional[dict[str, Any]]:
    """Read cached event summary from Supabase.  Returns None on miss."""
    try:
        sb = await get_supabase()
        result = await (
            sb.table("event_summary_cache")
            .select("summary, awards, updated_at")
            .eq("event_key", event_key)
            .maybe_single()
            .execute()
        )
        return result.data if result.data else None
    except Exception as exc:
        log.warning("Supabase summary cache read failed for %s: %s", event_key, exc)
        return None


async def set_cached_summary(
    event_key: str,
    summary: Optional[dict] = None,
    awards: Optional[dict] = None,
) -> None:
    """Write (upsert) event summary / awards into Supabase cache."""
    try:
        row: dict[str, Any] = {"event_key": event_key}
        if summary is not None:
            row["summary"] = summary
        if awards is not None:
            row["awards"] = awards
        sb = await get_supabase()
        await sb.table("event_summary_cache").upsert(row).execute()
    except Exception as exc:
        log.warning("Supabase summary cache write failed for %s: %s", event_key, exc)


# ── Atomic JSONB merge for event_teams ──────────────────────

async def merge_event_teams(rows: list[dict[str, Any]]) -> None:
    """Atomically merge data into event_teams.raw_data using JSONB ||.

    Each row should have: ``{event_key, team_key, data: {...fields to merge...}}``.
    Uses the ``merge_event_teams_batch`` Postgres function from migration 05.
    """
    if not rows:
        return
    sb = await get_supabase()
    await sb.rpc("merge_event_teams_batch", {"p_rows": rows}).execute()


# ── Supabase-first read helpers ─────────────────────────────

async def read_events_by_year(year: int) -> list[dict[str, Any]]:
    """Return all events for a given year from the events table."""
    sb = await get_supabase()
    start = f"{year}-01-01"
    end = f"{year}-12-31"
    result = await (
        sb.table("events")
        .select("*")
        .gte("start_date", start)
        .lte("start_date", end)
        .execute()
    )
    return result.data or []


async def read_event(event_key: str) -> Optional[dict[str, Any]]:
    """Return a single event row, or None."""
    sb = await get_supabase()
    result = await (
        sb.table("events")
        .select("*")
        .eq("event_key", event_key)
        .maybe_single()
        .execute()
    )
    return result.data


async def read_event_teams_full(event_key: str) -> list[dict[str, Any]]:
    """Return event_teams joined with teams via the Postgres function."""
    sb = await get_supabase()
    result = await sb.rpc(
        "get_event_teams_full", {"p_event_key": event_key}
    ).execute()
    return result.data or []


async def read_matches(event_key: str) -> list[dict[str, Any]]:
    """Return all matches for an event."""
    sb = await get_supabase()
    result = await (
        sb.table("matches")
        .select("*")
        .eq("event_key", event_key)
        .order("comp_level")
        .order("set_number")
        .order("match_number")
        .execute()
    )
    return result.data or []


async def delete_orphaned_matches(
    event_key: str, valid_match_keys: set[str]
) -> int:
    """Delete matches in Supabase that are no longer in the live schedule.

    Returns the number of deleted rows.  If the live payload contains every
    match, this is a no-op.  Called after each match-poller upsert so that
    matches removed by the event operator (schedule regeneration) don't
    persist as ghost data.
    """
    if not valid_match_keys:
        return 0
    sb = await get_supabase()
    # Fetch existing match keys for this event
    existing = await (
        sb.table("matches")
        .select("match_key")
        .eq("event_key", event_key)
        .execute()
    )
    existing_keys = {r["match_key"] for r in (existing.data or [])}
    orphans = existing_keys - valid_match_keys
    if not orphans:
        return 0
    # Delete in one call
    await (
        sb.table("matches")
        .delete()
        .in_("match_key", list(orphans))
        .execute()
    )
    return len(orphans)


async def read_team_avatars(
    team_keys: list[str], year: int
) -> dict[str, str]:
    """Return {team_key: avatar_base64} for teams that have avatars."""
    if not team_keys:
        return {}
    sb = await get_supabase()
    result = await (
        sb.table("team_avatars")
        .select("team_key, avatar_base64")
        .in_("team_key", team_keys)
        .eq("year", year)
        .execute()
    )
    return {
        r["team_key"]: r["avatar_base64"]
        for r in (result.data or [])
        if r.get("avatar_base64")
    }


# ── FRC Events API data reads ──────────────────────────────

async def read_frc_playoff_matches(event_key: str) -> list[dict[str, Any]]:
    """Return raw FRC API match objects for playoff matches at an event.

    Uses the ``get_frc_playoff_matches`` Postgres function (migration 06)
    which returns ``matches.raw_data`` for comp_level IN ('sf','f').
    Each result is the full FRC API match dict (matchNumber, description,
    teams[], etc.).
    """
    sb = await get_supabase()
    result = await sb.rpc(
        "get_frc_playoff_matches", {"p_event_key": event_key}
    ).execute()
    return result.data or []


async def read_regional_pool_event(
    year: int, event_key: str
) -> Optional[dict[str, Any]]:
    """Return the per-event regional advancement detail from Supabase."""
    sb = await get_supabase()
    result = await (
        sb.table("regional_pool")
        .select("payload")
        .eq("year", year)
        .eq("event_key", event_key)
        .maybe_single()
        .execute()
    )
    if result.data:
        import json
        p = result.data.get("payload")
        return json.loads(p) if isinstance(p, str) else p
    return None


async def read_regional_pool_global(year: int) -> Optional[list[dict[str, Any]]]:
    """Return the global regional pool (qualified teams) from Supabase."""
    sb = await get_supabase()
    result = await (
        sb.table("regional_pool")
        .select("payload")
        .eq("year", year)
        .is_("event_key", "null")
        .maybe_single()
        .execute()
    )
    if result.data:
        import json
        p = result.data.get("payload")
        return json.loads(p) if isinstance(p, str) else p
    return None

