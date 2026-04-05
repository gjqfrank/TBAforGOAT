"""Hot-path worker: polls FRC Events API every 5 seconds for live match
scores and rankings, then upserts changed rows into Supabase.

Only active events (status = 'ongoing') are polled.  The worker is a
single asyncio task started by the FastAPI lifespan.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

from ..services.frc_client import get_frc_client
from ..services.supabase_client import get_supabase, upsert_rows
from ..services.circuit_breaker import CircuitOpenError

log = logging.getLogger(__name__)

POLL_INTERVAL = 5       # seconds between sweeps
RANKINGS_INTERVAL = 15  # seconds between ranking refreshes

# ── State ───────────────────────────────────────────────────
_active_event_keys: set[str] = set()
_last_rankings_poll: float = 0


def set_active_events(keys: set[str]) -> None:
    """Called by event_sync when it discovers ongoing events."""
    global _active_event_keys
    _active_event_keys = keys


def get_active_events() -> set[str]:
    return _active_event_keys


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

    rows = []
    for m in raw_matches:
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

        # Build alliances jsonb
        alliances = {
            "red": {
                "score": score_red if score_red is not None else -1,
                "teams": m.get("teams", []),
            },
            "blue": {
                "score": score_blue if score_blue is not None else -1,
                "teams": m.get("teams", []),
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
            "alliances": json.dumps(alliances),
            "score_breakdown": json.dumps(m.get("scoreBreakdown") or {}),
            "scheduled_time": scheduled,
            "raw_data": json.dumps(m),
        })

    if rows:
        try:
            await upsert_rows("matches", rows)
            log.debug("Upserted %d matches for %s", len(rows), event_key)
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

    rows = []
    for r in rankings:
        team_num = r.get("teamNumber")
        if not team_num:
            continue
        team_key = f"frc{team_num}"

        rows.append({
            "event_key": event_key,
            "team_key": team_key,
            "raw_data": json.dumps({
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
            await upsert_rows("event_teams", rows)
            log.debug("Upserted %d rankings for %s", len(rows), event_key)
        except Exception as e:
            log.warning("Supabase rankings upsert failed for %s: %s", event_key, e)


async def run_match_poller() -> None:
    """Main loop — runs until cancelled."""
    import time

    log.info("Match poller started (interval=%ds, rankings=%ds)", POLL_INTERVAL, RANKINGS_INTERVAL)
    global _last_rankings_poll

    while True:
        try:
            events = _active_event_keys.copy()
            if events:
                # Always poll matches
                await asyncio.gather(
                    *[_poll_matches(ek) for ek in events],
                    return_exceptions=True,
                )

                # Poll rankings less frequently
                now = time.time()
                if now - _last_rankings_poll >= RANKINGS_INTERVAL:
                    _last_rankings_poll = now
                    await asyncio.gather(
                        *[_poll_rankings(ek) for ek in events],
                        return_exceptions=True,
                    )
        except Exception as e:
            log.error("Match poller sweep error: %s", e)

        await asyncio.sleep(POLL_INTERVAL)
