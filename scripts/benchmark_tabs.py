#!/usr/bin/env python3
"""
Benchmark: Initial tab loading for an ONGOING event.

Measures two things:
1. "Supabase path" — data already warm in Supabase from workers (v2 architecture)
2. "Cold API path"  — after clearing all caches, forcing TBA/FRC API fallback
   (equivalent to what main-branch does every page load)

Tabs tested:
  - Teams tab   (event info + teams with rank/OPR/EPA/avatars)
  - Matches tab (all matches + scores)
  - Alliances tab
  - Rankings tab (fast-rankings, hot 5s polling)
  - Summary tab
  - Compare tab (2 random teams)
"""

import asyncio
import json
import os
import statistics
import sys
import time
from pathlib import Path

import httpx

BASE = os.getenv("API_BASE", "http://localhost:8000")
# Use an ongoing event (workers actively populating Supabase)
EVENT = os.getenv("BENCH_EVENT", "2026nyn2")

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


# All the endpoints a frontend loads for each "tab"
TABS = {
    "info": [
        (f"/api/events/{EVENT}/info", "info"),
    ],
    "teams": [
        (f"/api/events/{EVENT}/teams", "teams"),
    ],
    "rankings": [
        (f"/api/events/{EVENT}/fast-rankings", "fast-rankings"),
    ],
    "matches": [
        (f"/api/matches/{EVENT}/all", "all-matches"),
    ],
    "scores": [
        (f"/api/matches/{EVENT}/scores", "fast-scores"),
    ],
    "alliances": [
        (f"/api/alliances/{EVENT}", "alliances"),
    ],
    "summary": [
        (f"/api/events/{EVENT}/summary", "summary"),
    ],
    "compare": [
        (f"/api/events/{EVENT}/compare?teams=frc335,frc4130", "compare"),
    ],
}


async def clear_all_caches(client: httpx.AsyncClient):
    """Drop all in-memory + disk caches so every request hits external APIs."""
    await client.get(f"{BASE}/api/events/{EVENT}/clear-cache", timeout=10)
    await asyncio.sleep(0.3)


async def bench_supabase_path(client: httpx.AsyncClient) -> list[dict]:
    """Measure tab loads when Supabase is warm (workers have populated data).
    This is the v2 user experience — instant loads from pre-cached Supabase."""
    results = []

    # Individual tabs (sequential — measures per-tab latency)
    for tab_name, endpoints in TABS.items():
        for path, label in endpoints:
            r = await timed_get(client, path, f"v2-warm:{label}")
            results.append(r)

    # Full page load: all tabs in parallel (what the frontend actually does)
    all_endpoints = [(p, l) for eps in TABS.values() for p, l in eps]
    t0 = time.perf_counter()
    parallel = await asyncio.gather(*[
        timed_get(client, p, f"v2-parallel:{l}") for p, l in all_endpoints
    ])
    total_par = time.perf_counter() - t0
    results.extend(parallel)
    results.append({
        "label": "v2-parallel:TOTAL",
        "path": "gather",
        "status": 200,
        "time_s": total_par,
        "size_kb": sum(r["size_kb"] for r in parallel if r["ok"]),
        "ok": all(r["ok"] for r in parallel),
    })

    return results


async def bench_cold_api_path(client: httpx.AsyncClient) -> list[dict]:
    """Measure tab loads after clearing all caches.
    This simulates the main-branch experience where every request
    must hit TBA/Statbotics/FRC API directly."""
    results = []

    await clear_all_caches(client)

    # Individual tabs (sequential — a new user clicking through tabs)
    for tab_name, endpoints in TABS.items():
        for path, label in endpoints:
            r = await timed_get(client, path, f"cold:{label}")
            results.append(r)

    # Clear again for fair parallel test
    await clear_all_caches(client)

    # Full page load: all tabs in parallel
    all_endpoints = [(p, l) for eps in TABS.values() for p, l in eps]
    t0 = time.perf_counter()
    parallel = await asyncio.gather(*[
        timed_get(client, p, f"cold-parallel:{l}") for p, l in all_endpoints
    ])
    total_par = time.perf_counter() - t0
    results.extend(parallel)
    results.append({
        "label": "cold-parallel:TOTAL",
        "path": "gather",
        "status": 200,
        "time_s": total_par,
        "size_kb": sum(r["size_kb"] for r in parallel if r["ok"]),
        "ok": all(r["ok"] for r in parallel),
    })

    return results


def print_report(all_results: list[dict]):
    sections = {}
    for r in all_results:
        sec = r["label"].split(":")[0]
        sections.setdefault(sec, []).append(r)

    print("\n" + "=" * 75)
    print("  TAB-LOADING BENCHMARK — ONGOING EVENT")
    print("=" * 75)
    print(f"  Event: {EVENT}  |  Server: {BASE}")
    print("=" * 75)

    for sec_name, items in sections.items():
        print(f"\n── {sec_name.upper()} {'─' * (60 - len(sec_name))}")
        print(f"  {'Label':<35} {'Time':>8} {'Size':>8} {'Status':>7}")
        print(f"  {'─' * 35} {'─' * 8} {'─' * 8} {'─' * 7}")
        for r in items:
            status_str = "✓" if r["ok"] else f"✗ {r['status']}"
            time_str = _ms(r["time_s"])
            size_str = f"{r['size_kb']:.1f}KB" if r["size_kb"] else "—"
            err = r.get("error", "")
            line = f"  {r['label']:<35} {time_str:>8} {size_str:>8} {status_str:>7}"
            if err:
                line += f"  [{err[:40]}]"
            print(line)

    # Head-to-head comparison
    v2_total = next((r for r in all_results if r["label"] == "v2-parallel:TOTAL"), None)
    cold_total = next((r for r in all_results if r["label"] == "cold-parallel:TOTAL"), None)

    print(f"\n{'=' * 75}")
    print("  HEAD-TO-HEAD: Supabase (v2) vs Cold API (main-equivalent)")
    print(f"{'=' * 75}")

    # Per-tab comparison
    tab_labels = [l for eps in TABS.values() for _, l in eps]
    print(f"\n  {'Tab':<20} {'v2 (warm)':>10} {'Cold API':>10} {'Speedup':>10}")
    print(f"  {'─' * 20} {'─' * 10} {'─' * 10} {'─' * 10}")
    for label in tab_labels:
        v2_r = next((r for r in all_results if r["label"] == f"v2-warm:{label}"), None)
        cold_r = next((r for r in all_results if r["label"] == f"cold:{label}"), None)
        if v2_r and cold_r and v2_r["ok"] and cold_r["ok"]:
            speedup = cold_r["time_s"] / v2_r["time_s"] if v2_r["time_s"] > 0 else 0
            print(f"  {label:<20} {_ms(v2_r['time_s']):>10} {_ms(cold_r['time_s']):>10} {speedup:>9.0f}x")
        elif v2_r and cold_r:
            print(f"  {label:<20} {_ms(v2_r['time_s']):>10} {_ms(cold_r['time_s']):>10} {'—':>10}")

    if v2_total and cold_total and v2_total["ok"] and cold_total["ok"]:
        speedup = cold_total["time_s"] / v2_total["time_s"] if v2_total["time_s"] > 0 else 0
        print(f"\n  {'ALL TABS (parallel)':<20} {_ms(v2_total['time_s']):>10} {_ms(cold_total['time_s']):>10} {speedup:>9.0f}x")
        print(f"\n  Data transferred:    {v2_total['size_kb']:.0f} KB (v2)  vs  {cold_total['size_kb']:.0f} KB (cold)")

    print(f"\n{'=' * 75}\n")


async def main():
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{BASE}/api/health", timeout=5)
        if r.status_code != 200:
            print(f"Server not ready: {r.status_code}")
            sys.exit(1)
        print(f"Server up at {BASE}, testing event: {EVENT}")

        all_results = []

        print("\n[1/2] V2 path: Supabase warm (workers pre-populated) ...")
        all_results.extend(await bench_supabase_path(client))

        print("[2/2] Cold API path: main-branch equivalent (cache cleared) ...")
        all_results.extend(await bench_cold_api_path(client))

        print_report(all_results)

        out = Path(__file__).resolve().parent / "benchmark_tabs_results.json"
        with open(out, "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"Raw results saved to {out}")


if __name__ == "__main__":
    asyncio.run(main())
