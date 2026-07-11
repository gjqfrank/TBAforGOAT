"""Custom (non-TBA) events injected into the season list.

When TBA doesn't yet have an event that we know is happening, we inject a
placeholder so casters can at least see the event and its team list.
Every time the season list is fetched, we check TBA for a matching event;
once TBA has it, the placeholder is dropped and the real event takes over.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date
from typing import Optional

log = logging.getLogger(__name__)

# ── Sanya Offseason placeholder ────────────────────────────
SANYA_EVENT_KEY = "2026cnsanya"  # placeholder key; will be replaced by TBA key when available

SANYA_EVENT: dict = {
    "key": SANYA_EVENT_KEY,
    "name": "China Sanya Offseason Event",
    "short_name": "Sanya Offseason",
    "week": None,
    "start_date": "2026-07-19",
    "end_date": "2026-07-22",
    "city": "Sanya",
    "state_prov": "",
    "country": "China",
    "event_type": 99,            # Offseason
    "event_type_string": "Offseason",
    "district": None,
    "region": "China",
}

SANYA_TEAM_NUMBERS: list[int] = [
    10016, 6494, 10000, 7522, 5823, 6433, 6941, 11288, 5516, 6414,
    10711, 6970, 5522, 5515, 8011, 10541, 7002, 5449, 11028, 6940,
    10479, 6394, 6399, 11199, 11019, 9597, 6907, 8015, 6706, 11256,
    5849, 11328, 7047, 6766, 8214, 9635, 6487, 11118, 7594, 8810,
    8814, 10120, 10526, 11352,
]

# All custom events for quick lookup by key
_CUSTOM_EVENTS: dict[str, dict] = {
    SANYA_EVENT_KEY: SANYA_EVENT,
}

# Keywords used to find the real TBA event once it appears
_SANYA_KEYWORDS = ("sanya",)


def is_custom_event(event_key: str) -> bool:
    return event_key in _CUSTOM_EVENTS


def get_custom_event(event_key: str) -> Optional[dict]:
    return _CUSTOM_EVENTS.get(event_key)


async def check_tba_for_sanya(tba_client) -> Optional[dict]:
    """Search TBA 2026 events for a Sanya event.

    Returns the matching TBA event dict (as returned by get_season_events)
    if found, otherwise None.
    """
    try:
        raw = await asyncio.wait_for(
            tba_client.get_events_by_year(2026),
            timeout=20,
        )
    except Exception as e:
        log.debug("TBA event scan failed for Sanya check: %s", e)
        return None

    today = date.today()
    for ev in raw:
        name = (ev.get("name", "") + " " + ev.get("short_name", "")).lower()
        city = (ev.get("city", "") or "").lower()
        if any(kw in name or kw in city for kw in _SANYA_KEYWORDS):
            etype = ev.get("event_type", -1)
            if etype in {100, -1}:
                continue
            return ev  # return the raw TBA event

    return None


def tba_event_to_season_entry(ev: dict) -> dict:
    """Convert a raw TBA event dict to the season-list format."""
    from .event_service import _resolve_region
    etype = ev.get("event_type", -1)
    return {
        "key": ev["key"],
        "name": ev.get("name", ""),
        "short_name": ev.get("short_name") or ev.get("name", ""),
        "week": ev.get("week"),
        "start_date": ev.get("start_date", ""),
        "end_date": ev.get("end_date", ""),
        "city": ev.get("city", ""),
        "state_prov": ev.get("state_prov", ""),
        "country": ev.get("country", ""),
        "event_type": etype,
        "event_type_string": ev.get("event_type_string", ""),
        "district": ev.get("district"),
        "region": (
            "FIRST Championship"
            if etype in {3, 4, 6}
            else _resolve_region(
                ev.get("country", ""),
                ev.get("state_prov", ""),
                ev.get("district"),
            )
        ),
    }


def season_entry_from_custom(event_key: str) -> dict:
    """Build a season-list entry dict from a custom event definition."""
    ev = _CUSTOM_EVENTS[event_key]
    return dict(ev)
