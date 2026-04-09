"""Hot-path FTC worker: polls FIRST FTC Events API every 5 seconds for
live match scores and every 15 seconds for rankings, then upserts
changed rows into Supabase.

Mirrors the FRC match_poller architecture exactly.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from ..services.ftc_client import get_ftc_client
from ..services.supabase_client import upsert_rows, merge_event_teams, delete_orphaned_matches
from ..services.circuit_breaker import CircuitOpenError
from .schemas import FTCMatch, FTCRanking, validate_list

log = logging.getLogger(__name__)

POLL_INTERVAL = 5       # seconds between match sweeps
RANKINGS_INTERVAL = 15  # seconds between ranking refreshes


def _strip_nulls(d: dict) -> dict:
    """Remove keys whose value is None so JSONB || won't nuke good data."""
    return {k: v for k, v in d.items() if v is not None}


def _invalidate_snapshot(event_key: str) -> None:
    """Remove disk-cached snapshot + summary caches so they rebuild."""
    try:
        from ..services import payload_cache
        payload_cache.invalidate("summary", event_key)
    except Exception:
        pass


def _parse_ftc_key(event_key: str) -> tuple[int, str]:
    """Parse '2025ftcXYZ' → (2025, 'XYZ')."""
    key = event_key.lower()
    if "ftc" in key:
        idx = key.index("ftc")
        return int(key[:idx]), key[idx + 3:].upper()
    return int(event_key[:4]), event_key[4:].upper()


# ── State ───────────────────────────────────────────────────
_last_rankings_poll: float = 0
_watched_ftc_events: set[str] = set()


def add_watched_ftc_event(event_key: str) -> None:
    """Register a user-loaded FTC event for ongoing polling."""
    _watched_ftc_events.add(event_key)


def get_ftc_poll_events() -> set[str]:
    """Return events that should be polled (active + user-watched)."""
    from .ftc_event_sync import get_ftc_active_events
    return get_ftc_active_events() | _watched_ftc_events


# ── Match polling ───────────────────────────────────────────

async def _poll_ftc_matches(event_key: str) -> None:
    """Fetch latest FTC match data and upsert into Supabase."""
    client = get_ftc_client()
    year, event_code = _parse_ftc_key(event_key)

    try:
        raw_matches = await client.get_matches(year, event_code, bypass_cache=True)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC match poll for %s", event_key)
        return
    except Exception as e:
        log.warning("FTC match poll failed for %s: %s", event_key, e)
        return

    if not raw_matches:
        return

    valid_matches = validate_list(FTCMatch, raw_matches, f"ftc_matches:{event_key}")
    if not valid_matches:
        return

    rows: list[dict[str, Any]] = []
    for m_model in valid_matches:
        m = m_model.model_dump()
        match_num = m.get("matchNumber", 0)
        series = m.get("series", 1)
        level = (m.get("tournamentLevel") or "Qualification").lower()

        if "qual" in level:
            comp_level = "qm"
        elif "playoff" in level or "elim" in level:
            comp_level = "sf"
        elif "final" in level:
            comp_level = "f"
        else:
            comp_level = level[:2] if level else "qm"

        match_key = f"{event_key}_{comp_level}{series}m{match_num}"

        # Determine status from scores
        score_red = m.get("scoreRedFinal") or m.get("scoreTotalRed")
        score_blue = m.get("scoreBlueFinal") or m.get("scoreTotalBlue")
        if score_red is not None and score_red >= 0 and score_blue is not None and score_blue >= 0:
            status = "completed"
        elif m.get("actualStartTime"):
            status = "in_progress"
        else:
            status = "upcoming"

        # Build alliances
        teams_list = m.get("teams", [])
        red_keys = sorted(
            f"ftc{t['teamNumber']}" for t in teams_list
            if t.get("station", "").startswith("Red") and t.get("teamNumber")
        )
        blue_keys = sorted(
            f"ftc{t['teamNumber']}" for t in teams_list
            if t.get("station", "").startswith("Blue") and t.get("teamNumber")
        )
        alliances = {
            "red": {
                "score": score_red if score_red is not None else -1,
                "teams": teams_list,
                "team_keys": red_keys,
            },
            "blue": {
                "score": score_blue if score_blue is not None else -1,
                "teams": teams_list,
                "team_keys": blue_keys,
            },
        }

        scheduled = m.get("startTime") or m.get("actualStartTime")

        rows.append({
            "match_key": match_key,
            "event_key": event_key,
            "comp_level": comp_level,
            "match_number": match_num,
            "set_number": series,
            "status": status,
            "alliances": alliances,
            "score_breakdown": m.get("scoreBreakdown") or {},
            "scheduled_time": scheduled,
            "raw_data": m,
        })

    if rows:
        try:
            await upsert_rows("matches", rows)
            # Purge ghost matches
            valid_keys = {r["match_key"] for r in rows}
            orphan_count = await delete_orphaned_matches(event_key, valid_keys)
            if orphan_count:
                log.info("Purged %d ghost FTC matches from %s", orphan_count, event_key)
            log.debug("Upserted %d FTC matches for %s", len(rows), event_key)
            _invalidate_snapshot(event_key)
        except Exception as e:
            log.warning("Supabase FTC match upsert failed for %s: %s", event_key, e)


# ── Rankings polling ────────────────────────────────────────

async def _poll_ftc_rankings(event_key: str) -> None:
    """Fetch latest FTC rankings and merge into event_teams."""
    client = get_ftc_client()
    year, event_code = _parse_ftc_key(event_key)

    try:
        rankings = await client.get_rankings(year, event_code)
    except CircuitOpenError:
        log.debug("Circuit open — skipping FTC ranking poll for %s", event_key)
        return
    except Exception as e:
        log.warning("FTC rankings poll failed for %s: %s", event_key, e)
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
            log.warning("Supabase FTC rankings merge failed for %s: %s", event_key, e)


# ── Main loop ───────────────────────────────────────────────

async def run_ftc_match_poller() -> None:
    """Main loop — runs until cancelled."""
    global _last_rankings_poll

    log.info("FTC match poller started (interval=%ds, rankings=%ds)", POLL_INTERVAL, RANKINGS_INTERVAL)

    while True:
        try:
            events = get_ftc_poll_events()
            if events:
                # Always poll matches
                await asyncio.gather(
                    *[_poll_ftc_matches(ek) for ek in events],
                    return_exceptions=True,
                )

                # Poll rankings less frequently
                now = time.time()
                if now - _last_rankings_poll >= RANKINGS_INTERVAL:
                    _last_rankings_poll = now
                    await asyncio.gather(
                        *[_poll_ftc_rankings(ek) for ek in events],
                        return_exceptions=True,
                    )
        except Exception as e:
            log.error("FTC match poller sweep error: %s", e)

        await asyncio.sleep(POLL_INTERVAL)
