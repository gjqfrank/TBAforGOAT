#!/usr/bin/env python3
"""Benchmark: full caster event flow for FRC + FTC.

Simulates a caster loading an event and navigating through all major tabs/actions:
  1. Load event (info + teams + rankings)
  2. Match flow (scores + all matches + playoff matches)
  3. Summary tab (summary, awards, connections)
  4. Team deep-dive (team stats, head-to-head)
  5. Repeat 1-3 to measure cache-warm performance
  6. Parallel burst (simulate rapid tab switching)

Usage:
    python scripts/benchmark_event_flow.py [--frc EVENT] [--ftc EVENT]

Defaults:
    FRC: env BENCH_FRC_EVENT or auto-detects an active event
    FTC: env BENCH_FTC_EVENT or 2024ftcftccmp1edis (FTC Worlds Edison)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import sys
import time
from dataclasses import dataclass, field

import httpx

BASE = os.environ.get("BENCH_BASE_URL", "http://127.0.0.1:8000")


@dataclass
class Result:
    name: str
    status: int
    elapsed_ms: float
    ok: bool = True
    detail: str = ""


@dataclass
class PhaseResult:
    name: str
    results: list[Result] = field(default_factory=list)

    @property
    def total_ms(self) -> float:
        return sum(r.elapsed_ms for r in self.results)

    @property
    def all_ok(self) -> bool:
        return all(r.ok for r in self.results)

    def summary_line(self) -> str:
        ok_count = sum(1 for r in self.results if r.ok)
        symbol = "✓" if self.all_ok else "✗"
        return f"  {symbol} {self.name}: {ok_count}/{len(self.results)} ok — {self.total_ms:.0f} ms total"


async def timed_get(client: httpx.AsyncClient, path: str, label: str = "") -> Result:
    """Single timed GET request."""
    url = f"{BASE}/api{path}"
    label = label or path
    t0 = time.perf_counter()
    try:
        resp = await client.get(url)
        elapsed = (time.perf_counter() - t0) * 1000
        ok = resp.status_code == 200
        detail = "" if ok else f"HTTP {resp.status_code}"
        return Result(label, resp.status_code, elapsed, ok, detail)
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return Result(label, 0, elapsed, False, str(e))


async def timed_parallel(client: httpx.AsyncClient, paths: list[tuple[str, str]]) -> list[Result]:
    """Run multiple GETs concurrently, return results."""
    tasks = [timed_get(client, p, lbl) for p, lbl in paths]
    return await asyncio.gather(*tasks)


def print_phase(phase: PhaseResult):
    print(phase.summary_line())
    for r in phase.results:
        symbol = "✓" if r.ok else "✗"
        detail = f" ({r.detail})" if r.detail else ""
        print(f"    {symbol} {r.name:<50s} {r.elapsed_ms:>8.0f} ms{detail}")


# ═══════════════════════════════════════════════════════════
#  FRC EVENT FLOW
# ═══════════════════════════════════════════════════════════

async def benchmark_frc(client: httpx.AsyncClient, event: str):
    print(f"\n{'═' * 60}")
    print(f"  FRC EVENT FLOW BENCHMARK — {event}")
    print(f"{'═' * 60}\n")

    all_phases: list[PhaseResult] = []

    # ── Phase 1: Load event (cold) ──────────────────────
    phase = PhaseResult("Phase 1 — Load Event (cold)")
    phase.results.append(await timed_get(client, f"/events/{event}/info", "event info"))
    phase.results.append(await timed_get(client, f"/events/{event}/teams", "teams + stats"))
    phase.results.append(await timed_get(client, f"/events/{event}/fast-rankings", "rankings"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 2: Match flow ─────────────────────────────
    phase = PhaseResult("Phase 2 — Match Flow")
    phase.results.append(await timed_get(client, f"/matches/{event}/scores", "fast scores"))
    phase.results.append(await timed_get(client, f"/matches/{event}/all", "all matches"))
    phase.results.append(await timed_get(client, f"/matches/{event}/playoffs", "playoffs"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 3: Summary tab ────────────────────────────
    phase = PhaseResult("Phase 3 — Summary Tab")
    phase.results.append(await timed_get(client, f"/events/{event}/summary", "summary"))
    phase.results.append(await timed_get(client, f"/events/{event}/summary/awards", "awards"))
    phase.results.append(await timed_get(client, f"/events/{event}/summary/connections?all_time=false", "connections"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 4: Team deep-dive ─────────────────────────
    # Grab first two teams from teams list
    resp = await client.get(f"{BASE}/api/events/{event}/teams")
    teams = resp.json() if resp.status_code == 200 else []
    team_nums = [t.get("team_number", t.get("number", 0)) for t in teams[:2]]

    phase = PhaseResult("Phase 4 — Team Deep-Dive")
    for tn in team_nums:
        phase.results.append(await timed_get(client, f"/teams/{tn}/stats?year=2026", f"team {tn} stats"))
    if len(team_nums) >= 2:
        a, b = team_nums[0], team_nums[1]
        phase.results.append(await timed_get(client, f"/teams/head-to-head/{a}/{b}?year=2026", f"H2H {a} vs {b}"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 5: Warm cache re-run ──────────────────────
    phase = PhaseResult("Phase 5 — Warm Cache Re-Run (phases 1-3)")
    warm_paths = [
        (f"/events/{event}/info", "info (warm)"),
        (f"/events/{event}/teams", "teams (warm)"),
        (f"/events/{event}/fast-rankings", "rankings (warm)"),
        (f"/matches/{event}/scores", "scores (warm)"),
        (f"/matches/{event}/all", "all matches (warm)"),
        (f"/events/{event}/summary", "summary (warm)"),
    ]
    for path, lbl in warm_paths:
        phase.results.append(await timed_get(client, path, lbl))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 6: Parallel burst (rapid tab switching) ───
    burst_paths = [
        (f"/events/{event}/info", "info"),
        (f"/events/{event}/teams", "teams"),
        (f"/events/{event}/fast-rankings", "rankings"),
        (f"/matches/{event}/scores", "scores"),
        (f"/matches/{event}/all", "all matches"),
        (f"/matches/{event}/playoffs", "playoffs"),
        (f"/events/{event}/summary", "summary"),
    ]
    phase = PhaseResult("Phase 6 — Parallel Burst (7 concurrent)")
    phase.results = list(await timed_parallel(client, burst_paths))
    all_phases.append(phase)
    print_phase(phase)

    # ── Summary ─────────────────────────────────────────
    _print_summary("FRC", event, all_phases)
    return all_phases


# ═══════════════════════════════════════════════════════════
#  FTC EVENT FLOW
# ═══════════════════════════════════════════════════════════

async def benchmark_ftc(client: httpx.AsyncClient, event: str):
    print(f"\n{'═' * 60}")
    print(f"  FTC EVENT FLOW BENCHMARK — {event}")
    print(f"{'═' * 60}\n")

    all_phases: list[PhaseResult] = []

    # ── Phase 1: Load event (cold) ──────────────────────
    phase = PhaseResult("Phase 1 — Load Event (cold)")
    phase.results.append(await timed_get(client, f"/ftc/events/{event}/info", "event info"))
    phase.results.append(await timed_get(client, f"/ftc/events/{event}/teams", "teams + stats"))
    phase.results.append(await timed_get(client, f"/ftc/events/{event}/fast-rankings", "rankings"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 2: Match flow ─────────────────────────────
    phase = PhaseResult("Phase 2 — Match Flow")
    phase.results.append(await timed_get(client, f"/ftc/matches/{event}/scores", "fast scores"))
    phase.results.append(await timed_get(client, f"/ftc/matches/{event}/all", "all matches"))
    phase.results.append(await timed_get(client, f"/ftc/matches/{event}/playoffs", "playoffs"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 3: Summary tab ────────────────────────────
    phase = PhaseResult("Phase 3 — Summary Tab")
    phase.results.append(await timed_get(client, f"/ftc/events/{event}/awards", "awards"))
    phase.results.append(await timed_get(client, f"/ftc/events/{event}/past-awards", "past awards"))
    phase.results.append(await timed_get(client, f"/ftc/events/{event}/summary/connections?all_time=false", "connections"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 4: Team deep-dive ─────────────────────────
    resp = await client.get(f"{BASE}/api/ftc/events/{event}/teams")
    teams = resp.json() if resp.status_code == 200 else []
    team_nums = [t.get("team_number", t.get("number", 0)) for t in teams[:2]]

    phase = PhaseResult("Phase 4 — Team Deep-Dive")
    for tn in team_nums:
        phase.results.append(await timed_get(client, f"/ftc/events/team/{tn}", f"team {tn} lookup"))
    if len(team_nums) >= 2:
        a, b = team_nums[0], team_nums[1]
        phase.results.append(await timed_get(client, f"/ftc/matches/head-to-head/{a}/{b}", f"H2H {a} vs {b}"))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 5: Warm cache re-run ──────────────────────
    phase = PhaseResult("Phase 5 — Warm Cache Re-Run (phases 1-3)")
    warm_paths = [
        (f"/ftc/events/{event}/info", "info (warm)"),
        (f"/ftc/events/{event}/teams", "teams (warm)"),
        (f"/ftc/events/{event}/fast-rankings", "rankings (warm)"),
        (f"/ftc/matches/{event}/scores", "scores (warm)"),
        (f"/ftc/matches/{event}/all", "all matches (warm)"),
        (f"/ftc/events/{event}/awards", "awards (warm)"),
    ]
    for path, lbl in warm_paths:
        phase.results.append(await timed_get(client, path, lbl))
    all_phases.append(phase)
    print_phase(phase)

    # ── Phase 6: Parallel burst (rapid tab switching) ───
    burst_paths = [
        (f"/ftc/events/{event}/info", "info"),
        (f"/ftc/events/{event}/teams", "teams"),
        (f"/ftc/events/{event}/fast-rankings", "rankings"),
        (f"/ftc/matches/{event}/scores", "scores"),
        (f"/ftc/matches/{event}/all", "all matches"),
        (f"/ftc/matches/{event}/playoffs", "playoffs"),
        (f"/ftc/events/{event}/awards", "awards"),
    ]
    phase = PhaseResult("Phase 6 — Parallel Burst (7 concurrent)")
    phase.results = list(await timed_parallel(client, burst_paths))
    all_phases.append(phase)
    print_phase(phase)

    # ── Summary ─────────────────────────────────────────
    _print_summary("FTC", event, all_phases)
    return all_phases


# ═══════════════════════════════════════════════════════════
#  SUMMARY & MAIN
# ═══════════════════════════════════════════════════════════

def _print_summary(program: str, event: str, phases: list[PhaseResult]):
    all_results = [r for p in phases for r in p.results]
    ok = sum(1 for r in all_results if r.ok)
    fail = len(all_results) - ok
    times = [r.elapsed_ms for r in all_results if r.ok]

    print(f"\n{'─' * 60}")
    print(f"  {program} SUMMARY — {event}")
    print(f"{'─' * 60}")
    print(f"  Endpoints tested : {len(all_results)} ({ok} ok, {fail} failed)")

    if times:
        print(f"  Total wall time  : {sum(times):.0f} ms")
        print(f"  Mean latency     : {statistics.mean(times):.0f} ms")
        print(f"  Median latency   : {statistics.median(times):.0f} ms")
        print(f"  p95 latency      : {sorted(times)[int(len(times) * 0.95)]:.0f} ms")
        print(f"  Min / Max        : {min(times):.0f} ms / {max(times):.0f} ms")

    # Cold vs warm comparison
    cold_phases = [p for p in phases if "cold" in p.name.lower() or p.name.startswith("Phase 1") or p.name.startswith("Phase 2") or p.name.startswith("Phase 3")]
    warm_phase = next((p for p in phases if "Warm" in p.name), None)
    if cold_phases and warm_phase:
        cold_total = sum(p.total_ms for p in cold_phases[:3])
        warm_total = warm_phase.total_ms
        if warm_total > 0:
            speedup = cold_total / warm_total
            print(f"\n  Cold load (ph1-3) : {cold_total:.0f} ms")
            print(f"  Warm cache        : {warm_total:.0f} ms")
            print(f"  Cache speedup     : {speedup:.1f}x")

    burst_phase = next((p for p in phases if "Burst" in p.name), None)
    if burst_phase:
        burst_max = max(r.elapsed_ms for r in burst_phase.results) if burst_phase.results else 0
        print(f"\n  Parallel burst    : {burst_phase.total_ms:.0f} ms total, {burst_max:.0f} ms longest")

    if fail > 0:
        print(f"\n  ⚠ FAILED REQUESTS:")
        for r in all_results:
            if not r.ok:
                print(f"    ✗ {r.name}: {r.detail}")
    print()


async def find_active_frc_event(client: httpx.AsyncClient) -> str:
    """Find an active FRC event for today."""
    resp = await client.get(f"{BASE}/api/events/season/2026")
    if resp.status_code != 200:
        return "2026tuak"  # fallback
    events = resp.json()
    # Prefer events that started recently (likely have data)
    for e in events:
        start = e.get("start_date", "")
        end = e.get("end_date", "")
        if start <= "2026-04-09" and end >= "2026-04-09":
            return e["key"]
    return "2026tuak"


async def main():
    parser = argparse.ArgumentParser(description="Benchmark FRC + FTC event flow")
    parser.add_argument("--frc", default=os.environ.get("BENCH_FRC_EVENT", ""), help="FRC event key")
    parser.add_argument("--ftc", default=os.environ.get("BENCH_FTC_EVENT", "2024ftcftccmp1edis"), help="FTC event key")
    parser.add_argument("--skip-frc", action="store_true", help="Skip FRC benchmark")
    parser.add_argument("--skip-ftc", action="store_true", help="Skip FTC benchmark")
    args = parser.parse_args()

    async with httpx.AsyncClient(timeout=60.0) as client:
        # Health check
        try:
            resp = await client.get(f"{BASE}/api/health")
            if resp.status_code != 200:
                print("❌ Server not healthy. Start the server first.")
                sys.exit(1)
        except Exception:
            print("❌ Cannot reach server. Start the server first.")
            sys.exit(1)

        print(f"Server: {BASE}")
        print(f"Date: 2026-04-09")

        if not args.skip_frc:
            frc_event = args.frc or await find_active_frc_event(client)
            await benchmark_frc(client, frc_event)

        if not args.skip_ftc:
            await benchmark_ftc(client, args.ftc)


if __name__ == "__main__":
    asyncio.run(main())
