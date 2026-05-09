"""Async Supabase client singleton for the Offline-First BFF backend.

Uses the service-role key (bypasses RLS) — this client is strictly
server-side.  Never expose the service key to browsers or native apps.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any, Optional

from postgrest.exceptions import APIError
from supabase import acreate_client, AsyncClient

from ..config import SUPABASE_URL, SUPABASE_SERVICE_KEY

log = logging.getLogger(__name__)

# ── Singleton ───────────────────────────────────────────────
_client: Optional[AsyncClient] = None

# ── Circuit breaker for Supabase outages (5xx) ──────────────
_cb_failures: int = 0
_cb_open_until: float = 0.0
_CB_THRESHOLD = 3       # consecutive 5xx failures before opening
_CB_COOLDOWN  = 30.0    # seconds to pause after circuit opens

# ── Per-event serialisation locks for merge_event_teams ────
# A single global lock previously serialised every event_teams write across
# the entire BFF, which became the dominant bottleneck during championship
# season (8 cmp divisions + cmptx merging into the same lock). Per-event
# locks let writes for different events proceed in parallel while still
# preventing intra-event deadlocks (overlapping team sets within one event).
_merge_locks: dict[str, asyncio.Lock] = {}
_merge_locks_guard = asyncio.Lock()
_MERGE_LOCKS_MAX = 256  # cap to prevent unbounded growth across a season


async def _get_merge_lock(event_key: str) -> asyncio.Lock:
    """Return (and lazily create) the per-event merge lock.

    Uses a tiny guard lock around dict mutation so two concurrent calls
    can't create two distinct lock objects for the same event_key.
    Opportunistically GCs entries when the dict grows past the cap.
    """
    lock = _merge_locks.get(event_key)
    if lock is not None:
        return lock
    async with _merge_locks_guard:
        lock = _merge_locks.get(event_key)
        if lock is None:
            if len(_merge_locks) >= _MERGE_LOCKS_MAX:
                # Drop a few unlocked entries (FIFO-ish via dict iteration)
                for k in list(_merge_locks)[: _MERGE_LOCKS_MAX // 4]:
                    other = _merge_locks[k]
                    if not other.locked():
                        del _merge_locks[k]
            lock = asyncio.Lock()
            _merge_locks[event_key] = lock
        return lock


def _is_circuit_open() -> bool:
    """Return True if the Supabase circuit breaker is open."""
    if _cb_failures < _CB_THRESHOLD:
        return False
    return time.monotonic() < _cb_open_until


def _record_success() -> None:
    global _cb_failures
    _cb_failures = 0


def _record_5xx() -> None:
    global _cb_failures, _cb_open_until
    _cb_failures += 1
    if _cb_failures >= _CB_THRESHOLD:
        _cb_open_until = time.monotonic() + _CB_COOLDOWN
        log.warning(
            "Supabase circuit breaker OPEN — pausing writes for %.0fs "
            "after %d consecutive 5xx failures",
            _CB_COOLDOWN, _cb_failures,
        )


def _is_server_error(exc: Exception) -> bool:
    """Detect Supabase 5xx / HTML error pages (e.g. Cloudflare 521)."""
    if isinstance(exc, APIError):
        code = exc.code
        # code can be str ("40P01") or int-like (521)
        try:
            numeric = int(code) if code is not None else 0
        except (ValueError, TypeError):
            return False
        return 500 <= numeric < 600
    # httpx or other transport-level errors
    msg = str(exc).lower()
    return "web server is down" in msg or "521" in msg


def _is_deadlock(exc: Exception) -> bool:
    """Detect Postgres deadlock error (40P01)."""
    if isinstance(exc, APIError):
        return str(exc.code) == "40P01"
    return "40P01" in str(exc)


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

_RETRY_MAX = 3
_RETRY_BASE = 0.2  # 200ms base for exponential backoff


async def _retry_on_deadlock(label: str, coro_factory):
    """Execute *coro_factory()* with retry-on-deadlock and circuit breaker.

    *coro_factory* is a zero-arg callable that returns a fresh awaitable
    each time (since a consumed coroutine can't be re-awaited).
    """
    if _is_circuit_open():
        log.debug("Supabase circuit open — skipping %s", label)
        return

    for attempt in range(1, _RETRY_MAX + 1):
        try:
            await coro_factory()
            _record_success()
            return
        except Exception as exc:
            if _is_server_error(exc):
                _record_5xx()
                log.warning("Supabase 5xx during %s: %s", label, _friendly_error(exc))
                return  # don't retry on server outage
            if _is_deadlock(exc) and attempt < _RETRY_MAX:
                wait = _RETRY_BASE * (2 ** (attempt - 1)) + random.uniform(0, 0.1)
                log.info("Deadlock on %s (attempt %d/%d) — retrying in %.2fs",
                         label, attempt, _RETRY_MAX, wait)
                await asyncio.sleep(wait)
                continue
            raise  # non-retryable or final attempt


def _friendly_error(exc: Exception) -> str:
    """Return a concise error string, stripping HTML from 521 responses."""
    s = str(exc)
    if len(s) > 200 or "<html" in s.lower():
        if isinstance(exc, APIError) and exc.code:
            return f"HTTP {exc.code}: {exc.message or 'server error'}"
        return s[:120] + "… (truncated)"
    return s


async def upsert_rows(table: str, rows: list[dict[str, Any]]) -> None:
    """Bulk upsert rows into a Supabase table (on conflict = PK).

    Retries on Postgres deadlock (40P01) up to 3 times.
    Respects the circuit breaker for 5xx outages.
    """
    if not rows:
        return

    async def _do():
        sb = await get_supabase()
        await sb.table(table).upsert(rows).execute()

    await _retry_on_deadlock(f"upsert:{table}({len(rows)} rows)", _do)


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
        return result.data if result and result.data else None
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

    Serialised via a *per-event* asyncio.Lock so that overlapping team sets
    within the same event don't deadlock, while writes targeting different
    events run in parallel. Retries on 40P01 if a deadlock still occurs
    (e.g. from external concurrent writers hitting the same rows).
    """
    if not rows:
        return

    # All rows in a single batch should target the same event_key (workers
    # always group by event). If they don't, fall back to a synthetic key so
    # we still serialise the call rather than risk cross-event interleaving.
    event_keys = {r.get("event_key") for r in rows if r.get("event_key")}
    if len(event_keys) == 1:
        lock_key = next(iter(event_keys))
    else:
        lock_key = "__multi__"

    async def _do():
        sb = await get_supabase()
        await sb.rpc("merge_event_teams_batch", {"p_rows": rows}).execute()

    lock = await _get_merge_lock(lock_key)
    async with lock:
        await _retry_on_deadlock(f"merge_event_teams({len(rows)} rows)", _do)


# ── Supabase-first read helpers ─────────────────────────────

async def get_season_record(record_key: str) -> Optional[dict[str, Any]]:
    """Read a season_records row by its primary key.  Returns None on miss."""
    try:
        sb = await get_supabase()
        result = await (
            sb.table("season_records")
            .select("payload, updated_at")
            .eq("record_key", record_key)
            .maybe_single()
            .execute()
        )
        return result.data if result and result.data else None
    except Exception as exc:
        log.warning("Supabase season_records read failed for %s: %s", record_key, exc)
        return None


async def set_season_record(
    record_key: str,
    year: int,
    record_type: str,
    payload: dict[str, Any],
) -> None:
    """Upsert a row into season_records."""
    try:
        sb = await get_supabase()
        await sb.table("season_records").upsert({
            "record_key": record_key,
            "year": year,
            "record_type": record_type,
            "payload": payload,
        }).execute()
    except Exception as exc:
        log.warning("Supabase season_records write failed for %s: %s", record_key, exc)


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

