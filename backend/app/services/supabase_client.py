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
