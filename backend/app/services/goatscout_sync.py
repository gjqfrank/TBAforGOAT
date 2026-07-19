"""GOATScout (Team 6907) scouting sync service.

Pulls prescout + match scouting data from `goatscout.team6907.org` and
writes it into TBAforGOAT's `goatscout_data.metrics` JSONB column.

Uses the `/api/analysis?eventId=...&stage=...` endpoint which returns both
prescout rows and stage-specific match scouting rows in a single call.
Three calls (practice / qualification / playoff) fetch everything.

Design:
  * prescout fields are stored WITHOUT a prefix (backward-compatible with
    the existing GoatScout editor).
  * match scouting metrics (54 per-team stats produced by GOATScout's
    analysis pipeline) are stored WITH a stage prefix:
      `qual_start_trenchFront`, `practice_centerlineTrips`, `playoff_...`
    This keeps each stage's data in its own namespace so a re-sync of one
    stage doesn't clobber another.

Invoked two ways:
  * Manually: `POST /api/goatscout/{event_key}/sync-prescout`
  * Background: main.py lifespan task every GOATSCOUT_SYNC_INTERVAL seconds
"""
from __future__ import annotations

import json
import logging
from typing import Any, Iterable, Optional

import httpx

from ..config import (
    GOATSCOUT_EMAIL,
    GOATSCOUT_PASSWORD,
    GOATSCOUT_EVENT_MAP,
)
from .supabase_client import get_supabase

log = logging.getLogger(__name__)

# ── Endpoints ───────────────────────────────────────────────
AUTH_BASE = "https://auth.team6907.org"
SCOUT_BASE = "https://goatscout.team6907.org"
LOGIN_URL = f"{AUTH_BASE}/api/login"
ANALYSIS_URL = f"{SCOUT_BASE}/api/analysis"

# Cookie name set by GOATLab SSO.
SESSION_COOKIE = "__Secure-goatlab_session"

# Author identity written into goatscout_data rows for synced records.
SYNC_AUTHOR_DEVICE = "goatscout-sync"
SYNC_AUTHOR_NAME = "GOATScout Sync"

_HTTP_TIMEOUT = 30.0

# Stages synced on every run. `qualification` is GOATScout's default
# (what `/scout/{eventId}` with no ?stage= shows).
DEFAULT_STAGES: tuple[str, ...] = ("practice", "qualification", "playoff")

# ── Meta fields (excluded from metrics mapping) ────────────
# prescoutRows meta fields — everything else is a prescout metric.
_PRESCOUT_META: frozenset[str] = frozenset({
    "eventTeamId", "teamNumber", "displayName", "status",
    "photoCount", "photoUrls", "updatedByDisplayName", "updatedAt",
})

# analysis `rows` meta fields — everything else is a computed metric.
# The row schema isn't fully known yet (no matches played), so we
# exclude only the obvious identifiers and let everything else through.
_ROW_META: frozenset[str] = frozenset({
    "eventTeamId", "teamNumber", "displayName",
    "teamKey", "matchCount", "sessionCount", "teamMatchCount",
})

# Short prefix used for qualification-stage metrics to match TBA
# convention ("qm" = qualification match).
_STAGE_PREFIX: dict[str, str] = {
    "practice": "practice",
    "qualification": "qual",
    "playoff": "playoff",
}


# ── Event mapping ──────────────────────────────────────────
def _load_event_map() -> dict[str, str]:
    """Parse GOATSCOUT_EVENT_MAP env var (JSON) into a dict."""
    if not GOATSCOUT_EVENT_MAP:
        return {}
    try:
        data = json.loads(GOATSCOUT_EVENT_MAP)
        if not isinstance(data, dict):
            log.warning("GOATSCOUT_EVENT_MAP is not a JSON object — ignoring")
            return {}
        return {str(k): str(v) for k, v in data.items()}
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning("GOATSCOUT_EVENT_MAP parse error: %s", exc)
        return {}


def get_goatscout_event_id(event_key: str) -> Optional[str]:
    """Return the GOATScout event UUID mapped to a TBAforGOAT event_key."""
    return _load_event_map().get(event_key)


# ── Auth ──────────────────────────────────────────────────
async def _login(client: httpx.AsyncClient) -> str:
    """Authenticate against auth.team6907.org and return the session cookie."""
    if not GOATSCOUT_EMAIL or not GOATSCOUT_PASSWORD:
        raise RuntimeError(
            "GOATSCOUT_EMAIL and GOATSCOUT_PASSWORD must be set to sync scouting data."
        )
    payload = {
        "login": GOATSCOUT_EMAIL,
        "password": GOATSCOUT_PASSWORD,
        "returnTo": f"{SCOUT_BASE}/api/me",
    }
    resp = await client.post(
        LOGIN_URL, json=payload, timeout=_HTTP_TIMEOUT, follow_redirects=False,
    )
    if resp.status_code >= 400:
        try:
            body = resp.json()
            detail = body.get("error") or body.get("message") or resp.text[:200]
        except Exception:
            detail = resp.text[:200]
        raise RuntimeError(f"GOATScout login failed (HTTP {resp.status_code}): {detail}")
    cookie = resp.cookies.get(SESSION_COOKIE)
    if not cookie:
        for name, value in resp.cookies.items():
            if name == SESSION_COOKIE:
                cookie = value
                break
    if not cookie:
        raise RuntimeError(
            f"GOATScout login succeeded but '{SESSION_COOKIE}' cookie was not set."
        )
    log.info("GOATScout login OK for %s", GOATSCOUT_EMAIL)
    return cookie


# ── Fetch ────────────────────────────────────────────────
async def _fetch_analysis(
    client: httpx.AsyncClient, event_id: str, cookie: str, stage: str
) -> dict[str, Any]:
    """Fetch the analysis payload for one stage.

    Returns ``{event, metrics, rows, recordSummary, prescoutCoverage, prescoutRows}``.
    """
    resp = await client.get(
        ANALYSIS_URL,
        params={"eventId": event_id, "stage": stage},
        cookies={SESSION_COOKIE: cookie},
        timeout=_HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


# ── Field mapping ─────────────────────────────────────────
def _map_prescout_row(row: dict[str, Any]) -> dict[str, Any]:
    """Map a prescoutRows entry to metrics (no stage prefix).

    Drops null/empty values so the metrics dict stays sparse and
    merge-friendly.
    """
    metrics: dict[str, Any] = {}
    for key, value in row.items():
        if key in _PRESCOUT_META:
            continue
        if value is None or value == "":
            continue
        metrics[key] = value
    return metrics


def _map_analysis_row(row: dict[str, Any], stage: str) -> dict[str, Any]:
    """Map an analysis ``rows`` entry to metrics with a stage prefix.

    Each metric becomes ``{prefix}_{metricId}`` (e.g. ``qual_start_trenchFront``)
    so multiple stages can coexist in the same metrics JSONB without clobbering.
    """
    prefix = _STAGE_PREFIX.get(stage, stage)
    metrics: dict[str, Any] = {}
    for key, value in row.items():
        if key in _ROW_META:
            continue
        if value is None or value == "":
            continue
        metrics[f"{prefix}_{key}"] = value
    return metrics


# ── Upsert ───────────────────────────────────────────────
async def _upsert_team(
    event_key: str, team_key: str, metrics: dict[str, Any]
) -> bool:
    """Field-level merge upsert into goatscout_data. Returns True on write."""
    if not metrics:
        return False
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
        merged = {**old_metrics, **metrics}
        row = {
            "id": existing.data[0]["id"],
            "team_key": team_key,
            "event_key": event_key,
            "metrics": merged,
            "author_device_id": existing.data[0].get("author_device_id") or SYNC_AUTHOR_DEVICE,
            "is_deleted": False,
        }
        await sb.table("goatscout_data").update(row).eq("id", existing.data[0]["id"]).execute()
    else:
        row = {
            "team_key": team_key,
            "event_key": event_key,
            "metrics": metrics,
            "author_device_id": SYNC_AUTHOR_DEVICE,
            "author_name": SYNC_AUTHOR_NAME,
            "is_deleted": False,
        }
        await sb.table("goatscout_data").upsert(row).execute()

    # History log (best-effort).
    history_row = {
        "team_key": team_key,
        "event_key": event_key,
        "author_name": SYNC_AUTHOR_NAME,
        "snapshot": metrics,
    }
    try:
        await sb.table("goatscout_data_history").insert(history_row).execute()
    except Exception as exc:
        log.debug("goatscout_data_history insert failed for %s: %s", team_key, exc)
    return True


# ── Public entrypoint ─────────────────────────────────────
async def sync_event(
    event_key: str,
    stages: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    """Sync GOATScout scouting data into goatscout_data for one event.

    Fetches prescout data + match-scouting data for each stage and
    field-level-merges everything into goatscout_data.metrics per team.

    Returns ``{synced, skipped, total, event_id, stages, error?}``.
    """
    event_id = get_goatscout_event_id(event_key)
    if not event_id:
        return {
            "synced": 0, "skipped": 0, "total": 0,
            "error": f"No GOATScout event mapping for '{event_key}'. Set GOATSCOUT_EVENT_MAP.",
        }
    if not GOATSCOUT_EMAIL or not GOATSCOUT_PASSWORD:
        return {
            "synced": 0, "skipped": 0, "total": 0,
            "error": "GOATSCOUT_EMAIL / GOATSCOUT_PASSWORD not configured.",
        }

    stage_list = list(stages) if stages is not None else list(DEFAULT_STAGES)

    async with httpx.AsyncClient() as client:
        try:
            cookie = await _login(client)
        except Exception as exc:
            log.error("GOATScout sync login failed: %s", exc)
            return {"synced": 0, "skipped": 0, "total": 0, "error": str(exc)}

        # Accumulate per-team metrics across all stages.
        team_metrics: dict[str, dict[str, Any]] = {}
        prescout_done = False
        stage_summaries: list[dict[str, Any]] = []

        for stage in stage_list:
            try:
                data = await _fetch_analysis(client, event_id, cookie, stage)
            except Exception as exc:
                log.error("GOATScout analysis fetch failed for stage=%s: %s", stage, exc)
                stage_summaries.append({
                    "stage": stage, "error": str(exc),
                    "prescout": 0, "rows": 0,
                })
                continue

            prescout_rows = data.get("prescoutRows") or []
            analysis_rows = data.get("rows") or []

            # Process prescoutRows only once — they're identical across stages.
            if not prescout_done and prescout_rows:
                prescout_count = 0
                for row in prescout_rows:
                    team_number = row.get("teamNumber")
                    if not team_number:
                        continue
                    team_key = f"frc{team_number}"
                    mapped = _map_prescout_row(row)
                    if mapped:
                        team_metrics.setdefault(team_key, {}).update(mapped)
                        prescout_count += 1
                prescout_done = True
                log.info(
                    "GOATScout sync %s: prescout mapped %d teams",
                    event_key, prescout_count,
                )

            # Process stage-specific analysis rows.
            row_count = 0
            for row in analysis_rows:
                team_number = row.get("teamNumber")
                if not team_number:
                    continue
                team_key = f"frc{team_number}"
                mapped = _map_analysis_row(row, stage)
                if mapped:
                    team_metrics.setdefault(team_key, {}).update(mapped)
                    row_count += 1

            stage_summaries.append({
                "stage": stage,
                "prescout": len(prescout_rows),
                "rows": len(analysis_rows),
                "rows_mapped": row_count,
            })
            log.info(
                "GOATScout sync %s stage=%s: prescout=%d rows=%d mapped=%d",
                event_key, stage, len(prescout_rows), len(analysis_rows), row_count,
            )

        # Upsert all accumulated team metrics.
        synced = 0
        skipped = 0
        for team_key, metrics in team_metrics.items():
            try:
                if await _upsert_team(event_key, team_key, metrics):
                    synced += 1
                else:
                    skipped += 1
            except Exception as exc:
                log.error("goatscout_data upsert failed for %s: %s", team_key, exc)
                skipped += 1

    log.info(
        "GOATScout sync %s complete: %d synced, %d skipped, %d total teams",
        event_key, synced, skipped, len(team_metrics),
    )
    return {
        "synced": synced,
        "skipped": skipped,
        "total": len(team_metrics),
        "event_id": event_id,
        "stages": stage_summaries,
    }


async def sync_all_mapped_events() -> list[dict[str, Any]]:
    """Sync every event listed in GOATSCOUT_EVENT_MAP. Used by the background task."""
    event_map = _load_event_map()
    if not event_map:
        return []
    results = []
    for event_key in event_map:
        try:
            result = await sync_event(event_key)
            results.append({**result, "event_key": event_key})
        except Exception as exc:
            log.error("GOATScout sync failed for %s: %s", event_key, exc)
            results.append({
                "event_key": event_key,
                "synced": 0, "skipped": 0, "total": 0,
                "error": str(exc),
            })
    return results
