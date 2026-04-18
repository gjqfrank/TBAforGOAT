#!/usr/bin/env python3
"""Simulate Statbotics API call patterns with 6 concurrent active events.

Run with:  python scripts/simulate_statbotics_load.py

Shows the burst call rate that causes rate-limit failures and circuit-breaker
trips during championship season.
"""
from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field

# ── Simulation constants ─────────────────────────────────────
NUM_EVENTS      = 6
SYNC_INTERVAL   = 120    # seconds between event_sync sweeps
CACHE_TTL       = 300    # statbotics_client.py CACHE_TTL
SEASON_CACHE    = 600    # router-level season-high-scores cache
FRONTEND_POLL   = 30     # frontend polls /{event_key}/all every 30s
SIM_DURATION    = 360    # simulate 6 minutes of operation
STATBOTICS_RATE_LIMIT = 10  # assumed: requests per 10-second window

EVENTS = [f"2026event{i}" for i in range(NUM_EVENTS)]

# ── Fake latency model ───────────────────────────────────────
CALL_LATENCY = 0.05  # 50 ms simulated (speeds up sim; real ~300-800 ms)


@dataclass
class CallRecord:
    t: float
    endpoint: str
    caller: str
    cache_hit: bool = False


@dataclass
class SimState:
    calls: list[CallRecord] = field(default_factory=list)
    cache: dict[str, float] = field(default_factory=dict)   # endpoint → expires_at
    rate_429s: int = 0
    breaker_trips: int = 0
    _rate_window: list[float] = field(default_factory=list)  # call timestamps in 10s

    def record(self, endpoint: str, caller: str, t: float) -> bool:
        """Record a call. Returns True if rate-limited (would 429)."""
        # Evict old rate-window entries
        cutoff = t - 10
        self._rate_window = [x for x in self._rate_window if x > cutoff]

        if len(self._rate_window) >= STATBOTICS_RATE_LIMIT:
            self.rate_429s += 1
            self.calls.append(CallRecord(t, endpoint, caller, cache_hit=False))
            return True  # rate limited

        self._rate_window.append(t)
        self.calls.append(CallRecord(t, endpoint, caller))
        return False

    def is_cached(self, endpoint: str, t: float) -> bool:
        expires = self.cache.get(endpoint, 0)
        return t < expires

    def set_cache(self, endpoint: str, t: float) -> None:
        self.cache[endpoint] = t + CACHE_TTL


state = SimState()


# ── Simulated StatboticsClient.get() — current behaviour ────
async def sim_statbotics_get(endpoint: str, caller: str, sim_t: float) -> bool:
    """Simulate a Statbotics API call: cache check → HTTP → record.
    Returns True on cache hit, False on HTTP call."""
    if state.is_cached(endpoint, sim_t):
        return True  # cache hit — no outbound request

    await asyncio.sleep(CALL_LATENCY)  # network
    rate_limited = state.record(endpoint, caller, sim_t)
    if not rate_limited:
        state.set_cache(endpoint, sim_t)
    return False


# ── Background: event_sync EPA loop (current — no inter-event delay) ────
async def background_epa_sync(sim_start: float) -> None:
    """Mirrors event_sync.py: serialized EPA calls with no stagger."""
    while True:
        sim_t = time.monotonic() - sim_start
        if sim_t > SIM_DURATION:
            break
        for ek in EVENTS:
            await sim_statbotics_get(f"/team_events?event={ek}", "bg_epa_sync", sim_t)
        await asyncio.sleep(SYNC_INTERVAL * CALL_LATENCY / 1.0)  # scaled-down interval


# ── Background: season high scores (router cache, bypasses client cache) ─
async def background_season_scores(sim_start: float) -> None:
    """Mirrors get_season_high_scores: 3 raw calls every 600s, bypass client cache."""
    while True:
        sim_t = time.monotonic() - sim_start
        if sim_t > SIM_DURATION:
            break
        # Current code calls _raw() not self.get() — no client-side cache
        year = 2026
        for ep in [
            f"/matches?year={year}&metric=red_score&ascending=false&limit=10",
            f"/matches?year={year}&metric=blue_score&ascending=false&limit=10",
            f"/team_years?year={year}&metric=epa&ascending=false&limit=50",
        ]:
            await asyncio.sleep(CALL_LATENCY * 0.1)  # parallel gather in real code
            state.record(ep, "season_scores_raw", sim_t)
            # Note: _raw() does NOT update state.cache, so it always fires
        await asyncio.sleep(SEASON_CACHE * CALL_LATENCY / 5.0)  # scaled


# ── On-demand: frontend polling each event's /all endpoint ───────────────
async def frontend_poller(event_key: str, sim_start: float) -> None:
    """Mirrors GET /{event_key}/all — calls epa_map + match_predictions."""
    while True:
        sim_t = time.monotonic() - sim_start
        if sim_t > SIM_DURATION:
            break
        await sim_statbotics_get(f"/team_events?event={event_key}", f"frontend/{event_key}", sim_t)
        await sim_statbotics_get(f"/matches?event={event_key}&limit=500", f"frontend/{event_key}", sim_t)
        await asyncio.sleep(FRONTEND_POLL * CALL_LATENCY / 5.0)  # scaled


# ── Analysis helpers ─────────────────────────────────────────
def print_call_timeline(calls: list[CallRecord], window: float = 10.0) -> None:
    if not calls:
        return
    start = calls[0].t
    end = calls[-1].t
    print(f"\n{'─'*65}")
    print(f"  CALL TIMELINE  (window={window:.0f}s equiv, sim scaled)")
    print(f"{'─'*65}")
    print(f"  {'Time':>6}  {'Calls in window':>16}  {'Rate-limited':>12}")
    print(f"{'─'*65}")

    t = start
    while t <= end:
        window_calls = [c for c in calls if t <= c.t < t + window and not c.cache_hit]
        rl = [c for c in window_calls if "season_scores_raw" in c.caller or c.t in [
            x.t for x in calls if x.cache_hit is False]]
        actual_http = [c for c in window_calls if not c.cache_hit]
        print(f"  {t-start:>5.1f}s  {len(actual_http):>16}  {'YES' if len(actual_http) >= STATBOTICS_RATE_LIMIT else '':>12}")
        t += window

    print()


def analyse(calls: list[CallRecord]) -> None:
    http_calls = [c for c in calls if not c.cache_hit]
    print(f"\n{'='*65}")
    print(f"  STATBOTICS LOAD SIMULATION — {NUM_EVENTS} active events")
    print(f"{'='*65}")
    print(f"  Total API calls recorded : {len(calls)}")
    print(f"  Cache hits               : {sum(1 for c in calls if c.cache_hit)}")
    print(f"  Actual HTTP calls        : {len(http_calls)}")
    print(f"  Rate-limit 429s (est.)   : {state.rate_429s}")

    # Find max burst (10s window)
    if http_calls:
        max_burst = 0
        for c in http_calls:
            w = [x for x in http_calls if c.t <= x.t < c.t + 10]
            max_burst = max(max_burst, len(w))
        print(f"  Max calls in 10s window  : {max_burst}  "
              f"({'EXCEEDS' if max_burst > STATBOTICS_RATE_LIMIT else 'within'} "
              f"limit of {STATBOTICS_RATE_LIMIT})")

    # Callers breakdown
    by_caller: dict[str, int] = defaultdict(int)
    for c in http_calls:
        by_caller[c.caller] += 1
    print(f"\n  HTTP calls by source:")
    for src, n in sorted(by_caller.items(), key=lambda x: -x[1]):
        print(f"    {src:<42} {n:>4}")

    print()


async def run_simulation() -> None:
    sim_start = time.monotonic()

    tasks = [
        asyncio.create_task(background_epa_sync(sim_start)),
        asyncio.create_task(background_season_scores(sim_start)),
        *[asyncio.create_task(frontend_poller(ek, sim_start)) for ek in EVENTS],
    ]

    await asyncio.sleep(SIM_DURATION * CALL_LATENCY)
    for t in tasks:
        t.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

    analyse(state.calls)

    # Show burst windows
    http_calls = [c for c in state.calls if not c.cache_hit]
    print("  BURST ANALYSIS — HTTP calls per 10s equivalent window:")
    print(f"  {'Window start':>12}  {'Calls':>6}  Status")
    if http_calls:
        for c in sorted(http_calls, key=lambda x: x.t):
            ws = c.t
            w = [x for x in http_calls if ws <= x.t < ws + 10]
            if len(w) >= STATBOTICS_RATE_LIMIT:
                sources = set(x.caller for x in w)
                print(f"  {ws:>10.2f}s  {len(w):>6}  BURST from: {', '.join(sorted(sources))}")
    print()

    print("  DIAGNOSIS:")
    print("  ─" * 32)
    print("  1. EPA sync loop fires 6 calls with NO inter-event delay")
    print("     → 6 requests in ~3s every 120s (background burst)")
    print()
    print("  2. Frontend polling 6 events × 2 calls = 12 uncached requests")
    print("     when 5-min TTL expires simultaneously (thundering herd)")
    print()
    print("  3. get_season_high_scores() uses _raw() instead of self.get()")
    print("     → 3 calls bypass client TTL cache, always hit HTTP")
    print()
    print("  4. No concurrency cap — all callers hit Statbotics simultaneously")
    print()
    print("  FIXES NEEDED:")
    print("  ─" * 32)
    print("  A. event_sync.py: add ~5s stagger between per-event EPA calls")
    print("  B. statbotics_client.py: asyncio.Semaphore(2) + 0.5s min interval")
    print("  C. statbotics_client.py: request coalescing for in-flight duplicates")
    print("  D. statbotics_client.py: _raw() in get_season_high_scores → self.get()")
    print()


if __name__ == "__main__":
    asyncio.run(run_simulation())
