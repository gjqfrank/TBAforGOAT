#!/usr/bin/env python3
"""Generate a static season_<year>_ftc.json for FTC event preloading.

Defaults to the current FTC kickoff year (computed from today's date). Pass
an explicit year as the first argument to override (e.g. `python
scripts/generate_ftc_season.py 2026`).
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app.services.ftc_event_service import current_ftc_season, get_season_events

DOCS_DATA = Path(__file__).resolve().parent.parent / "docs" / "data"


async def main():
    year = int(sys.argv[1]) if len(sys.argv) > 1 else current_ftc_season()
    output = DOCS_DATA / f"season_{year}_ftc.json"
    print(f"Fetching FTC {year} season events…")
    events = await get_season_events(year, include_offseason=False)
    print(f"  → {len(events)} events")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(events, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {output}")


if __name__ == "__main__":
    asyncio.run(main())
