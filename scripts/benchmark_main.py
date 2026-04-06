#!/usr/bin/env python3
"""
Simulate main-branch load pattern by clearing TBA in-memory caches
before each test group. This forces the backend to re-fetch from
external APIs, simulating a fresh page load on main.

On main branch the frontend calls TBA and FRC APIs directly. Our v2
backend proxies the same APIs but adds in-memory caching. To get a
fair "main-branch equivalent" we clear caches before measuring.
"""

import asyncio
import json
import os
import sys
import time
from pathlib import Path

import httpx

BASE = os.getenv("API_BASE", "http://localhost:8000")
EVENT = "2025tuhc"


def _ms(t: float) -> str:
    return f"{t*1000:.0f}ms"


async def timed_get(client: httpx.AsyncClient, path: str, label: str,
                    timeout: float = 30.0) -> dict:
    url = f"{BASE}{path}"
    t0 = time.perf_counter()
    try:
        r = await client.get(url, timeout=timeout)
        elapsed = time.perf_counter() - t0
        return {
            "label": label,
            "path": path,
            "status": r.status_code,
            "time_s": elapsed,
            "size_kb": len(r.content) / 1024,
            "ok": r.status_code == 200,
        }
    except Exception as e:
        elapsed = time.perf_counter() - t0
        return {
            "label": label,
            "path": path,
            "status": 0,
            "time_s": elapsed,
            "size_kb": 0,
            "ok": False,
            "error": str(e),
        }


async def clear_caches(client: httpx.AsyncClient):
    """Call clear-cache to drop TBA in-memory caches for this event."""
    await client.get(f"{BASE}/api/events/{EVENT}/clear-cache", timeout=10)
    # Small pause for cleanup
    await asyncio.sleep(0.2)


async def main():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BASE}/api/health", timeout=5)
        if r.status_code != 200:
            print(f"Server not ready: {r.status_code}")
            sys.exit(1)
        print(f"Server up at {BASE}")

        results = []

        # ── PHASE 1: Initial event load (cold caches = main-branch equivalent) ──
        print("\n[1/4] Main-branch equivalent: Initial event load (cold caches) ...")
        await clear_caches(client)

        # Phase 1 endpoints (what main-branch frontend loads on page open)
        phase1 = [
            (f"/api/events/{EVENT}/info", "main:event-info"),
            (f"/api/events/{EVENT}/teams", "main:event-teams"),
        ]
        t0 = time.perf_counter()
        p1_results = await asyncio.gather(*[
            timed_get(client, path, label) for path, label in phase1
        ])
        p1_total = time.perf_counter() - t0
        results.extend(p1_results)
        results.append({
            "label": "main:phase1-total",
            "path": "parallel",
            "status": 200,
            "time_s": p1_total,
            "size_kb": sum(r["size_kb"] for r in p1_results if r["ok"]),
            "ok": True,
        })

        # Phase 2 endpoints (loaded in background)
        phase2 = [
            (f"/api/matches/{EVENT}/all", "main:all-matches"),
            (f"/api/matches/{EVENT}/playoffs", "main:playoff-matches"),
            (f"/api/alliances/{EVENT}", "main:alliances"),
        ]
        t0 = time.perf_counter()
        p2_results = await asyncio.gather(*[
            timed_get(client, path, label) for path, label in phase2
        ])
        p2_total = time.perf_counter() - t0
        results.extend(p2_results)
        results.append({
            "label": "main:phase2-total",
            "path": "parallel",
            "status": 200,
            "time_s": p2_total,
            "size_kb": sum(r["size_kb"] for r in p2_results if r["ok"]),
            "ok": True,
        })

        full_load = p1_total + p2_total
        results.append({
            "label": "main:full-event-load",
            "path": "sum",
            "status": 200,
            "time_s": full_load,
            "size_kb": sum(r["size_kb"] for r in p1_results + p2_results if r["ok"]),
            "ok": True,
        })

        # ── PHASE 2: Summary tab (cold) ──
        print("[2/4] Main-branch equivalent: Summary tab (cold caches) ...")
        await clear_caches(client)

        r = await timed_get(client, f"/api/events/{EVENT}/summary",
                            "main:summary-cold", timeout=30)
        results.append(r)

        # Awards (always separate call)
        r = await timed_get(client, f"/api/events/{EVENT}/summary/awards",
                            "main:summary-awards-cold", timeout=30)
        results.append(r)

        # ── PHASE 3: Team lookup (cold) ──
        print("[3/4] Main-branch equivalent: Team lookup (cold caches) ...")
        await clear_caches(client)

        r = await timed_get(client, f"/api/teams/7672/stats?year=2025",
                            "main:team-stats-cold", timeout=30)
        results.append(r)

        r = await timed_get(client,
                            f"/api/teams/head-to-head/7672/8562?year=2025",
                            "main:h2h-cold", timeout=30)
        results.append(r)

        # ── PHASE 4: Repeat with warm caches (simulates staying on page) ──
        print("[4/4] Main-branch equivalent: Warm cache re-fetches ...")
        # DON'T clear caches — simulate user still on page

        p1w = await asyncio.gather(*[
            timed_get(client, path, f"main-warm:{label.split(':')[1]}")
            for path, label in phase1
        ])
        p2w = await asyncio.gather(*[
            timed_get(client, path, f"main-warm:{label.split(':')[1]}")
            for path, label in phase2
        ])
        results.extend(p1w)
        results.extend(p2w)
        warm_total = max(r["time_s"] for r in p1w) + max(r["time_s"] for r in p2w)
        results.append({
            "label": "main-warm:full-event-load",
            "path": "parallel",
            "status": 200,
            "time_s": warm_total,
            "size_kb": sum(r["size_kb"] for r in p1w + p2w if r["ok"]),
            "ok": True,
        })

        # ── Report ─────────────────────────────────────────────────────
        print_report(results)

        out = Path(__file__).resolve().parent / "benchmark_main_results.json"
        with open(out, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Raw results saved to {out}")


def print_report(all_results: list[dict]):
    sections = {}
    for r in all_results:
        sec = r["label"].split(":")[0]
        sections.setdefault(sec, []).append(r)

    print("\n" + "="*75)
    print(" MAIN-BRANCH EQUIVALENT BENCHMARK (cold external API calls)")
    print("="*75)
    print(f" Event: {EVENT}  |  Server: {BASE}")
    print("="*75)

    for sec_name, items in sections.items():
        print(f"\n── {sec_name.upper()} {'─'*(60-len(sec_name))}")
        print(f"  {'Label':<40} {'Time':>8} {'Size':>8} {'Status':>7}")
        print(f"  {'─'*40} {'─'*8} {'─'*8} {'─'*7}")
        for r in items:
            status_str = "✓" if r["ok"] else f"✗ {r['status']}"
            err = r.get("error", "")
            time_str = _ms(r["time_s"])
            size_str = f"{r['size_kb']:.1f}KB" if r["size_kb"] else "—"
            line = f"  {r['label']:<40} {time_str:>8} {size_str:>8} {status_str:>7}"
            if err:
                line += f"  [{err[:40]}]"
            print(line)

    print(f"\n{'='*75}\n")


if __name__ == "__main__":
    asyncio.run(main())
