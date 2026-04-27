#!/usr/bin/env python3
"""
Generate docs/data/einstein_history.json — a static lookup of every team
that has ever competed on Einstein (FRC Championship Finals, event_type=4),
with their years of participation and whether they ever won.

Usage:
    python scripts/generate_einstein_history.py [--first-year YEAR]

Defaults to fetching from 2006 (first year with alliance-based Einstein) through
the current season.  Output is written to docs/data/einstein_history.json.

Re-run this script at the end of each season to keep the file current.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.app.services.tba_client import get_tba_client

_OUTPUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "data" / "einstein_history.json"
_EINSTEIN_EVENT_TYPE = 4  # Championship Finals
_WINNER_AWARD_TYPE = 1    # Event Winner


async def main(first_year: int, last_year: int) -> None:
    client = get_tba_client()

    # team_number -> {"nickname": str, "contender_years": set, "winner_years": set}
    team_data: dict[int, dict] = defaultdict(lambda: {
        "nickname": "",
        "contender_years": set(),
        "winner_years": set(),
    })

    for year in range(first_year, last_year + 1):
        print(f"  Fetching {year}...", end=" ", flush=True)
        t0 = time.time()

        events = await client.get_events_by_year(year)
        einstein_keys = [
            ev["key"] for ev in (events or [])
            if ev.get("event_type") == _EINSTEIN_EVENT_TYPE
        ]

        if not einstein_keys:
            print(f"no Einstein events found")
            continue

        print(f"{len(einstein_keys)} Einstein event(s): {einstein_keys}", end=" ")

        # Fetch alliances + awards for each Einstein event in parallel
        alliance_results, award_results = await asyncio.gather(
            asyncio.gather(*[client.get_event_alliances(ek) for ek in einstein_keys]),
            asyncio.gather(*[client.get_event_awards(ek) for ek in einstein_keys]),
        )

        contenders: set[int] = set()
        winners: set[int] = set()

        for alliances in alliance_results:
            if not alliances:
                continue
            for al in alliances:
                for tk in al.get("picks", []):
                    if tk.startswith("frc"):
                        try:
                            contenders.add(int(tk[3:]))
                        except ValueError:
                            pass

        for awards in award_results:
            if not awards:
                continue
            for award in awards:
                if award.get("award_type") == _WINNER_AWARD_TYPE:
                    for r in award.get("recipient_list") or []:
                        tk = r.get("team_key", "")
                        if tk.startswith("frc"):
                            try:
                                winners.add(int(tk[3:]))
                            except ValueError:
                                pass

        # Also fetch team nicknames for anyone new (batch per team via event teams)
        for ek in einstein_keys:
            try:
                teams = await client.get_event_teams_full(ek)
                for t in (teams or []):
                    num = t.get("team_number")
                    if num and not team_data[num]["nickname"]:
                        team_data[num]["nickname"] = t.get("nickname", "")
            except Exception:
                pass

        for num in contenders:
            team_data[num]["contender_years"].add(year)
        for num in winners:
            team_data[num]["winner_years"].add(year)

        elapsed = time.time() - t0
        print(f"— {len(contenders)} contenders, {len(winners)} winners ({elapsed:.1f}s)")

    # Serialise
    output: dict[str, dict] = {}
    for num, d in sorted(team_data.items()):
        if not d["contender_years"]:
            continue
        output[str(num)] = {
            "nickname": d["nickname"],
            "contender_years": sorted(d["contender_years"]),
            "winner_years": sorted(d["winner_years"]),
        }

    _OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(_OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)
        f.write("\n")

    print(f"\nWrote {len(output)} teams to {_OUTPUT_PATH}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate einstein_history.json")
    parser.add_argument("--first-year", type=int, default=2006,
                        help="First year to include (default: 2006)")
    parser.add_argument("--last-year", type=int, default=None,
                        help="Last year to include (default: current year)")
    args = parser.parse_args()

    import datetime
    last = args.last_year or datetime.date.today().year

    print(f"Building Einstein history {args.first_year}–{last}...")
    asyncio.run(main(args.first_year, last))
