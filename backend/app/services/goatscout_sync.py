"""GOATScout (Team 6907) prescout sync service.

Authenticates against `auth.team6907.org`, pulls prescout data from
`goatscout.team6907.org`, maps the report fields into TBAforGOAT's
`goatscout_data.metrics` JSONB column, and upserts rows per team.

Designed to be invoked two ways:
  * Manually via `POST /api/goatscout/{event_key}/sync-prescout`
  * Automatically by the lifespan background task in main.py

Configuration (all optional — sync simply no-ops if missing):
  * GOATSCOUT_EMAIL / GOATSCOUT_PASSWORD  — login credentials
  * GOATSCOUT_EVENT_MAP                  — JSON {"<event_key>": "<gs_event_uuid>"}
  * GOATSCOUT_SYNC_INTERVAL              — seconds between background runs
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

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

# Cookie name set by GOATLab SSO — we send it back on every scout API call.
SESSION_COOKIE = "__Secure-goatlab_session"

# Author identity written into goatscout_data rows for synced records.
SYNC_AUTHOR_DEVICE = "goatscout-sync"
SYNC_AUTHOR_NAME = "GOATScout Sync"

# HTTP timeouts — auth/team6907.org is occasionally slow.
_HTTP_TIMEOUT = 30.0


# ── Event mapping ──────────────────────────────────────────
def _load_event_map() -> dict[str, str]:
    """Parse GOATSCOUT_EVENT_MAP env var (JSON) into a dict.

    Returns ``{tbaforge_event_key: goatscout_event_uuid}``.
    """
    if not GOATSCOUT_EVENT_MAP:
        return {}
    try:
        data = json.loads(GOATSCOUT_EVENT_MAP)
        if not isinstance(data, dict):
            log.warning("GOATSCOUT_EVENT_MAP is not a JSON object — ignoring")
            return {}
        # Normalise keys/values to strings.
        return {str(k): str(v) for k, v in data.items()}
    except (json.JSONDecodeError, TypeError) as exc:
        log.warning("GOATSCOUT_EVENT_MAP parse error: %s", exc)
        return {}


def get_goatscout_event_id(event_key: str) -> Optional[str]:
    """Return the GOATScout event UUID mapped to a TBAforGOAT event_key."""
    return _load_event_map().get(event_key)


# ── Auth ──────────────────────────────────────────────────
async def _login(client: httpx.AsyncClient) -> str:
    """Authenticate against auth.team6907.org and return the session cookie.

    Raises RuntimeError on any failure (bad credentials, network, etc.).
    """
    if not GOATSCOUT_EMAIL or not GOATSCOUT_PASSWORD:
        raise RuntimeError(
            "GOATSCOUT_EMAIL and GOATSCOUT_PASSWORD must be set to sync prescout data."
        )

    payload = {
        "login": GOATSCOUT_EMAIL,
        "password": GOATSCOUT_PASSWORD,
        # returnTo just needs to be on the *.team6907.org domain — the cookie
        # is scoped to the whole domain, so any subdomain URL works.
        "returnTo": f"{SCOUT_BASE}/api/me",
    }
    resp = await client.post(
        LOGIN_URL,
        json=payload,
        timeout=_HTTP_TIMEOUT,
        follow_redirects=False,  # we only need the Set-Cookie header
    )
    if resp.status_code >= 400:
        # Body often contains a JSON error message.
        try:
            body = resp.json()
            detail = body.get("error") or body.get("message") or resp.text[:200]
        except Exception:
            detail = resp.text[:200]
        raise RuntimeError(f"GOATScout login failed (HTTP {resp.status_code}): {detail}")

    cookie = resp.cookies.get(SESSION_COOKIE)
    if not cookie:
        # Some deployments return the cookie under a different casing or path.
        # Walk all set cookies and pick the one whose name matches.
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
async def _fetch_prescout_list(
    client: httpx.AsyncClient, event_id: str, cookie: str
) -> list[dict[str, Any]]:
    """Return the team list for a GOATScout event (with prescout status)."""
    resp = await client.get(
        f"{SCOUT_BASE}/api/events/{event_id}/prescout",
        cookies={SESSION_COOKIE: cookie},
        timeout=_HTTP_TIMEOUT,
    )
    resp.raise_for_status()
    body = resp.json()
    # Body shape: {"event": {...}, "teams": [{eventTeamId, teamNumber, status, ...}]}
    return body.get("teams", []) if isinstance(body, dict) else []


async def _fetch_team_prescout(
    client: httpx.AsyncClient,
    event_id: str,
    event_team_id: str,
    cookie: str,
) -> Optional[dict[str, Any]]:
    """Return the detailed prescout report for a single team, or None."""
    resp = await client.get(
        f"{SCOUT_BASE}/api/events/{event_id}/prescout/{event_team_id}",
        cookies={SESSION_COOKIE: cookie},
        timeout=_HTTP_TIMEOUT,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


# ── Field mapping ─────────────────────────────────────────
# GOATScout prescout report fields → TBAforGOAT metrics keys.
# We mirror the report's snake_case field names directly so the frontend
# GoatScout editor can render them without renaming.
_REPORT_FIELDS: tuple[str, ...] = (
    "robotHeight",
    "robotHeightOther",
    "bumpTraversal",
    "shooter",
    "shooterOther",
    "hood",
    "intake",
    "intakeOther",
    "autoClimb",
    "manualClimimb",
    "autoRoutine",
    "autoRoutineOther",
    "trenchCapacityMode",
    "trenchCapacity",
    "maxCapacity",
)


def _map_report_to_metrics(report: dict[str, Any] | None) -> dict[str, Any]:
    """Translate a GOATScout prescout report into a metrics dict.

    Returns an empty dict when ``report`` is None or contains no recognised
    fields, so callers can skip writing empty rows.
    """
    if not isinstance(report, dict):
        return {}
    metrics: dict[str, Any] = {}
    for field in _REPORT_FIELDS:
        if field in report:
            value = report[field]
            # Skip null/empty values to keep metrics sparse & merge-friendly.
            if value is None or value == "":
                continue
            metrics[field] = value
    # Preserve any extra fields the GOATScout schema may add later
    # (e.g. free-form notes). Skip the obvious structural ones.
    _EXTRA_SKIP = {"id", "eventTeamId", "eventTeam", "updatedAt", "updatedBy"}
    for key, value in report.items():
        if key in _REPORT_FIELDS or key in _EXTRA_SKIP:
            continue
        if value is None or value == "":
            continue
        metrics[key] = value
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
        # Merge: prefer incoming synced values, but keep any keys the local
        # editor added that GOATScout doesn't know about.
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

    # History log (best-effort — failure here shouldn't fail the sync).
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
async def sync_event(event_key: str) -> dict[str, Any]:
    """Sync GOATScout prescout data into goatscout_data for one event.

    Returns a summary dict: ``{synced: int, skipped: int, total: int, event_id, error?}``.
    """
    event_id = get_goatscout_event_id(event_key)
    if not event_id:
        return {
            "synced": 0,
            "skipped": 0,
            "total": 0,
            "error": f"No GOATScout event mapping for '{event_key}'. Set GOATSCOUT_EVENT_MAP.",
        }
    if not GOATSCOUT_EMAIL or not GOATSCOUT_PASSWORD:
        return {
            "synced": 0,
            "skipped": 0,
            "total": 0,
            "error": "GOATSCOUT_EMAIL / GOATSCOUT_PASSWORD not configured.",
        }

    async with httpx.AsyncClient() as client:
        try:
            cookie = await _login(client)
        except Exception as exc:
            log.error("GOATScout sync login failed: %s", exc)
            return {"synced": 0, "skipped": 0, "total": 0, "error": str(exc)}

        try:
            teams = await _fetch_prescout_list(client, event_id, cookie)
        except Exception as exc:
            log.error("GOATScout prescout list fetch failed: %s", exc)
            return {"synced": 0, "skipped": 0, "total": 0, "error": str(exc)}

        synced = 0
        skipped = 0
        for team in teams:
            team_number = team.get("teamNumber")
            status = team.get("status")
            event_team_id = team.get("eventTeamId")
            if not team_number or not event_team_id:
                skipped += 1
                continue
            # Skip teams with no prescout entered yet — saves 43 API calls when
            # nothing has been filled in.
            if status == "empty":
                skipped += 1
                continue
            try:
                detail = await _fetch_team_prescout(
                    client, event_id, event_team_id, cookie
                )
            except Exception as exc:
                log.warning(
                    "GOATScout prescout fetch failed for team %s: %s",
                    team_number, exc,
                )
                skipped += 1
                continue

            report = (detail or {}).get("report") if isinstance(detail, dict) else None
            metrics = _map_report_to_metrics(report)
            team_key = f"frc{team_number}"
            try:
                if await _upsert_team(event_key, team_key, metrics):
                    synced += 1
                else:
                    skipped += 1
            except Exception as exc:
                log.error(
                    "goatscout_data upsert failed for %s: %s", team_key, exc
                )
                skipped += 1

    log.info(
        "GOATScout sync %s → %d synced, %d skipped, %d total",
        event_key, synced, skipped, len(teams),
    )
    return {
        "synced": synced,
        "skipped": skipped,
        "total": len(teams),
        "event_id": event_id,
    }


async def sync_all_mapped_events() -> list[dict[str, Any]]:
    """Sync every event listed in GOATSCOUT_EVENT_MAP. Used by the background task."""
    event_map = _load_event_map()
    if not event_map:
        return []
    results = []
    for event_key in event_map:
        try:
            results.append({**await sync_event(event_key), "event_key": event_key})
        except Exception as exc:
            log.error("GOATScout sync failed for %s: %s", event_key, exc)
            results.append({
                "event_key": event_key,
                "synced": 0,
                "skipped": 0,
                "total": 0,
                "error": str(exc),
            })
    return results
