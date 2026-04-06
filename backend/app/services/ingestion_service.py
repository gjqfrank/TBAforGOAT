"""Ingestion Engine — downloads event data from external APIs, formats it,
and stores in Supabase so the frontend can sync it later.

When a user loads an event for the first time, the server calls
``ingest_event(event_key)`` which:

1. Fetches event metadata, teams, rankings, OPRs, EPA, matches, and
   alliances from TBA / FRC / Statbotics APIs.
2. Stores everything in the normalised Supabase tables
   (events, teams, event_teams, matches).
3. Registers the event for ongoing worker polling (if still running).
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone

from .tba_client import get_tba_client
from .frc_client import get_frc_client
from .statbotics_client import get_epa_map
from .supabase_client import get_supabase, upsert_rows
from .circuit_breaker import CircuitOpenError

log = logging.getLogger(__name__)

# Track which events have been ingested this server session
_ingested_events: set[str] = set()


# ── Helpers ─────────────────────────────────────────────────

def _event_status(start_str: str | None, end_str: str | None) -> str:
    today = date.today()
    try:
        sd = date.fromisoformat(start_str or "")
        ed = date.fromisoformat(end_str or "")
    except (ValueError, TypeError):
        return "unknown"
    if today > ed + timedelta(days=1):
        return "completed"
    if today >= sd:
        return "ongoing"
    return "upcoming"


async def _safe(coro):
    try:
        return await coro
    except CircuitOpenError:
        return None
    except Exception:
        return None


# ── Public API ──────────────────────────────────────────────

async def is_ingested(event_key: str) -> bool:
    """Check whether an event already has teams AND matches in Supabase."""
    if event_key in _ingested_events:
        return True
    try:
        sb = await get_supabase()
        teams_resp = (
            await sb.table("event_teams")
            .select("event_key")
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        matches_resp = (
            await sb.table("matches")
            .select("match_key")
            .eq("event_key", event_key)
            .limit(1)
            .execute()
        )
        if teams_resp.data and matches_resp.data:
            _ingested_events.add(event_key)
            return True
    except Exception:
        pass
    return False


async def ingest_event(event_key: str) -> str:
    """One-shot full ingestion of an event into Supabase.

    Returns the computed event status ('upcoming' / 'ongoing' / 'completed').
    """
    log.info("Ingesting event %s …", event_key)
    tba = get_tba_client()
    frc = get_frc_client()
    year = int(event_key[:4])
    event_code = event_key[4:]

    # ── 1. Event metadata (TBA) ─────────────────────────────
    event_raw = await tba.get_event(event_key)
    if not event_raw:
        raise ValueError(f"TBA returned no data for event '{event_key}'")

    start = event_raw.get("start_date", "")
    end = event_raw.get("end_date", "")
    status = _event_status(start, end)

    await upsert_rows("events", [{
        "event_key": event_key,
        "name": event_raw.get("name", ""),
        "start_date": start or None,
        "end_date": end or None,
        "competition_type": "frc",
        "raw_data": json.dumps({
            "city": event_raw.get("city", ""),
            "state_prov": event_raw.get("state_prov", ""),
            "country": event_raw.get("country", ""),
            "event_type": event_raw.get("event_type", -1),
            "event_type_string": event_raw.get("event_type_string", ""),
            "district": event_raw.get("district"),
            "week": event_raw.get("week"),
            "short_name": event_raw.get("short_name", ""),
            "status": status,
        }),
    }])

    # ── 2. Teams + OPRs + EPA + Rankings (parallel) ─────────
    teams_raw, oprs_raw, epa_map, rankings_raw = await asyncio.gather(
        _safe(tba.get_event_teams_full(event_key)),
        _safe(tba.get_event_oprs(event_key)),
        _safe(get_epa_map(event_key)),
        _safe(frc.get_rankings(year, event_code)),
    )

    # — teams table
    if teams_raw:
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
                    "rookie_year": t.get("rookie_year"),
                    "school_name": t.get("school_name", ""),
                }),
            })
        await upsert_rows("teams", team_rows)

    # — OPR lookup
    opr_lookup: dict[str, dict] = {}
    if isinstance(oprs_raw, dict):
        for tk in oprs_raw.get("oprs", {}):
            opr_lookup[tk] = {
                "opr": oprs_raw["oprs"].get(tk),
                "dpr": oprs_raw.get("dprs", {}).get(tk),
                "ccwm": oprs_raw.get("ccwms", {}).get(tk),
            }

    # — Rankings lookup (FRC Events API format)
    rank_lookup: dict[str, dict] = {}
    if rankings_raw:
        for r in rankings_raw:
            tn = r.get("teamNumber")
            if tn:
                rank_lookup[f"frc{tn}"] = {
                    "rank": r.get("rank"),
                    "wins": r.get("wins", 0),
                    "losses": r.get("losses", 0),
                    "ties": r.get("ties", 0),
                    "qual_average": r.get("qualAverage"),
                    "sort_orders": r.get("sortOrders"),
                    "matches_played": r.get("matchesPlayed", 0),
                    "dq": r.get("dq", 0),
                }

    # — event_teams junction (merge OPR + EPA + Rankings)
    if teams_raw:
        et_rows = []
        for t in teams_raw:
            tk = t["key"]
            data: dict = {}
            data.update(opr_lookup.get(tk, {}))
            data.update(rank_lookup.get(tk, {}))
            if epa_map and isinstance(epa_map, dict) and tk in epa_map:
                epa_val = epa_map[tk]
                if isinstance(epa_val, dict):
                    data["epa"] = epa_val
                else:
                    data["epa"] = epa_val
            et_rows.append({
                "event_key": event_key,
                "team_key": tk,
                "raw_data": json.dumps(data),
            })
        await upsert_rows("event_teams", et_rows)

    # ── 3. Matches (TBA format — team_keys in alliances) ───
    matches_raw = await _safe(tba.get_event_matches(event_key))
    if matches_raw:
        match_rows = []
        for m in matches_raw:
            mk = m.get("key", "")
            cl = m.get("comp_level", "qm")
            red = m.get("alliances", {}).get("red", {})
            blue = m.get("alliances", {}).get("blue", {})

            rs = red.get("score", -1)
            bs = blue.get("score", -1)
            if rs is not None and rs >= 0 and bs is not None and bs >= 0:
                mstatus = "completed"
            elif m.get("actual_time"):
                mstatus = "in_progress"
            else:
                mstatus = "upcoming"

            # Convert Unix epoch to ISO 8601 for Supabase TIMESTAMPTZ
            raw_time = m.get("time") or m.get("predicted_time")
            scheduled_iso = None
            if raw_time and isinstance(raw_time, (int, float)):
                scheduled_iso = datetime.fromtimestamp(
                    raw_time, tz=timezone.utc
                ).isoformat()

            match_rows.append({
                "match_key": mk,
                "event_key": event_key,
                "comp_level": cl,
                "match_number": m.get("match_number", 0),
                "set_number": m.get("set_number", 1),
                "status": mstatus,
                "alliances": json.dumps({
                    "red": {
                        "score": rs if rs is not None else -1,
                        "team_keys": red.get("team_keys", []),
                    },
                    "blue": {
                        "score": bs if bs is not None else -1,
                        "team_keys": blue.get("team_keys", []),
                    },
                }),
                "score_breakdown": json.dumps(m.get("score_breakdown") or {}),
                "scheduled_time": scheduled_iso,
                "raw_data": json.dumps(m),
            })
        await upsert_rows("matches", match_rows)

    # ── 4. Alliances → events.raw_data ─────────────────────
    alliances_raw = await _safe(tba.get_event_alliances(event_key))
    if alliances_raw:
        try:
            sb = await get_supabase()
            resp = (
                await sb.table("events")
                .select("raw_data")
                .eq("event_key", event_key)
                .execute()
            )
            current_raw: dict = {}
            if resp.data and resp.data[0].get("raw_data"):
                current_raw = resp.data[0]["raw_data"]
                if isinstance(current_raw, str):
                    current_raw = json.loads(current_raw)
            current_raw["alliances"] = alliances_raw
            await upsert_rows("events", [{
                "event_key": event_key,
                "raw_data": json.dumps(current_raw),
            }])
        except Exception as e:
            log.warning("Alliance storage failed for %s: %s", event_key, e)

    # ── 5. Pre-warm caches (avatars + summary) ───────────────
    # Fire-and-forget: prefetch avatars so alliance endpoint is instant later
    team_keys = [t["key"] for t in teams_raw] if teams_raw else []
    if team_keys:
        try:
            from .avatar_cache import prefetch_avatars
            await prefetch_avatars(team_keys, year)
        except Exception as e:
            log.warning("Avatar prefetch failed for %s: %s", event_key, e)

    # Pre-compute summary (demographics, HoF, scorers) — cheap
    try:
        from .summary_service import get_event_summary
        await get_event_summary(event_key)
    except Exception as e:
        log.warning("Summary pre-compute failed for %s: %s", event_key, e)

    # ── 6. Register for live polling if ongoing ─────────────
    if status == "ongoing":
        try:
            from ..workers.match_poller import add_watched_event
            add_watched_event(event_key)
        except Exception:
            pass

    _ingested_events.add(event_key)
    log.info("Ingestion complete for %s (status=%s, teams=%d, matches=%d)",
             event_key, status,
             len(teams_raw) if teams_raw else 0,
             len(matches_raw) if matches_raw else 0)
    return status
