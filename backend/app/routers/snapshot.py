"""GET /api/events/{event_key}/snapshot — Cached full-event payload.

Returns the same data shapes that the individual endpoints
(/events/{ek}/info, /events/{ek}/teams, /matches/{ek}/all,
/alliances/{ek}, /matches/{ek}/playoffs) return, but bundled
into one response.

On first load the Ingestion Engine stores the raw API data in
Supabase (so delta-sync works and workers keep it fresh), then
the enrichment layer builds the presentation-ready snapshot and
caches it to disk.

Workers (event_sync + match_poller) invalidate stale snapshots
by calling invalidate_snapshot().
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ..services.cache_service import CACHE_DIR
from ..services.error_utils import raise_api_error
from ..services.inflight import coalesce

log = logging.getLogger(__name__)
router = APIRouter()

# Snapshot TTL — stale after this many seconds (auto-refresh on next request).
# Realtime push updates already drive live UI refreshes, so the snapshot only
# needs to stay fresh for *cold loaders* (newly-opened tabs / shared links).
# Bumping this from 5 min → 30 min dramatically reduces the rebuild churn that
# previously fired on every match-poller / event-sync write.
_SNAPSHOT_TTL = 1800      # 30 min — serve from cache
_SNAPSHOT_STALE = 7200    # 2 hr — serve stale while rebuilding in background

# In-flight locks to prevent thundering herd on the same event.
# (Kept for backwards compat; new build path uses inflight.coalesce instead.)
_build_locks: dict[str, asyncio.Lock] = {}


def _snapshot_path(event_key: str) -> Path:
    return CACHE_DIR / f"snap_{event_key}.json"


def invalidate_snapshot(event_key: str) -> None:
    """Delete a cached snapshot (called by workers when data changes)."""
    p = _snapshot_path(event_key)
    if p.exists():
        p.unlink(missing_ok=True)


def _read_snapshot(event_key: str) -> tuple[dict | None, bool]:
    """Read snapshot from disk. Returns (data, is_fresh).
    
    - Fresh (age < TTL): use directly.
    - Stale (TTL < age < STALE): serve immediately, trigger background rebuild.
    - Expired (age > STALE): return None — must rebuild synchronously.
    """
    p = _snapshot_path(event_key)
    if not p.exists():
        return None, False
    try:
        raw = json.loads(p.read_text(encoding="utf-8"))
        age = time.time() - raw.get("_ts", 0)
        if age <= _SNAPSHOT_TTL:
            return raw, True       # fresh
        if age <= _SNAPSHOT_STALE:
            return raw, False      # stale but usable
        return None, False         # expired
    except Exception:
        return None, False


def _write_snapshot(event_key: str, payload: dict) -> None:
    """Write snapshot to disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    payload["_ts"] = time.time()
    p = _snapshot_path(event_key)
    p.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


async def _build_snapshot(event_key: str) -> dict:
    """Assemble a full snapshot by calling the existing service layer."""
    from ..services import event_service, alliance_service, summary_service

    # Import the match router's handler to reuse its enrichment logic
    from . import matches as matches_mod

    # Fetch all data sets in parallel using the existing service functions
    info_coro = event_service.get_event_info(event_key)
    teams_coro = event_service.get_event_teams_with_stats(event_key)
    matches_coro = matches_mod.get_all_matches(event_key)
    alliances_coro = alliance_service.get_alliances_with_stats(event_key)
    playoffs_coro = matches_mod.get_playoff_matches(event_key)
    summary_coro = summary_service.get_event_summary(event_key)

    # alliances + playoffs + summary may not exist yet (upcoming events)
    results = await asyncio.gather(
        info_coro,
        teams_coro,
        matches_coro,
        _safe(alliances_coro),
        _safe(playoffs_coro),
        _safe(summary_coro),
    )

    info, teams, matches_data, alliances, playoffs, summary = results

    return {
        "event_key": event_key,
        "info": info,
        "teams": teams,
        "matches": matches_data,
        "alliances": alliances,
        "playoffs": playoffs,
        "summary": summary,
    }


async def _safe(coro):
    """Swallow errors — some data may not be available yet."""
    try:
        return await coro
    except Exception:
        return None


async def _background_rebuild(event_key: str):
    """Rebuild snapshot in background (stale-while-revalidate).

    Wrapped in coalesce() so concurrent stale reads don't kick off N parallel
    rebuilds for the same event \u2014 one rebuild fans out to all waiters.
    """
    try:
        payload = await coalesce(
            f"snapshot_build:{event_key}", _build_snapshot, event_key,
        )
        _write_snapshot(event_key, payload)
        log.info("Background rebuild of %s snapshot complete", event_key)
    except Exception:
        log.warning("Background rebuild of %s snapshot failed", event_key, exc_info=True)


async def _ingest_and_build(event_key: str) -> dict:
    """Cold-miss path: ensure ingestion, then build the snapshot.

    Lives behind coalesce() so a cmptx-style burst of cold loaders that all
    arrive in the same second collapses to a single TBA fan-out.
    """
    from ..services import ingestion_service
    if not await ingestion_service.is_ingested(event_key):
        await ingestion_service.ingest_event(event_key)
    payload = await _build_snapshot(event_key)
    _write_snapshot(event_key, payload)
    return payload


@router.get("/{event_key}/snapshot")
async def event_snapshot(event_key: str):
    """Return a cached full-event payload, assembling it on first request."""
    # Fast path: serve from disk cache
    cached, fresh = _read_snapshot(event_key)
    if cached and fresh:
        cached["_cached"] = True
        return cached

    # Stale-while-revalidate: serve stale data and rebuild in background.
    # The rebuild itself is coalesced, so multiple stale-readers don't
    # trigger multiple rebuilds.
    if cached and not fresh:
        asyncio.create_task(_background_rebuild(event_key))
        cached["_cached"] = True
        cached["_stale"] = True
        return cached

    # Cold miss \u2014 single-flight the whole ingest + build under one key so
    # a burst of N concurrent first-time loaders only does one upstream sweep.
    try:
        # Re-check disk inside the coalesced call (another request may have
        # written it between our miss and our turn at the future).
        cached_again, _ = _read_snapshot(event_key)
        if cached_again:
            cached_again["_cached"] = True
            return cached_again

        payload = await coalesce(
            f"snapshot_build:{event_key}", _ingest_and_build, event_key,
        )
        payload = dict(payload)  # don't mutate cached future result
        payload["_cached"] = False
        return payload
    except HTTPException:
        raise
    except Exception as e:
        log.exception("Snapshot build failed for %s", event_key)
        raise_api_error(
            e,
            fallback_detail=f"Could not build snapshot for '{event_key}'.",
        )



