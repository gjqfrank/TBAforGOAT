"""Hot-path worker: polls FRC Events API every 5 seconds for live match
scores and rankings, then upserts changed rows into Supabase.

Only active events (status = 'ongoing') are polled.  The worker is a
single asyncio task started by the FastAPI lifespan.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from ..services.frc_client import get_frc_client
from ..services.supabase_client import get_supabase, upsert_rows, merge_event_teams, delete_orphaned_matches
from ..services.circuit_breaker import CircuitOpenError
from .schemas import FRCMatch, FRCRanking, validate_list

log = logging.getLogger(__name__)

POLL_INTERVAL = 5       # seconds between sweeps
RANKINGS_INTERVAL = 15  # seconds between ranking refreshes


def _strip_nulls(d: dict) -> dict:
    """Remove keys whose value is None so JSONB || won't nuke good data."""
    return {k: v for k, v in d.items() if v is not None}


def _invalidate_snapshot(event_key: str) -> None:
    """Remove disk-cached snapshot + summary caches so they rebuild."""
    try:
        from ..routers.snapshot import invalidate_snapshot
        invalidate_snapshot(event_key)
    except Exception:
        pass
    try:
        from ..services import payload_cache
        payload_cache.invalidate("summary", event_key)
    except Exception:
        pass

# ── State ───────────────────────────────────────────────────
_active_event_keys: set[str] = set()
_watched_event_keys: set[str] = set()   # user-triggered events
_last_rankings_poll: float = 0


def set_active_events(keys: set[str]) -> None:
    """Called by event_sync when it discovers ongoing events."""
    global _active_event_keys
    _active_event_keys = keys


def add_watched_event(event_key: str) -> None:
    """Register a user-loaded event for ongoing polling."""
    _watched_event_keys.add(event_key)


def get_active_events() -> set[str]:
    return _active_event_keys | _watched_event_keys


async def _poll_matches(event_key: str) -> None:
    """Fetch latest match data from FRC API and upsert into Supabase."""
    frc = get_frc_client()
    year = int(event_key[:4])
    event_code = event_key[4:]

    try:
        raw_matches = await frc.get_matches(year, event_code, bypass_cache=True)
    except CircuitOpenError:
        log.debug("Circuit open for FRC API — skipping match poll for %s", event_key)
        return
    except Exception as e:
        log.warning("Match poll failed for %s: %s", event_key, e)
        return

    if not raw_matches:
        return

    valid_matches = validate_list(FRCMatch, raw_matches, f"frc_matches:{event_key}")
    if not valid_matches:
        return

    rows = []
    for m_model in valid_matches:
        m = m_model.model_dump()
        match_num = m.get("matchNumber", 0)
        level = (m.get("tournamentLevel") or "Qualification").lower()

        # Map FRC API tournament levels to TBA comp_level codes
        if "qual" in level:
            comp_level = "qm"
        elif "playoff" in level or "elim" in level:
            comp_level = "sf"
        elif "final" in level:
            comp_level = "f"
        else:
            comp_level = level[:2]

        match_key = f"{event_key}_{comp_level}{match_num}"

        # Determine match status from score presence
        score_red = m.get("scoreRedFinal")
        score_blue = m.get("scoreBlueFinal")
        if score_red is not None and score_red >= 0:
            status = "completed"
        elif m.get("actualStartTime"):
            status = "in_progress"
        else:
            status = "upcoming"

        # Build alliances jsonb with per-alliance team_keys
        frc_teams = m.get("teams", [])
        red_keys = sorted(
            f"frc{t['teamNumber']}" for t in frc_teams
            if "Red" in (t.get("station") or "")
        )
        blue_keys = sorted(
            f"frc{t['teamNumber']}" for t in frc_teams
            if "Blue" in (t.get("station") or "")
        )
        alliances = {
            "red": {
                "score": score_red if score_red is not None else -1,
                "teams": frc_teams,
                "team_keys": red_keys,
            },
            "blue": {
                "score": score_blue if score_blue is not None else -1,
                "teams": frc_teams,
                "team_keys": blue_keys,
            },
        }

        scheduled = m.get("startTime") or m.get("actualStartTime")

        rows.append({
            "match_key": match_key,
            "event_key": event_key,
            "comp_level": comp_level,
            "match_number": match_num,
            "set_number": m.get("playNumber", 1),
            "status": status,
            "alliances": alliances,
            "score_breakdown": m.get("scoreBreakdown") or {},
            "scheduled_time": scheduled,
            "raw_data": m,
        })

    if rows:
        try:
            await upsert_rows("matches", rows)
            # Purge ghost matches (deleted from live schedule by event operator)
            valid_keys = {r["match_key"] for r in rows}
            orphan_count = await delete_orphaned_matches(event_key, valid_keys)
            if orphan_count:
                log.info("Purged %d ghost matches from %s", orphan_count, event_key)
            log.debug("Upserted %d matches for %s", len(rows), event_key)
            _invalidate_snapshot(event_key)
        except Exception as e:
            log.warning("Supabase match upsert failed for %s: %s", event_key, e)


async def _poll_rankings(event_key: str) -> None:
    """Fetch latest rankings from FRC API and upsert into event_teams."""
    frc = get_frc_client()
    year = int(event_key[:4])
    event_code = event_key[4:]

    try:
        rankings = await frc.get_rankings(year, event_code)
    except CircuitOpenError:
        log.debug("Circuit open for FRC API — skipping ranking poll for %s", event_key)
        return
    except Exception as e:
        log.warning("Rankings poll failed for %s: %s", event_key, e)
        return

    if not rankings:
        return

    valid_rankings = validate_list(FRCRanking, rankings, f"frc_rankings:{event_key}")
    if not valid_rankings:
        return

    rows = []
    for r_model in valid_rankings:
        r = r_model.model_dump()
        team_num = r.get("teamNumber")
        if not team_num:
            continue
        team_key = f"frc{team_num}"

        # FRC Events API returns sortOrder1, sortOrder2, … as individual
        # fields rather than a single sortOrders array.  Build the array
        # from whichever form is present so downstream RP calculation
        # (sort_orders[0] * matches_played) always works.
        sort_orders = r.get("sortOrders")
        if not sort_orders:
            so = []
            for i in range(1, 7):
                v = r.get(f"sortOrder{i}")
                if v is not None:
                    so.append(v)
            sort_orders = so or None

        rows.append({
            "event_key": event_key,
            "team_key": team_key,
            "data": _strip_nulls({
                "rank": r.get("rank"),
                "wins": r.get("wins", 0),
                "losses": r.get("losses", 0),
                "ties": r.get("ties", 0),
                "qual_average": r.get("qualAverage"),
                "sort_orders": sort_orders,
                "matches_played": r.get("matchesPlayed", 0),
                "dq": r.get("dq", 0),
            }),
        })

    if rows:
        try:
            await merge_event_teams(rows)
            log.debug("Merged %d rankings for %s", len(rows), event_key)
            _invalidate_snapshot(event_key)
        except Exception as e:
            log.warning("Supabase rankings upsert failed for %s: %s", event_key, e)


async def run_match_poller() -> None:
    """Main loop — runs until cancelled."""
    import time

    log.info("Match poller started (interval=%ds, rankings=%ds)", POLL_INTERVAL, RANKINGS_INTERVAL)
    global _last_rankings_poll

    while True:
        try:
            events = get_active_events()
            if events:
                # Always poll matches
                await asyncio.gather(
                    *[_poll_matches(ek) for ek in events],
                    return_exceptions=True,
                )

                # Poll rankings less frequently (serialised to avoid deadlocks)
                now = time.time()
                if now - _last_rankings_poll >= RANKINGS_INTERVAL:
                    _last_rankings_poll = now
                    for ek in events:
                        try:
                            await _poll_rankings(ek)
                        except Exception as e:
                            log.warning("Rankings poll failed for %s: %s", ek, e)
        except Exception as e:
            log.error("Match poller sweep error: %s", e)

        await asyncio.sleep(POLL_INTERVAL)
