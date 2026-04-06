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

log = logging.getLogger(__name__)
router = APIRouter()

# Snapshot TTL — stale after this many seconds (auto-refresh on next request)
_SNAPSHOT_TTL = 300       # 5 min — serve from cache; live-refresh timers handle updates
_SNAPSHOT_STALE = 600     # 10 min — serve stale while rebuilding in background

# In-flight locks to prevent thundering herd on the same event
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
    """Rebuild snapshot in background (stale-while-revalidate)."""
    try:
        payload = await _build_snapshot(event_key)
        _write_snapshot(event_key, payload)
        log.info("Background rebuild of %s snapshot complete", event_key)
    except Exception:
        log.warning("Background rebuild of %s snapshot failed", event_key, exc_info=True)


@router.get("/{event_key}/snapshot")
async def event_snapshot(event_key: str):
    """Return a cached full-event payload, assembling it on first request."""
    # Fast path: serve from disk cache
    cached, fresh = _read_snapshot(event_key)
    if cached and fresh:
        cached["_cached"] = True
        return cached

    # Stale-while-revalidate: serve stale data and rebuild in background
    if cached and not fresh:
        asyncio.create_task(_background_rebuild(event_key))
        cached["_cached"] = True
        cached["_stale"] = True
        return cached

    # Cold miss — ingest into Supabase, then build snapshot
    if event_key not in _build_locks:
        _build_locks[event_key] = asyncio.Lock()

    lock = _build_locks[event_key]
    async with lock:
        # Double-check after acquiring lock (another request may have built it)
        cached, _ = _read_snapshot(event_key)
        if cached:
            cached["_cached"] = True
            return cached

        try:
            # Step 1: Ensure the event is ingested into Supabase
            from ..services import ingestion_service
            if not await ingestion_service.is_ingested(event_key):
                await ingestion_service.ingest_event(event_key)

            # Step 2: Build enriched snapshot from service layer
            # (hits TBA in-memory cache warmed by ingestion)
            payload = await _build_snapshot(event_key)
            _write_snapshot(event_key, payload)
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
