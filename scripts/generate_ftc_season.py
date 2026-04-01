#!/usr/bin/env python3
"""Generate static season_2025_ftc.json for FTC event preloading.

Usage:
    python scripts/generate_ftc_season.py
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app.services.ftc_event_service import get_season_events

OUTPUT = Path(__file__).resolve().parent.parent / "docs" / "data" / "season_2025_ftc.json"


async def main():
    print("Fetching FTC 2025 season events…")
    events = await get_season_events(2025, include_offseason=False)
    print(f"  → {len(events)} events")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(events, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    asyncio.run(main())
