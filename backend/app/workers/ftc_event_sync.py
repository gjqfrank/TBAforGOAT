"""Warm-path FTC background worker — mirrors the FRC event_sync pattern.

Syncs FTC event metadata, teams, rankings/stats, alliances, and avatars
into the same Supabase tables (events, teams, event_teams) every 120 s.
Uses the flat JSONB || atomic merge to prevent race conditions.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any

from ..services.ftc_client import get_ftc_client
from ..services.ftcscout_client import get_ftcscout_client
from ..services.supabase_client import upsert_rows, merge_event_teams
from ..services.circuit_breaker import CircuitOpenError
from .schemas import FTCEvent, FTCTeam, FTCRanking, validate_list

log = logging.getLogger(__name__)

SYNC_INTERVAL = 120  # seconds between sweeps

# ── Shared state: lets the FTC match poller know which events are live ──
_ftc_active_events: set[str] = set()


def get_ftc_active_events() -> set[str]:
    return _ftc_active_events


def _strip_nulls(d: dict) -> dict:
    """Remove keys whose value is None so JSONB || won't nuke good data."""
    return {k: v for k, v in d.items() if v is not None}


def _invalidate_snapshot(event_key: str) -> None:
    """Clear disk + payload caches so they rebuild on next read."""
    try:
        from ..services import payload_cache
        payload_cache.invalidate("summary", event_key)
        payload_cache.invalidate("connections", event_key)
        payload_cache.invalidate("connections", f"{event_key}_all")
    except Exception:
        pass


def _event_status(start_str: str | None, end_str: str | None) -> str:
    """Return 'upcoming', 'ongoing', or 'completed'."""
    today = date.today()
    try:
        sd = date.fromisoformat(start_str[:10]) if start_str else today
        ed = date.fromisoformat(end_str[:10]) if end_str else today
    except (ValueError, TypeError):
        return "unknown"
    if today > ed + timedelta(days=1):
        return "completed"
    if today >= sd:
        return "ongoing"
    return "upcoming"


# ── Sync helpers ────────────────────────────────────────────


async def _sync_ftc_event_metadata(year: int) -> set[str]:
    """Fetch all FTC events for *year*, upsert into `events` table.

    Returns the set of event_keys that are currently ongoing.
    """
    client = get_ftc_client()
    try:
        raw_events = await client.get_events(year)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC event metadata sync")
        return _ftc_active_events
    except Exception as e:
        log.warning("FTC event metadata fetch failed: %s", e)
        return _ftc_active_events

    ongoing: set[str] = set()
    rows: list[dict[str, Any]] = []

    valid_events = validate_list(FTCEvent, raw_events, "ftc_events")
    if not valid_events:
        log.warning("All FTC events failed validation — skipping")
        return _ftc_active_events

    for ev_model in valid_events:
        ev = ev_model.model_dump()
        code = ev.get("code", "")
        if not code:
            continue
        event_key = f"{year}ftc{code}".lower()
        start = ev.get("dateStart", "")
        end = ev.get("dateEnd", "")
        status = _event_status(start, end)

        if status == "ongoing":
            ongoing.add(event_key)

        rows.append({
            "event_key": event_key,
            "name": ev.get("name", code),
            "start_date": start[:10] if start else None,
            "end_date": end[:10] if end else None,
            "competition_type": "ftc",
            "raw_data": _strip_nulls({
                "code": code,
                "type": ev.get("type"),
                "typeName": ev.get("typeName"),
                "regionCode": ev.get("regionCode"),
                "leagueCode": ev.get("leagueCode"),
                "divisionCode": ev.get("divisionCode"),
                "city": ev.get("city"),
                "stateprov": ev.get("stateprov"),
                "country": ev.get("country"),
                "venue": ev.get("venue"),
                "address": ev.get("address"),
                "website": ev.get("website"),
                "status": status,
            }),
        })

    if rows:
        try:
            await upsert_rows("events", rows)
            log.debug("Upserted %d FTC events for %d", len(rows), year)
        except Exception as e:
            log.warning("FTC event metadata upsert failed: %s", e)

    return ongoing


async def _sync_ftc_teams(event_key: str) -> None:
    """Fetch teams at an FTC event and upsert into teams + event_teams."""
    client = get_ftc_client()
    year, event_code = _parse_ftc_key(event_key)

    try:
        raw_teams = await client.get_event_teams(year, event_code)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC team sync for %s", event_key)
        return
    except Exception as e:
        log.warning("FTC team fetch failed for %s: %s", event_key, e)
        return

    if not raw_teams:
        return

    valid_teams = validate_list(FTCTeam, raw_teams, f"ftc_teams:{event_key}")
    if not valid_teams:
        return

    team_rows: list[dict[str, Any]] = []
    et_rows: list[dict[str, Any]] = []

    for t_model in valid_teams:
        t = t_model.model_dump()
        num = t.get("teamNumber")
        if not num:
            continue
        team_key = f"ftc{num}"

        team_rows.append({
            "team_key": team_key,
            "team_number": num,
            "nickname": t.get("nameShort") or t.get("nameFull") or "",
            "competition_type": "ftc",
            # Store full identity data so the Supabase-first read path
            # can serve city / state / school without an extra API call.
            "raw_tims_data": _strip_nulls({
                "full_name": t.get("nameFull"),
                "city": t.get("city"),
                "state_prov": t.get("stateprov") or t.get("stateProv"),
                "country": t.get("country"),
                "school_name": t.get("schoolName"),
                "rookie_year": t.get("rookieYear"),
            }),
        })

        et_rows.append({
            "event_key": event_key,
            "team_key": team_key,
        })

    if team_rows:
        try:
            await upsert_rows("teams", team_rows)
        except Exception as e:
            log.warning("FTC teams upsert failed for %s: %s", event_key, e)

    if et_rows:
        try:
            await upsert_rows("event_teams", et_rows)
        except Exception as e:
            log.warning("FTC event_teams upsert failed for %s: %s", event_key, e)

    log.debug("Synced %d FTC teams for %s", len(team_rows), event_key)


async def _sync_ftc_stats(event_key: str) -> None:
    """Fetch FTC Scout OPR/stats and merge into event_teams.raw_data."""
    year, event_code = _parse_ftc_key(event_key)
    scout = get_ftcscout_client()

    try:
        stats = await scout.get_event_team_stats(year, event_code)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC Scout stats for %s", event_key)
        return
    except Exception as e:
        log.warning("FTC Scout stats fetch failed for %s: %r", event_key, e)
        return

    if not stats:
        return

    rows: list[dict[str, Any]] = []
    for s in stats:
        # ftcscout_client.get_event_team_stats() returns snake_case keys
        num = s.get("team_number")
        if not num:
            continue
        team_key = f"ftc{num}"
        rows.append({
            "event_key": event_key,
            "team_key": team_key,
            "data": _strip_nulls({
                # OPR components (names match ftcscout_client output exactly)
                "opr_total": s.get("opr_total"),
                "opr_auto": s.get("opr_auto"),
                "opr_dc": s.get("opr_dc"),
                "opr_np": s.get("opr_np"),
                # Averages
                "avg_total": s.get("avg_total"),
                "avg_auto": s.get("avg_auto"),
                "avg_dc": s.get("avg_dc"),
                "avg_np": s.get("avg_np"),
                # Max / min / std dev
                "max_total": s.get("max_total"),
                "max_auto": s.get("max_auto"),
                "max_dc": s.get("max_dc"),
                "min_total": s.get("min_total"),
                "dev_total": s.get("dev_total"),
                # Global QuickStats ranking
                "quick_stats": s.get("quick_stats"),
                # Ranking context
                "rp": s.get("rp"),
                "tb1": s.get("tb1"),
                "wins": s.get("wins"),
                "losses": s.get("losses"),
                "ties": s.get("ties"),
                "qual_matches_played": s.get("qual_matches_played"),
            }),
        })

    if rows:
        try:
            await merge_event_teams(rows)
            log.debug("Merged FTC Scout stats for %d teams at %s", len(rows), event_key)
        except Exception as e:
            log.warning("FTC Scout stats merge failed for %s: %s", event_key, e)


async def _sync_ftc_rankings(event_key: str) -> None:
    """Fetch official FTC rankings and merge into event_teams.raw_data."""
    client = get_ftc_client()
    year, event_code = _parse_ftc_key(event_key)

    try:
        rankings = await client.get_rankings(year, event_code)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC rankings for %s", event_key)
        return
    except Exception as e:
        log.warning("FTC rankings fetch failed for %s: %s", event_key, e)
        return

    if not rankings:
        return

    valid_rankings = validate_list(FTCRanking, rankings, f"ftc_rankings:{event_key}")
    if not valid_rankings:
        return

    rows: list[dict[str, Any]] = []
    for r_model in valid_rankings:
        r = r_model.model_dump()
        num = r.get("teamNumber")
        if not num:
            continue
        rows.append({
            "event_key": event_key,
            "team_key": f"ftc{num}",
            "data": _strip_nulls({
                "rank": r.get("rank"),
                "wins": r.get("wins", 0),
                "losses": r.get("losses", 0),
                "ties": r.get("ties", 0),
                "qual_average": r.get("qualAverage"),
                "sort_orders": r.get("sortOrders"),
                "matches_played": r.get("matchesPlayed", 0),
                "dq": r.get("dq", 0),
            }),
        })

    if rows:
        try:
            await merge_event_teams(rows)
            log.debug("Merged FTC rankings for %d teams at %s", len(rows), event_key)
            _invalidate_snapshot(event_key)
        except Exception as e:
            log.warning("FTC rankings merge failed for %s: %s", event_key, e)


async def _sync_ftc_alliances(event_key: str) -> None:
    """Fetch FTC playoff alliances and merge into events.raw_data."""
    client = get_ftc_client()
    year, event_code = _parse_ftc_key(event_key)

    try:
        alliances = await client.get_alliances(year, event_code)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC alliances for %s", event_key)
        return
    except Exception as e:
        log.warning("FTC alliances fetch failed for %s: %s", event_key, e)
        return

    if not alliances:
        return

    # Read-modify-write into events.raw_data (same pattern as FRC event_sync)
    try:
        from ..services.supabase_client import get_supabase
        import json as _json

        sb = await get_supabase()
        resp = await sb.table("events").select("raw_data").eq(
            "event_key", event_key
        ).execute()

        if not resp.data:
            log.debug("Event row missing for %s — skipping FTC alliance store", event_key)
            return

        current_raw = resp.data[0].get("raw_data") or {}
        if isinstance(current_raw, str):
            current_raw = _json.loads(current_raw)

        current_raw["alliances"] = alliances
        await sb.table("events").update(
            {"raw_data": current_raw}
        ).eq("event_key", event_key).execute()
        log.debug("Stored FTC alliances for %s", event_key)
    except Exception as e:
        log.warning("FTC alliances upsert failed for %s: %s", event_key, e)


# ── Key parser (local copy to avoid circular imports) ───────

def _parse_ftc_key(event_key: str) -> tuple[int, str]:
    """Parse '2025ftcXYZ' → (2025, 'XYZ')."""
    key = event_key.lower()
    if "ftc" in key:
        idx = key.index("ftc")
        return int(key[:idx]), key[idx + 3:].upper()
    return int(event_key[:4]), event_key[4:].upper()


# ── Main loop ───────────────────────────────────────────────

async def run_ftc_event_sync(year: int | None = None) -> None:
    """Main loop — runs until cancelled."""
    if year is None:
        year = date.today().year

    # FTC API uses kickoff year (season 2025 = 2025-2026 "DECODE" season)
    # The current season year is typically the current calendar year - 1
    # if we're in the first half of the year (Jan-Aug)
    season = year if date.today().month >= 9 else year - 1

    log.info("FTC event sync started (season=%d, interval=%ds)", season, SYNC_INTERVAL)

    while True:
        try:
            # 1) Sync all FTC event metadata and discover ongoing events
            ongoing = await _sync_ftc_event_metadata(season)
            global _ftc_active_events
            _ftc_active_events = ongoing

            if ongoing:
                log.info("Active FTC events: %s", ", ".join(sorted(ongoing)))
            else:
                log.debug("No active FTC events found")

            # 2) For ongoing events, sync teams, alliances first (upsert-only),
            #    then stats + rankings (merge-heavy, serialised by _merge_lock)
            seed_tasks: list = []
            for ek in ongoing:
                seed_tasks.append(_sync_ftc_teams(ek))
                seed_tasks.append(_sync_ftc_alliances(ek))

            if seed_tasks:
                await asyncio.gather(*seed_tasks, return_exceptions=True)

            # Merge-heavy stats + rankings — one event at a time
            for ek in ongoing:
                try:
                    await _sync_ftc_stats(ek)
                except Exception as e:
                    log.warning("FTC stats sync failed for %s: %s", ek, e)
                try:
                    await _sync_ftc_rankings(ek)
                except Exception as e:
                    log.warning("FTC rankings sync failed for %s: %s", ek, e)

        except Exception as e:
            log.error("FTC event sync sweep error: %s", e)

        await asyncio.sleep(SYNC_INTERVAL)
