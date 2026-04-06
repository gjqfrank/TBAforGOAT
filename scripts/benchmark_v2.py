#!/usr/bin/env python3
"""
Benchmark v2 offline-architecture endpoints.
Measures cold, warm, and cache-hit performance for key data flows.
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
EVENT = "2025tuhc"       # Test event
SNAP_DIR = Path(__file__).resolve().parent.parent / "data" / "saved_events"
SNAP_FILE = SNAP_DIR / f"snap_{EVENT}.json"

# ── helpers ─────────────────────────────────────────────────────────
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

# ── V2 snapshot benchmark ──────────────────────────────────────────
async def bench_snapshot(client: httpx.AsyncClient) -> list[dict]:
    results = []

    # 1) Cold miss — delete cache, force full ingestion + build
    if SNAP_FILE.exists():
        SNAP_FILE.unlink()
    r = await timed_get(client, f"/api/events/{EVENT}/snapshot",
                        "snapshot:cold-miss", timeout=60)
    results.append(r)

    # 2) Warm cache hit (immediate re-request)
    r = await timed_get(client, f"/api/events/{EVENT}/snapshot",
                        "snapshot:warm-cache")
    results.append(r)

    # 3) Repeated cache hits (5x for p50/p99 stats)
    for i in range(5):
        r = await timed_get(client, f"/api/events/{EVENT}/snapshot",
                            f"snapshot:cache-hit-{i+1}")
        results.append(r)

    return results


# ── Individual endpoint benchmarks (simulating main-branch flow) ───
async def bench_individual_endpoints(client: httpx.AsyncClient) -> list[dict]:
    """Measure the same data but fetched as individual API calls
    (equivalent to what main-branch frontend does)."""
    results = []

    endpoints = [
        (f"/api/events/{EVENT}/info", "individual:event-info"),
        (f"/api/events/{EVENT}/teams", "individual:event-teams"),
        (f"/api/matches/{EVENT}/all", "individual:all-matches"),
        (f"/api/matches/{EVENT}/playoffs", "individual:playoff-matches"),
        (f"/api/alliances/{EVENT}", "individual:alliances"),
    ]

    # Sequential (worst case — like browser with limited connections)
    t0 = time.perf_counter()
    for path, label in endpoints:
        r = await timed_get(client, path, label)
        results.append(r)
    total_seq = time.perf_counter() - t0
    results.append({
        "label": "individual:total-sequential",
        "path": "sum",
        "status": 200,
        "time_s": total_seq,
        "size_kb": sum(r["size_kb"] for r in results if r["ok"]),
        "ok": True,
    })

    # Parallel (best case — browser fires all at once)
    t0 = time.perf_counter()
    parallel_results = await asyncio.gather(*[
        timed_get(client, path, f"parallel:{label.split(':')[1]}")
        for path, label in endpoints
    ])
    total_par = time.perf_counter() - t0
    results.extend(parallel_results)
    results.append({
        "label": "individual:total-parallel",
        "path": "gather",
        "status": 200,
        "time_s": total_par,
        "size_kb": sum(r["size_kb"] for r in parallel_results if r["ok"]),
        "ok": True,
    })

    return results


# ── Summary tab benchmark ──────────────────────────────────────────
async def bench_summary(client: httpx.AsyncClient) -> list[dict]:
    results = []

    # Cold summary (first call)
    r = await timed_get(client, f"/api/events/{EVENT}/summary",
                        "summary:cold", timeout=30)
    results.append(r)

    # Warm summary (TBA in-memory cache should be hot)
    r = await timed_get(client, f"/api/events/{EVENT}/summary",
                        "summary:warm", timeout=30)
    results.append(r)

    # Summary sub-endpoints
    subs = [
        (f"/api/events/{EVENT}/summary/awards", "summary:awards"),
        (f"/api/events/{EVENT}/summary/refresh-stats", "summary:refresh-stats"),
        (f"/api/events/{EVENT}/summary/advancement", "summary:advancement"),
    ]
    for path, label in subs:
        r = await timed_get(client, path, label, timeout=30)
        results.append(r)

    return results


# ── Team quick-lookup benchmark ────────────────────────────────────
async def bench_team_lookup(client: httpx.AsyncClient) -> list[dict]:
    results = []

    # Pick a team from the event
    team_num = 7672  # from 2025tuhc attendees

    r = await timed_get(client, f"/api/teams/{team_num}/stats?year=2025",
                        "team:stats-cold", timeout=30)
    results.append(r)

    r = await timed_get(client, f"/api/teams/{team_num}/stats?year=2025",
                        "team:stats-warm", timeout=30)
    results.append(r)

    # Head-to-head
    r = await timed_get(client,
                        f"/api/teams/head-to-head/7672/8562?year=2025",
                        "team:h2h-cold", timeout=30)
    results.append(r)
    r = await timed_get(client,
                        f"/api/teams/head-to-head/7672/8562?year=2025",
                        "team:h2h-warm", timeout=30)
    results.append(r)

    # Compare teams
    r = await timed_get(client,
                        f"/api/events/{EVENT}/compare?teams=frc7672,frc8562",
                        "team:compare", timeout=30)
    results.append(r)

    return results


# ── Additional endpoints ───────────────────────────────────────────
async def bench_misc(client: httpx.AsyncClient) -> list[dict]:
    results = []

    r = await timed_get(client, "/api/events/world-record",
                        "misc:world-record", timeout=30)
    results.append(r)

    r = await timed_get(client,
                        "/api/events/season-high-scores?year=2025",
                        "misc:season-high-scores", timeout=30)
    results.append(r)

    r = await timed_get(client, f"/api/events/{EVENT}/fast-rankings",
                        "misc:fast-rankings", timeout=15)
    results.append(r)

    r = await timed_get(client, f"/api/matches/{EVENT}/scores",
                        "misc:fast-scores", timeout=15)
    results.append(r)

    return results


# ── Report ─────────────────────────────────────────────────────────
def print_report(all_results: list[dict]):
    sections = {}
    for r in all_results:
        sec = r["label"].split(":")[0]
        sections.setdefault(sec, []).append(r)

    print("\n" + "="*75)
    print(" V2 OFFLINE-ARCHITECTURE BENCHMARK")
    print("="*75)
    print(f" Event: {EVENT}  |  Server: {BASE}")
    print("="*75)

    for sec_name, items in sections.items():
        print(f"\n── {sec_name.upper()} {'─'*(60-len(sec_name))}")
        print(f"  {'Label':<35} {'Time':>8} {'Size':>8} {'Status':>7}")
        print(f"  {'─'*35} {'─'*8} {'─'*8} {'─'*7}")
        for r in items:
            status_str = "✓" if r["ok"] else f"✗ {r['status']}"
            err = r.get("error", "")
            time_str = _ms(r["time_s"])
            size_str = f"{r['size_kb']:.1f}KB" if r["size_kb"] else "—"
            line = f"  {r['label']:<35} {time_str:>8} {size_str:>8} {status_str:>7}"
            if err:
                line += f"  [{err[:40]}]"
            print(line)

    # Aggregate stats for cache hits
    cache_hits = [r for r in all_results
                  if "cache-hit" in r["label"] and r["ok"]]
    if cache_hits:
        times = [r["time_s"] for r in cache_hits]
        print(f"\n── CACHE-HIT STATS {'─'*46}")
        print(f"  p50: {_ms(statistics.median(times)):>8}")
        print(f"  p95: {_ms(sorted(times)[int(len(times)*0.95)]):>8}")
        print(f"  avg: {_ms(statistics.mean(times)):>8}")
        print(f"  min: {_ms(min(times)):>8}")
        print(f"  max: {_ms(max(times)):>8}")

    # Key comparison
    snap_cold = next((r for r in all_results if r["label"] == "snapshot:cold-miss"), None)
    snap_warm = next((r for r in all_results if r["label"] == "snapshot:warm-cache"), None)
    ind_seq = next((r for r in all_results if r["label"] == "individual:total-sequential"), None)
    ind_par = next((r for r in all_results if r["label"] == "individual:total-parallel"), None)
    sum_cold = next((r for r in all_results if r["label"] == "summary:cold"), None)
    sum_warm = next((r for r in all_results if r["label"] == "summary:warm"), None)

    print(f"\n{'='*75}")
    print(" KEY COMPARISONS")
    print(f"{'='*75}")
    if snap_cold and snap_warm:
        print(f"  Snapshot cold miss:        {_ms(snap_cold['time_s']):>8}  (first ever load, incl ingestion)")
        print(f"  Snapshot cache hit:        {_ms(snap_warm['time_s']):>8}  (subsequent loads)")
        if snap_cold["ok"] and snap_warm["ok"]:
            speedup = snap_cold["time_s"] / snap_warm["time_s"]
            print(f"  Cache speedup:             {speedup:.0f}x")
    if ind_seq:
        print(f"  Individual sequential:     {_ms(ind_seq['time_s']):>8}  (5 endpoints, one at a time)")
    if ind_par:
        print(f"  Individual parallel:       {_ms(ind_par['time_s']):>8}  (5 endpoints, all at once)")
    if snap_warm and ind_par and snap_warm["ok"] and ind_par["ok"]:
        speedup = ind_par["time_s"] / snap_warm["time_s"]
        print(f"  Snapshot vs parallel:      {speedup:.0f}x faster")
    if sum_cold and sum_warm:
        print(f"  Summary cold:              {_ms(sum_cold['time_s']):>8}")
        print(f"  Summary warm:              {_ms(sum_warm['time_s']):>8}")

    print(f"\n{'='*75}\n")


# ── main ───────────────────────────────────────────────────────────
async def main():
    async with httpx.AsyncClient() as client:
        # Health check
        r = await client.get(f"{BASE}/api/health", timeout=5)
        if r.status_code != 200:
            print(f"Server not ready: {r.status_code}")
            sys.exit(1)
        print(f"Server up at {BASE}")

        all_results = []

        print("\n[1/5] Benchmarking snapshot (cold / warm / cache) ...")
        all_results.extend(await bench_snapshot(client))

        print("[2/5] Benchmarking individual endpoints (sequential & parallel) ...")
        all_results.extend(await bench_individual_endpoints(client))

        print("[3/5] Benchmarking summary tab ...")
        all_results.extend(await bench_summary(client))

        print("[4/5] Benchmarking team quick-lookup ...")
        all_results.extend(await bench_team_lookup(client))

        print("[5/5] Benchmarking misc endpoints ...")
        all_results.extend(await bench_misc(client))

        print_report(all_results)

        # Save raw JSON for comparison later
        out = Path(__file__).resolve().parent / "benchmark_v2_results.json"
        with open(out, "w") as f:
            json.dump(all_results, f, indent=2)
        print(f"Raw results saved to {out}")


if __name__ == "__main__":
    asyncio.run(main())
