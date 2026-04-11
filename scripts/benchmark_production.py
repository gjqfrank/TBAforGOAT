#!/usr/bin/env python3
"""Production-day benchmark: 8 simultaneous events, 16 casters, full Supabase load.

Simulates a realistic competition day:
  - 4 FRC events + 4 FTC events running at the same time
  - 2 casters per event (16 total concurrent users)
  - Each caster: loads event → tabs through data → writes/reads notes → TIMS edits
  - Tests TIMS persistence across events (edit at event A, verify at event B)
  - Measures latency percentiles, error rates, cache behaviour, Supabase pressure

Usage:
    python scripts/benchmark_production.py [--base URL]

Requires:
    pip install httpx  (already in requirements.txt)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import statistics
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

import httpx

BASE = os.environ.get("BENCH_BASE_URL", "http://127.0.0.1:8000")
API_KEY = os.environ.get("BENCH_API_KEY", "")

# ── Events to benchmark ────────────────────────────────────
FRC_EVENTS = ["2026tuak", "2026tuis2", "2026tuis5", "2026pncmp"]
FTC_EVENTS = ["2024ftcftccmp1edis", "2025ftctrcmp", "2026tuak2", "2025tuis2"]

# Fallback pools if some events are unavailable
FRC_FALLBACK = ["2025arc", "2025tuhc", "2025tuis2"]
FTC_FALLBACK = ["2025ftctrcmp", "2024ftcftccmp1edis"]

TIMS_TEST_TEAM = "frc8725"  # Known team for TIMS persistence test
TIMS_DEVICE_ID = f"bench-{uuid.uuid4().hex[:8]}"


# ═══════════════════════════════════════════════════════════
#  DATA STRUCTURES
# ═══════════════════════════════════════════════════════════

@dataclass
class RequestResult:
    label: str
    status: int
    elapsed_ms: float
    ok: bool = True
    detail: str = ""
    phase: str = ""
    user_id: str = ""
    event_key: str = ""


@dataclass
class UserSession:
    user_id: str
    event_key: str
    program: str  # 'frc' | 'ftc'
    results: list[RequestResult] = field(default_factory=list)
    teams_found: list = field(default_factory=list)

    @property
    def ok_count(self) -> int:
        return sum(1 for r in self.results if r.ok)

    @property
    def fail_count(self) -> int:
        return sum(1 for r in self.results if not r.ok)

    @property
    def total_ms(self) -> float:
        return sum(r.elapsed_ms for r in self.results)


# ═══════════════════════════════════════════════════════════
#  HTTP HELPERS
# ═══════════════════════════════════════════════════════════

def _headers() -> dict:
    h = {}
    if API_KEY:
        h["X-API-Key"] = API_KEY
    return h


async def tget(client: httpx.AsyncClient, path: str, label: str = "",
               phase: str = "", user_id: str = "", event_key: str = "") -> RequestResult:
    url = f"{BASE}/api{path}"
    label = label or path
    t0 = time.perf_counter()
    try:
        resp = await client.get(url, headers=_headers())
        elapsed = (time.perf_counter() - t0) * 1000
        ok = 200 <= resp.status_code < 400
        detail = "" if ok else f"HTTP {resp.status_code}"
        return RequestResult(label, resp.status_code, elapsed, ok, detail, phase, user_id, event_key)
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return RequestResult(label, 0, elapsed, False, str(e)[:120], phase, user_id, event_key)


async def tpost(client: httpx.AsyncClient, path: str, body: dict, label: str = "",
                phase: str = "", user_id: str = "", event_key: str = "") -> RequestResult:
    url = f"{BASE}/api{path}"
    label = label or path
    t0 = time.perf_counter()
    try:
        resp = await client.post(url, json=body, headers=_headers())
        elapsed = (time.perf_counter() - t0) * 1000
        ok = 200 <= resp.status_code < 400
        detail = "" if ok else f"HTTP {resp.status_code}"
        return RequestResult(label, resp.status_code, elapsed, ok, detail, phase, user_id, event_key)
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return RequestResult(label, 0, elapsed, False, str(e)[:120], phase, user_id, event_key)


async def tput(client: httpx.AsyncClient, path: str, body: dict, label: str = "",
               phase: str = "", user_id: str = "", event_key: str = "") -> RequestResult:
    url = f"{BASE}/api{path}"
    label = label or path
    t0 = time.perf_counter()
    try:
        resp = await client.put(url, json=body, headers=_headers())
        elapsed = (time.perf_counter() - t0) * 1000
        ok = 200 <= resp.status_code < 400
        detail = "" if ok else f"HTTP {resp.status_code}"
        return RequestResult(label, resp.status_code, elapsed, ok, detail, phase, user_id, event_key)
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return RequestResult(label, 0, elapsed, False, str(e)[:120], phase, user_id, event_key)


async def tdelete(client: httpx.AsyncClient, path: str, label: str = "",
                  phase: str = "", user_id: str = "", event_key: str = "") -> RequestResult:
    url = f"{BASE}/api{path}"
    label = label or path
    t0 = time.perf_counter()
    try:
        resp = await client.delete(url, headers=_headers())
        elapsed = (time.perf_counter() - t0) * 1000
        ok = 200 <= resp.status_code < 400
        detail = "" if ok else f"HTTP {resp.status_code}"
        return RequestResult(label, resp.status_code, elapsed, ok, detail, phase, user_id, event_key)
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return RequestResult(label, 0, elapsed, False, str(e)[:120], phase, user_id, event_key)


# ═══════════════════════════════════════════════════════════
#  INDIVIDUAL CASTER SESSION
# ═══════════════════════════════════════════════════════════

async def run_caster_session(client: httpx.AsyncClient, event_key: str,
                             program: str, caster_idx: int) -> UserSession:
    """Simulate one caster's full session at one event."""
    uid = f"{program}-caster-{caster_idx}"
    session = UserSession(uid, event_key, program)
    kw = dict(user_id=uid, event_key=event_key)

    is_ftc = program == "ftc"
    pfx = "/ftc" if is_ftc else ""

    # ── Phase 1: Load event ─────────────────────────────
    phase = "load"
    session.results.append(await tget(client, f"{pfx}/events/{event_key}/info", "event info", phase, **kw))
    session.results.append(await tget(client, f"{pfx}/events/{event_key}/teams", "teams", phase, **kw))
    session.results.append(await tget(client, f"{pfx}/events/{event_key}/fast-rankings", "rankings", phase, **kw))

    # Extract team numbers for later use
    try:
        resp = await client.get(f"{BASE}/api{pfx}/events/{event_key}/teams", headers=_headers())
        teams = resp.json() if resp.status_code == 200 and isinstance(resp.json(), list) else []
        session.teams_found = [t.get("team_number", 0) for t in teams[:10]]
    except Exception:
        session.teams_found = []

    # Small stagger to avoid perfect synchronization
    await asyncio.sleep(random.uniform(0.05, 0.2))

    # ── Phase 2: Match flow ─────────────────────────────
    phase = "matches"
    session.results.append(await tget(client, f"{pfx}/matches/{event_key}/scores", "scores", phase, **kw))
    session.results.append(await tget(client, f"{pfx}/matches/{event_key}/all", "all matches", phase, **kw))

    await asyncio.sleep(random.uniform(0.05, 0.15))

    # ── Phase 3: Summary tab ────────────────────────────
    phase = "summary"
    if is_ftc:
        session.results.append(await tget(client, f"/ftc/events/{event_key}/awards", "awards", phase, **kw))
        session.results.append(await tget(client, f"/ftc/events/{event_key}/past-awards", "past awards", phase, **kw))
        session.results.append(await tget(client, f"/ftc/events/{event_key}/season-awards", "season awards", phase, **kw))
    else:
        session.results.append(await tget(client, f"/events/{event_key}/summary", "summary", phase, **kw))
        session.results.append(await tget(client, f"/events/{event_key}/summary/awards", "awards", phase, **kw))
    session.results.append(await tget(client, f"{pfx}/events/{event_key}/summary/connections?all_time=false",
                                      "connections", phase, **kw))

    await asyncio.sleep(random.uniform(0.05, 0.15))

    # ── Phase 4: Team deep-dive ─────────────────────────
    phase = "team-dive"
    team_nums = session.teams_found[:2]
    for tn in team_nums:
        if is_ftc:
            session.results.append(await tget(client, f"/ftc/events/team/{tn}", f"FTC team {tn}", phase, **kw))
        else:
            session.results.append(await tget(client, f"/teams/{tn}/stats?year=2026", f"team {tn} stats", phase, **kw))

    # ── Phase 5: Notes (read + write) ───────────────────
    phase = "notes"
    if not is_ftc and team_nums:
        team_key = f"frc{team_nums[0]}"
        # Read existing notes
        session.results.append(await tget(client, f"/teams/{team_key}/notes", f"read notes {team_key}", phase, **kw))
        # Write a note
        note_body = {
            "event_key": event_key,
            "team_key": team_key,
            "author_device_id": TIMS_DEVICE_ID,
            "content": f"Benchmark note from {uid} at {event_key}",
            "category": "manual",
        }
        session.results.append(await tpost(client, "/teams/notes", note_body, f"write note {team_key}", phase, **kw))

    # ── Phase 6: GATool / Community updates ─────────────
    phase = "gatool"
    session.results.append(await tget(client, f"{pfx}/events/{event_key}/gatool-updates",
                                      "gatool updates", phase, **kw))

    # ── Phase 7: Warm-cache rapid re-fetch ──────────────
    phase = "warm-cache"
    warm_paths = [
        (f"{pfx}/events/{event_key}/info", "info (warm)"),
        (f"{pfx}/events/{event_key}/teams", "teams (warm)"),
        (f"{pfx}/events/{event_key}/fast-rankings", "rankings (warm)"),
        (f"{pfx}/matches/{event_key}/scores", "scores (warm)"),
    ]
    warm_tasks = [tget(client, p, lbl, phase, **kw) for p, lbl in warm_paths]
    session.results.extend(await asyncio.gather(*warm_tasks))

    return session


# ═══════════════════════════════════════════════════════════
#  TIMS PERSISTENCE TEST
# ═══════════════════════════════════════════════════════════

async def test_tims_persistence(client: httpx.AsyncClient) -> list[RequestResult]:
    """Test that TIMS edits from event A are visible when loading event B.

    Flow:
      1. Clean up any existing TIMS for test team
      2. PUT TIMS overrides (simulating caster at event A)
      3. Load event B's teams → verify test team has TIMS overrides
      4. Load event C's teams → verify same
      5. Clean up
    """
    results: list[RequestResult] = []
    phase = "tims-persistence"
    kw = dict(phase=phase, user_id="tims-tester", event_key="multi")

    print("\n  TIMS Persistence Test")
    print("  " + "─" * 50)

    # 1. Cleanup
    r = await tdelete(client, f"/teams/{TIMS_TEST_TEAM}/tims-overrides", "cleanup TIMS", **kw)
    results.append(r)

    # 2. Write TIMS at "event A"
    tims_payload = {
        "author_device_id": TIMS_DEVICE_ID,
        "author_name": "Benchmark Caster",
        "author_event_key": FRC_EVENTS[0],
        "custom_nickname": "BenchBot",
        "custom_sponsor_read": "Sponsored by BenchCorp and TestInc",
        "custom_robot_name": "The Benchinator",
        "custom_motto": "Test fast, break things",
        "custom_top_sponsors": "BenchCorp, TestInc",
    }
    r = await tput(client, f"/teams/{TIMS_TEST_TEAM}/tims-overrides", tims_payload,
                   f"PUT TIMS @ {FRC_EVENTS[0]}", **kw)
    results.append(r)
    write_ok = r.ok
    print(f"    {'✓' if write_ok else '✗'} Write TIMS override at {FRC_EVENTS[0]}: {r.elapsed_ms:.0f}ms")

    if not write_ok:
        print(f"      ⚠ TIMS write failed: {r.detail}")
        return results

    # 3. Verify TIMS persists across different events
    events_to_check = FRC_EVENTS[1:3]  # Check 2 other events
    team_num = int(TIMS_TEST_TEAM.replace("frc", ""))

    for check_event in events_to_check:
        # Load teams for the other event
        r = await tget(client, f"/events/{check_event}/teams", f"load teams @ {check_event}", **kw)
        results.append(r)

        if r.ok:
            try:
                resp = await client.get(f"{BASE}/api/events/{check_event}/teams", headers=_headers())
                teams_data = resp.json() if resp.status_code == 200 else []
                target = next((t for t in teams_data if t.get("team_number") == team_num), None)

                if target is None:
                    # Team might not be at this event — check TIMS directly
                    r2 = await tget(client, f"/teams/{TIMS_TEST_TEAM}/tims-overrides",
                                    f"GET TIMS (direct) after {check_event}", **kw)
                    results.append(r2)
                    try:
                        direct_resp = await client.get(f"{BASE}/api/teams/{TIMS_TEST_TEAM}/tims-overrides", headers=_headers())
                        direct_data = direct_resp.json() if direct_resp.status_code == 200 else {}
                        has_override = direct_data.get("custom_nickname") == "BenchBot"
                        print(f"    {'✓' if has_override else '✗'} TIMS persists (direct check, team not at {check_event}): {r2.elapsed_ms:.0f}ms")
                    except Exception as e:
                        print(f"    ✗ TIMS direct check failed: {e}")
                else:
                    has_tims = target.get("has_tims_overrides", False)
                    nick_ok = target.get("nickname") == "BenchBot"
                    ok = has_tims and nick_ok
                    print(f"    {'✓' if ok else '✗'} TIMS visible @ {check_event}: "
                          f"has_tims={has_tims}, nickname={'BenchBot' if nick_ok else target.get('nickname', '?')}")
            except Exception as e:
                print(f"    ✗ Verification failed for {check_event}: {e}")

    # 4. Verify TIMS history was logged
    r = await tget(client, f"/teams/{TIMS_TEST_TEAM}/tims-overrides/history", "TIMS history", **kw)
    results.append(r)
    if r.ok:
        try:
            hist_resp = await client.get(f"{BASE}/api/teams/{TIMS_TEST_TEAM}/tims-overrides/history", headers=_headers())
            history = hist_resp.json() if hist_resp.status_code == 200 else []
            has_history = len(history) > 0 if isinstance(history, list) else False
            print(f"    {'✓' if has_history else '✗'} TIMS history logged: {len(history) if isinstance(history, list) else '?'} entries")
        except Exception:
            pass

    # 5. Cleanup
    r = await tdelete(client, f"/teams/{TIMS_TEST_TEAM}/tims-overrides", "cleanup TIMS (final)", **kw)
    results.append(r)
    print(f"    {'✓' if r.ok else '✗'} Cleanup: {r.elapsed_ms:.0f}ms")

    return results


# ═══════════════════════════════════════════════════════════
#  ORCHESTRATOR
# ═══════════════════════════════════════════════════════════

async def validate_events(client: httpx.AsyncClient) -> tuple[list[str], list[str]]:
    """Probe events and return lists of working FRC/FTC event keys."""
    valid_frc, valid_ftc = [], []

    print("  Probing events...")
    for ek in FRC_EVENTS + FRC_FALLBACK:
        if ek in valid_frc:
            continue  # skip duplicates
        try:
            r = await client.get(f"{BASE}/api/events/{ek}/info", timeout=15, headers=_headers())
            if r.status_code == 200:
                valid_frc.append(ek)
                if len(valid_frc) >= 4:
                    break
        except Exception:
            pass

    for ek in FTC_EVENTS + FTC_FALLBACK:
        if ek in valid_ftc:
            continue  # skip duplicates
        try:
            r = await client.get(f"{BASE}/api/ftc/events/{ek}/info", timeout=15, headers=_headers())
            if r.status_code == 200:
                valid_ftc.append(ek)
                if len(valid_ftc) >= 4:
                    break
        except Exception:
            pass

    print(f"    FRC events: {valid_frc}")
    print(f"    FTC events: {valid_ftc}")
    return valid_frc, valid_ftc


async def run_full_benchmark(base_url: str):
    global BASE
    BASE = base_url

    print(f"\n{'═' * 70}")
    print(f"  PRODUCTION DAY BENCHMARK — 8 Events × 2 Casters = 16 Users")
    print(f"{'═' * 70}")
    print(f"  Server: {BASE}")
    print(f"  Date:   {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    async with httpx.AsyncClient(timeout=90.0) as client:
        # ── Health check ────────────────────────────────
        try:
            r = await client.get(f"{BASE}/api/health")
            if r.status_code != 200:
                print("  ❌ Server not healthy")
                sys.exit(1)
        except Exception:
            print("  ❌ Cannot reach server")
            sys.exit(1)

        # ── Validate events ─────────────────────────────
        frc_events, ftc_events = await validate_events(client)
        total_events = len(frc_events) + len(ftc_events)
        if total_events == 0:
            print("  ❌ No valid events found")
            sys.exit(1)

        total_users = total_events * 2
        print(f"\n  Running: {len(frc_events)} FRC + {len(ftc_events)} FTC events = {total_events} events, {total_users} users\n")

        # ── Phase A: All casters connect simultaneously ──
        bench_start = time.perf_counter()

        print(f"{'─' * 70}")
        print("  Phase A: Simultaneous Event Load (all users connect at once)")
        print(f"{'─' * 70}")

        caster_tasks = []
        caster_idx = 0
        for ek in frc_events:
            for i in range(2):
                caster_tasks.append(run_caster_session(client, ek, "frc", caster_idx))
                caster_idx += 1
        for ek in ftc_events:
            for i in range(2):
                caster_tasks.append(run_caster_session(client, ek, "ftc", caster_idx))
                caster_idx += 1

        sessions: list[UserSession] = await asyncio.gather(*caster_tasks)

        bench_elapsed = (time.perf_counter() - bench_start) * 1000

        # ── Phase B: TIMS persistence test ──────────────
        print(f"\n{'─' * 70}")
        print("  Phase B: TIMS Persistence Test")
        print(f"{'─' * 70}")
        tims_results = await test_tims_persistence(client)

        # ── Phase C: Cross-event cache test ─────────────
        print(f"\n{'─' * 70}")
        print("  Phase C: Cross-Event Cache (switch events rapidly)")
        print(f"{'─' * 70}")
        cross_results: list[RequestResult] = []
        all_events = frc_events + ftc_events
        if len(all_events) >= 2:
            for i in range(min(4, len(all_events))):
                ek = all_events[i]
                pfx = "/ftc" if ek in ftc_events else ""
                paths = [
                    (f"{pfx}/events/{ek}/info", f"info@{ek}"),
                    (f"{pfx}/events/{ek}/teams", f"teams@{ek}"),
                    (f"{pfx}/events/{ek}/fast-rankings", f"rank@{ek}"),
                ]
                tasks = [tget(client, p, lbl, "cross-cache", "switcher", ek) for p, lbl in paths]
                cross_results.extend(await asyncio.gather(*tasks))

        cross_ok = sum(1 for r in cross_results if r.ok)
        cross_times = [r.elapsed_ms for r in cross_results if r.ok]
        if cross_times:
            print(f"    {cross_ok}/{len(cross_results)} ok — "
                  f"mean {statistics.mean(cross_times):.0f}ms, "
                  f"p95 {sorted(cross_times)[int(len(cross_times) * 0.95)]:.0f}ms, "
                  f"max {max(cross_times):.0f}ms")

        # ═══════════════════════════════════════════════════
        #  RESULTS
        # ═══════════════════════════════════════════════════
        print(f"\n{'═' * 70}")
        print("  RESULTS")
        print(f"{'═' * 70}\n")

        # Aggregate all results
        all_results: list[RequestResult] = []
        for s in sessions:
            all_results.extend(s.results)
        all_results.extend(tims_results)
        all_results.extend(cross_results)

        total = len(all_results)
        ok = sum(1 for r in all_results if r.ok)
        fail = total - ok
        times = [r.elapsed_ms for r in all_results if r.ok]

        print(f"  Total requests    : {total}")
        print(f"  Successful        : {ok} ({ok/total*100:.1f}%)")
        print(f"  Failed            : {fail}")
        print(f"  Wall clock time   : {bench_elapsed:.0f} ms")
        print(f"  Throughput        : {ok / (bench_elapsed / 1000):.1f} req/s (during main phase)")

        if times:
            times_sorted = sorted(times)
            print(f"\n  Latency (successful requests):")
            print(f"    Mean            : {statistics.mean(times):.0f} ms")
            print(f"    Median (p50)    : {statistics.median(times):.0f} ms")
            print(f"    p90             : {times_sorted[int(len(times) * 0.90)]:.0f} ms")
            print(f"    p95             : {times_sorted[int(len(times) * 0.95)]:.0f} ms")
            print(f"    p99             : {times_sorted[min(int(len(times) * 0.99), len(times)-1)]:.0f} ms")
            print(f"    Min / Max       : {min(times):.0f} ms / {max(times):.0f} ms")

        # ── Per-phase breakdown ─────────────────────────
        print(f"\n  Per-Phase Breakdown:")
        phases = {}
        for r in all_results:
            p = r.phase or "unknown"
            if p not in phases:
                phases[p] = []
            phases[p].append(r)

        for phase_name in ["load", "matches", "summary", "team-dive", "notes", "gatool",
                           "warm-cache", "tims-persistence", "cross-cache"]:
            phase_results = phases.get(phase_name, [])
            if not phase_results:
                continue
            p_ok = sum(1 for r in phase_results if r.ok)
            p_times = [r.elapsed_ms for r in phase_results if r.ok]
            p_mean = statistics.mean(p_times) if p_times else 0
            p_p95 = sorted(p_times)[int(len(p_times) * 0.95)] if p_times else 0
            print(f"    {phase_name:<18s}: {p_ok:>3}/{len(phase_results):>3} ok  "
                  f"mean {p_mean:>6.0f}ms  p95 {p_p95:>6.0f}ms")

        # ── Per-user summary ────────────────────────────
        print(f"\n  Per-User Summary:")
        for s in sessions:
            s_times = [r.elapsed_ms for r in s.results if r.ok]
            s_mean = statistics.mean(s_times) if s_times else 0
            status = "✓" if s.fail_count == 0 else "⚠"
            print(f"    {status} {s.user_id:<22s} @ {s.event_key:<24s} "
                  f"{s.ok_count:>2}/{len(s.results):>2} ok  "
                  f"total {s.total_ms:>6.0f}ms  mean {s_mean:>5.0f}ms")

        # ── Cache effectiveness ─────────────────────────
        warm_results = [r for r in all_results if r.phase == "warm-cache" and r.ok]
        cold_results = [r for r in all_results if r.phase == "load" and r.ok]
        if warm_results and cold_results:
            cold_mean = statistics.mean([r.elapsed_ms for r in cold_results])
            warm_mean = statistics.mean([r.elapsed_ms for r in warm_results])
            if warm_mean > 0:
                print(f"\n  Cache Effectiveness:")
                print(f"    Cold load mean  : {cold_mean:.0f} ms")
                print(f"    Warm cache mean : {warm_mean:.0f} ms")
                print(f"    Speedup         : {cold_mean / warm_mean:.1f}x")

        # ── Errors ──────────────────────────────────────
        if fail > 0:
            print(f"\n  ⚠ FAILED REQUESTS ({fail}):")
            error_groups: dict[str, int] = {}
            for r in all_results:
                if not r.ok:
                    key = f"{r.label}: {r.detail}"
                    error_groups[key] = error_groups.get(key, 0) + 1
            for err, count in sorted(error_groups.items(), key=lambda x: -x[1]):
                print(f"    [{count}x] {err}")

        # ── Save results ────────────────────────────────
        output = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "server": BASE,
            "events": {"frc": frc_events, "ftc": ftc_events},
            "total_users": total_users,
            "total_requests": total,
            "successful": ok,
            "failed": fail,
            "wall_clock_ms": round(bench_elapsed),
            "throughput_rps": round(ok / (bench_elapsed / 1000), 1),
            "latency": {
                "mean_ms": round(statistics.mean(times)) if times else 0,
                "median_ms": round(statistics.median(times)) if times else 0,
                "p95_ms": round(sorted(times)[int(len(times) * 0.95)]) if times else 0,
                "p99_ms": round(sorted(times)[min(int(len(times) * 0.99), len(times)-1)]) if times else 0,
                "min_ms": round(min(times)) if times else 0,
                "max_ms": round(max(times)) if times else 0,
            },
            "phases": {},
            "users": [],
        }

        for phase_name, phase_results in phases.items():
            p_times = [r.elapsed_ms for r in phase_results if r.ok]
            output["phases"][phase_name] = {
                "total": len(phase_results),
                "ok": sum(1 for r in phase_results if r.ok),
                "mean_ms": round(statistics.mean(p_times)) if p_times else 0,
                "p95_ms": round(sorted(p_times)[int(len(p_times) * 0.95)]) if p_times else 0,
            }

        for s in sessions:
            s_times = [r.elapsed_ms for r in s.results if r.ok]
            output["users"].append({
                "user_id": s.user_id,
                "event": s.event_key,
                "program": s.program,
                "requests": len(s.results),
                "ok": s.ok_count,
                "failed": s.fail_count,
                "total_ms": round(s.total_ms),
                "mean_ms": round(statistics.mean(s_times)) if s_times else 0,
            })

        results_path = os.path.join(os.path.dirname(__file__), "benchmark_production_results.json")
        with open(results_path, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\n  Results saved to: {results_path}")

        # ── Final verdict ───────────────────────────────
        print(f"\n{'═' * 70}")
        error_rate = fail / total * 100 if total else 0
        if error_rate == 0 and times and statistics.mean(times) < 2000:
            print("  ✓ BENCHMARK PASSED — All requests successful, latency acceptable")
        elif error_rate < 5:
            print(f"  ⚠ BENCHMARK WARNING — {error_rate:.1f}% error rate")
        else:
            print(f"  ✗ BENCHMARK FAILED — {error_rate:.1f}% error rate")
        print(f"{'═' * 70}\n")


async def main():
    parser = argparse.ArgumentParser(description="Production day benchmark: 8 events, 16 casters")
    parser.add_argument("--base", default=os.environ.get("BENCH_BASE_URL", "http://127.0.0.1:8000"),
                        help="Server base URL")
    parser.add_argument("--api-key", default=os.environ.get("BENCH_API_KEY", ""),
                        help="Trusted API key (elevated rate limits)")
    args = parser.parse_args()
    global API_KEY
    if args.api_key:
        API_KEY = args.api_key
    await run_full_benchmark(args.base)


if __name__ == "__main__":
    asyncio.run(main())
