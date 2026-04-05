"""Warm-path worker: syncs event metadata, team lists, OPRs, and alliance
selections from TBA every 120 seconds, plus EPA from Statbotics.

Also maintains the set of 'active' (ongoing) events that the hot-path
match poller uses.

This worker runs as a single asyncio task started by the FastAPI lifespan.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, timedelta

from ..services.tba_client import get_tba_client
from ..services.statbotics_client import get_statbotics_client, get_epa_map
from ..services.supabase_client import upsert_rows
from ..services.circuit_breaker import CircuitOpenError
from .match_poller import set_active_events

log = logging.getLogger(__name__)

SYNC_INTERVAL = 120  # seconds between full sweeps


def _event_status(start_date: str, end_date: str) -> str:
    """Return 'upcoming', 'ongoing', or 'completed'."""
    today = date.today()
    try:
        sd = date.fromisoformat(start_date)
        ed = date.fromisoformat(end_date)
    except (ValueError, TypeError):
        return "unknown"
    if today > ed + timedelta(days=1):
        return "completed"
    if today >= sd:
        return "ongoing"
    return "upcoming"


async def _sync_event_metadata(year: int) -> set[str]:
    """Fetch all events for *year* from TBA, upsert into Supabase,
    and return the set of ongoing event keys."""
    tba = get_tba_client()

    try:
        raw_events = await tba.get_events_by_year(year)
    except CircuitOpenError:
        log.debug("Circuit open for TBA — skipping event metadata sync")
        return set()
    except Exception as e:
        log.warning("Event metadata fetch failed: %s", e)
        return set()

    if not raw_events:
        return set()

    ongoing: set[str] = set()
    rows = []
    for ev in raw_events:
        etype = ev.get("event_type", -1)
        if etype in {-1, 100}:  # junk types
            continue

        start = ev.get("start_date", "")
        end = ev.get("end_date", "")
        status = _event_status(start, end)
        if status == "ongoing":
            ongoing.add(ev["key"])

        rows.append({
            "event_key": ev["key"],
            "name": ev.get("name", ""),
            "start_date": start or None,
            "end_date": end or None,
            "competition_type": "frc",
            "raw_data": json.dumps({
                "city": ev.get("city", ""),
                "state_prov": ev.get("state_prov", ""),
                "country": ev.get("country", ""),
                "event_type": etype,
                "event_type_string": ev.get("event_type_string", ""),
                "district": ev.get("district"),
                "week": ev.get("week"),
                "short_name": ev.get("short_name", ""),
                "status": status,
            }),
        })

    if rows:
        try:
            await upsert_rows("events", rows)
            log.debug("Upserted %d events", len(rows))
        except Exception as e:
            log.warning("Supabase events upsert failed: %s", e)

    return ongoing


async def _sync_teams_and_oprs(event_key: str) -> None:
    """Fetch team list + OPRs from TBA for a single event and upsert."""
    tba = get_tba_client()

    try:
        teams_raw, oprs_raw = await asyncio.gather(
            tba.get_event_teams(event_key),
            tba.get_event_oprs(event_key),
            return_exceptions=True,
        )
    except CircuitOpenError:
        log.debug("Circuit open — skipping team/OPR sync for %s", event_key)
        return

    # ── Teams table ─────────────────────────────────────
    if isinstance(teams_raw, list) and teams_raw:
        team_rows = []
        for t in teams_raw:
            team_rows.append({
                "team_key": t["key"],
                "team_number": t.get("team_number", 0),
                "nickname": t.get("nickname", ""),
                "competition_type": "frc",
                "raw_tims_data": json.dumps({
                    "city": t.get("city", ""),
                    "state_prov": t.get("state_prov", ""),
                    "country": t.get("country", ""),
                }),
            })

        try:
            await upsert_rows("teams", team_rows)
        except Exception as e:
            log.warning("Supabase teams upsert failed for %s: %s", event_key, e)

    # ── Event-teams junction (OPRs) ─────────────────────
    opr_lookup: dict = {}
    if isinstance(oprs_raw, dict):
        oprs = oprs_raw.get("oprs", {})
        dprs = oprs_raw.get("dprs", {})
        ccwms = oprs_raw.get("ccwms", {})
        for tkey in oprs:
            opr_lookup[tkey] = {
                "opr": oprs.get(tkey),
                "dpr": dprs.get(tkey),
                "ccwm": ccwms.get(tkey),
            }

    if isinstance(teams_raw, list) and teams_raw:
        et_rows = []
        for t in teams_raw:
            tk = t["key"]
            existing_data = opr_lookup.get(tk, {})
            et_rows.append({
                "event_key": event_key,
                "team_key": tk,
                "raw_data": json.dumps(existing_data),
            })
        try:
            await upsert_rows("event_teams", et_rows)
        except Exception as e:
            log.warning("Supabase event_teams upsert failed for %s: %s", event_key, e)


async def _sync_alliances(event_key: str) -> None:
    """Fetch playoff alliance selections and store in events.raw_data."""
    tba = get_tba_client()

    try:
        alliances = await tba.get_event_alliances(event_key)
    except CircuitOpenError:
        log.debug("Circuit open — skipping alliance sync for %s", event_key)
        return
    except Exception as e:
        log.warning("Alliance fetch failed for %s: %s", event_key, e)
        return

    if not alliances:
        return

    # Merge into events.raw_data by reading current, updating, writing back.
    try:
        from ..services.supabase_client import get_supabase
        client = await get_supabase()
        resp = await client.table("events").select("raw_data").eq(
            "event_key", event_key
        ).execute()

        current_raw = {}
        if resp.data and resp.data[0].get("raw_data"):
            current_raw = resp.data[0]["raw_data"]
            if isinstance(current_raw, str):
                current_raw = json.loads(current_raw)

        current_raw["alliances"] = alliances
        await upsert_rows("events", [{
            "event_key": event_key,
            "raw_data": json.dumps(current_raw),
        }])
        log.debug("Stored alliances for %s", event_key)
    except Exception as e:
        log.warning("Alliance upsert failed for %s: %s", event_key, e)


async def _sync_epa(event_key: str) -> None:
    """Fetch EPA data from Statbotics and merge into event_teams.raw_data."""
    try:
        epa_map = await get_epa_map(event_key)
    except CircuitOpenError:
        log.debug("Circuit open — skipping EPA sync for %s", event_key)
        return
    except Exception as e:
        log.warning("EPA fetch failed for %s: %s", event_key, e)
        return

    if not epa_map:
        return

    # Read current event_teams rows, merge EPA, write back
    try:
        from ..services.supabase_client import get_supabase
        client = await get_supabase()
        resp = await client.table("event_teams").select(
            "event_key, team_key, raw_data"
        ).eq("event_key", event_key).execute()

        rows_to_update = []
        for row in resp.data or []:
            tk = row["team_key"]
            epa = epa_map.get(tk)
            if epa is None:
                continue

            raw = row.get("raw_data") or {}
            if isinstance(raw, str):
                raw = json.loads(raw)
            raw["epa"] = epa
            rows_to_update.append({
                "event_key": event_key,
                "team_key": tk,
                "raw_data": json.dumps(raw),
            })

        if rows_to_update:
            await upsert_rows("event_teams", rows_to_update)
            log.debug("Merged EPA for %d teams at %s", len(rows_to_update), event_key)
    except Exception as e:
        log.warning("EPA upsert failed for %s: %s", event_key, e)


async def run_event_sync(year: int | None = None) -> None:
    """Main loop — runs until cancelled."""
    if year is None:
        year = date.today().year

    log.info("Event sync started (year=%d, interval=%ds)", year, SYNC_INTERVAL)

    while True:
        try:
            # 1) Sync all event metadata and discover ongoing events
            ongoing = await _sync_event_metadata(year)
            set_active_events(ongoing)

            if ongoing:
                log.info("Active events: %s", ", ".join(sorted(ongoing)))
            else:
                log.debug("No active events found")

            # 2) For ongoing events, sync teams/OPRs, alliances, EPA
            tasks = []
            for ek in ongoing:
                tasks.append(_sync_teams_and_oprs(ek))
                tasks.append(_sync_alliances(ek))
                tasks.append(_sync_epa(ek))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

        except Exception as e:
            log.error("Event sync sweep error: %s", e)

        await asyncio.sleep(SYNC_INTERVAL)
