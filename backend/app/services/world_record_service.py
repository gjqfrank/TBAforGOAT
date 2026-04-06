"""Track the season-wide world high score (highest single-alliance match score).

The record is populated two ways:
1. **Passively** — every time any event's matches are loaded by the UI, the
   matches router calls `check_event_high()` to see if the event high score
   beats the current world record.
2. **Actively** — on the first API request for the world record, the service
   scans all started TBA events for the current season and finds the global
   highest single-alliance score.

The record is held in memory (resets on server restart) but converges quickly
thanks to the TBA scan.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Optional

from .cache_service import CACHE_DIR
from .tba_client import get_tba_client

log = logging.getLogger(__name__)

# ── In-memory state ─────────────────────────────────────
_world_record: dict | None = None  # {score, event_key, event_name, match, teams}
_seeded = False
_seed_lock = asyncio.Lock()
_CURRENT_YEAR = 2026


def _disk_path() -> Path:
    return CACHE_DIR / f"world_record_{_CURRENT_YEAR}.json"


def _load_from_disk() -> bool:
    """Try to load the world record from disk cache.  Returns True on success."""
    global _world_record
    p = _disk_path()
    if not p.exists():
        return False
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if data.get("score", 0) > 0:
            _world_record = data
            return True
    except Exception:
        pass
    return False


def _save_to_disk() -> None:
    """Persist the world record to disk."""
    if not _world_record:
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _disk_path().write_text(
        json.dumps(_world_record, separators=(",", ":")), encoding="utf-8",
    )

# Limit concurrent TBA requests during seeding
_CONCURRENCY = 6


def get_world_record() -> dict | None:
    """Return the current world record (may be None if not yet seeded)."""
    return _world_record


def check_event_high(event_key: str, event_name: str, high: dict) -> bool:
    """Compare an event's high score against the world record.

    ``high`` should have the shape ``{score, match, teams}``.
    Returns True if a new world record was set.
    """
    global _world_record
    if not high or high.get("score", 0) <= 0:
        return False
    if _world_record and high["score"] <= _world_record["score"]:
        return False
    _world_record = {
        "score": high["score"],
        "event_key": event_key,
        "event_name": event_name,
        "match": high.get("match", ""),
        "teams": high.get("teams", []),
        "updated_at": time.time(),
    }
    _save_to_disk()
    return True


async def seed_from_tba() -> None:
    """Scan all started TBA events for the season and find the global high."""
    global _seeded
    async with _seed_lock:
        if _seeded:
            return
        # Try disk cache first — avoids full season scan
        if _load_from_disk():
            _seeded = True
            log.info("World record loaded from disk cache: %d", _world_record["score"])
            return
        _seeded = True

    try:
        tba = get_tba_client()
        events = await tba.get_events_by_year(_CURRENT_YEAR)
        if not events:
            return

        # Filter to events that have actually started (have matches)
        # TBA event types 0-5 are real competitions (Regional, District, etc.)
        now = time.time()
        started = []
        for ev in events:
            etype = ev.get("event_type", 99)
            if etype > 5:
                continue
            # Check if event start date is in the past
            start_date = ev.get("start_date", "")
            if not start_date:
                continue
            # Simple check: if start_date <= today, it may have matches
            from datetime import date as dt_date
            try:
                y, m, d = map(int, start_date.split("-"))
                if dt_date(y, m, d) <= dt_date.today():
                    started.append(ev)
            except (ValueError, TypeError):
                continue

        if not started:
            return

        log.info("World record seed: scanning %d started events", len(started))

        # Fetch matches for each started event with concurrency limit
        sem = asyncio.Semaphore(_CONCURRENCY)
        best_score = 0
        best_match_key = ""
        best_color = ""
        best_event: dict | None = None
        best_alliances: dict | None = None

        async def _scan_event(ev: dict) -> tuple[int, str, str, dict, dict]:
            """Return (score, match_key, color, event, alliances) for the
            highest-scoring alliance at this event."""
            async with sem:
                matches = await tba.get_event_matches(ev["key"])
            if not matches:
                return (0, "", "", ev, {})
            top = 0
            top_key = ""
            top_color = ""
            top_alliances: dict = {}
            for m in matches:
                alliances = m.get("alliances", {})
                for color in ("red", "blue"):
                    s = (alliances.get(color) or {}).get("score", -1)
                    if s > top:
                        top = s
                        top_key = m.get("key", "")
                        top_color = color
                        top_alliances = alliances
            return (top, top_key, top_color, ev, top_alliances)

        results = await asyncio.gather(
            *[_scan_event(ev) for ev in started],
            return_exceptions=True,
        )

        for r in results:
            if isinstance(r, Exception):
                continue
            score, match_key, color, ev, alliances = r
            if score > best_score:
                best_score = score
                best_match_key = match_key
                best_color = color
                best_event = ev
                best_alliances = alliances

        if best_score > 0 and best_event and best_alliances:
            event_key = best_event["key"]
            event_name = best_event.get("short_name") or best_event.get("name") or event_key
            match_label = _match_label_from_key(best_match_key)

            # Extract team numbers from TBA alliance data
            team_keys = (best_alliances.get(best_color) or {}).get("team_keys", [])
            team_nums = []
            for tk in team_keys:
                try:
                    team_nums.append(int(str(tk).replace("frc", "")))
                except (ValueError, TypeError):
                    pass

            check_event_high(event_key, event_name, {
                "score": best_score,
                "match": match_label,
                "teams": team_nums,
            })
            log.info(
                "World record seeded: %d at %s (%s) — %s",
                best_score, event_name, event_key, match_label,
            )
    except Exception:
        log.exception("World record seed failed (non-critical)")
        pass


def _match_label_from_key(key: str) -> str:
    """Convert a TBA match key like '2026tuis_qm42' to 'Qualification 42'."""
    if "_" not in key:
        return key
    suffix = key.split("_", 1)[1]
    import re
    m = re.match(r"(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?", suffix)
    if not m:
        return suffix
    level, num1, num2 = m.group(1), int(m.group(2)), m.group(3)
    labels = {"qm": "Qualification", "ef": "Eighths", "qf": "Quarterfinal", "sf": "Semifinal", "f": "Final"}
    label = labels.get(level, level)
    if level == "qm" or level == "f":
        return f"{label} {num1}"
    if num2 and int(num2) > 1:
        return f"{label} {num1} (Match {num2})"
    return f"{label} {num1}"
