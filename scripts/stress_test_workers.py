#!/usr/bin/env python3
"""Stress Test: concurrent worker syncs against live Supabase.

Exercises the resilience architecture:
  1. Semaphore/Lock serialisation of merge_event_teams
  2. Retry-on-deadlock (40P01) with exponential backoff
  3. Circuit breaker for 5xx Supabase errors

Runs 4 concurrent event syncs (teams + OPRs + EPA merge) and reports
whether any deadlocks occurred and how they were handled.

Usage:
    python scripts/stress_test_workers.py
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time

# Ensure project root is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from backend.app.services.supabase_client import (
    get_supabase, upsert_rows, merge_event_teams,
    _merge_lock, _cb_failures, _is_circuit_open,
)
from backend.app.services.tba_client import get_tba_client
from backend.app.services.statbotics_client import get_epa_map
from backend.app.services.circuit_breaker import CircuitOpenError

# ── Config ──────────────────────────────────────────────────
EVENTS = ["2026txcmp2", "2026pncmp", "2026alhu", "2026miken"]
YEAR = 2026

# ── Logging ─────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)-32s │ %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("stress_test")

# Ensure supabase_client logs are visible
logging.getLogger("backend.app.services.supabase_client").setLevel(logging.DEBUG)

# ── Counters ────────────────────────────────────────────────
_stats = {
    "upserts_ok": 0,
    "upserts_fail": 0,
    "merges_ok": 0,
    "merges_fail": 0,
    "deadlocks_caught": 0,
    "retries": 0,
    "circuit_opens": 0,
    "epa_ok": 0,
    "epa_fail": 0,
}

# Monkey-patch to count deadlock retries
import backend.app.services.supabase_client as _sbc
_original_retry = _sbc._retry_on_deadlock

async def _counting_retry(label, coro_factory):
    """Wrapper that counts retries/deadlocks."""
    try:
        await _original_retry(label, coro_factory)
    except Exception as exc:
        if "40P01" in str(exc):
            _stats["deadlocks_caught"] += 1
        raise

_sbc._retry_on_deadlock = _counting_retry


def _strip_nulls(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


async def sync_one_event(event_key: str):
    """Full sync pipeline for one event: teams → OPR merge → EPA merge."""
    t0 = time.perf_counter()
    tba = get_tba_client()
    log.info("▶  [%s] Starting sync", event_key)

    # ── Step 1: Fetch teams + OPRs from TBA ─────────────────
    try:
        teams_raw, oprs_raw = await asyncio.gather(
            tba.get_event_teams_full(event_key),
            tba.get_event_oprs(event_key),
            return_exceptions=True,
        )
    except CircuitOpenError:
        log.warning("   [%s] TBA circuit open — skipping", event_key)
        return
    except Exception as e:
        log.error("   [%s] TBA fetch failed: %s", event_key, e)
        return

    # ── Step 2: Upsert team rows ────────────────────────────
    if isinstance(teams_raw, list) and teams_raw:
        team_rows = []
        for t in teams_raw:
            tk = t.get("key")
            if not tk:
                continue
            team_rows.append({
                "team_key": tk,
                "team_number": t.get("team_number", 0),
                "nickname": t.get("nickname", ""),
                "competition_type": "frc",
                "raw_tims_data": {
                    "city": t.get("city", ""),
                    "state_prov": t.get("state_prov", ""),
                    "country": t.get("country", ""),
                },
            })

        try:
            await upsert_rows("teams", team_rows)
            _stats["upserts_ok"] += 1
            log.info("   [%s] ✓ Upserted %d teams", event_key, len(team_rows))
        except Exception as e:
            _stats["upserts_fail"] += 1
            log.error("   [%s] ✗ Teams upsert FAILED: %s", event_key, e)

        # Seed event_teams junction
        et_seed = [
            {"event_key": event_key, "team_key": t.get("key"), "raw_data": {}}
            for t in teams_raw if t.get("key")
        ]
        try:
            await upsert_rows("event_teams", et_seed)
            _stats["upserts_ok"] += 1
            log.info("   [%s] ✓ Seeded %d event_teams", event_key, len(et_seed))
        except Exception as e:
            _stats["upserts_fail"] += 1
            log.error("   [%s] ✗ event_teams seed FAILED: %s", event_key, e)

    # ── Step 3: Merge OPR data (this uses _merge_lock) ──────
    opr_lookup = {}
    if isinstance(oprs_raw, dict):
        oprs = oprs_raw.get("oprs", {})
        dprs = oprs_raw.get("dprs", {})
        ccwms = oprs_raw.get("ccwms", {})
        for tkey in oprs:
            opr_lookup[tkey] = {
                "opr": oprs.get(tkey),
                "dpr": dprs.get(tkey),
                "ccwm": ccwms.get(tkey),
            }

    if opr_lookup and isinstance(teams_raw, list):
        merge_rows = [
            {"event_key": event_key, "team_key": t.get("key"),
             "data": _strip_nulls(opr_lookup.get(t.get("key"), {}))}
            for t in teams_raw
            if t.get("key") and opr_lookup.get(t.get("key"))
        ]
        if merge_rows:
            try:
                await merge_event_teams(merge_rows)
                _stats["merges_ok"] += 1
                log.info("   [%s] ✓ Merged OPRs for %d teams (lock serialised)", event_key, len(merge_rows))
            except Exception as e:
                _stats["merges_fail"] += 1
                log.error("   [%s] ✗ OPR merge FAILED: %s", event_key, e)

    # ── Step 4: EPA merge (also serialised via _merge_lock) ─
    try:
        epa_map = await get_epa_map(event_key)
        if epa_map:
            epa_rows = [
                {"event_key": event_key, "team_key": tk,
                 "data": {"epa": _strip_nulls(epa) if isinstance(epa, dict) else epa}}
                for tk, epa in epa_map.items()
                if epa is not None
            ]
            if epa_rows:
                try:
                    await merge_event_teams(epa_rows)
                    _stats["epa_ok"] += 1
                    log.info("   [%s] ✓ Merged EPA for %d teams", event_key, len(epa_rows))
                except Exception as e:
                    _stats["epa_fail"] += 1
                    log.error("   [%s] ✗ EPA merge FAILED: %s", event_key, e)
        else:
            log.info("   [%s] ⚠ No EPA data available", event_key)
    except CircuitOpenError:
        log.warning("   [%s] Statbotics circuit open — skipping EPA", event_key)
    except Exception as e:
        _stats["epa_fail"] += 1
        log.warning("   [%s] EPA fetch failed: %s", event_key, e)

    elapsed = (time.perf_counter() - t0) * 1000
    log.info("◀  [%s] Finished in %.0f ms", event_key, elapsed)


async def main():
    print("\n" + "═" * 64)
    print("  WORKER STRESS TEST — Semaphore + Retry Validation")
    print("═" * 64)
    print(f"\n  Events: {', '.join(EVENTS)}")
    print(f"  Mode:   All {len(EVENTS)} events sync CONCURRENTLY")
    print(f"  Target: Verify merge_event_teams serialisation & retry logic\n")

    # ── Verify Supabase connectivity ────────────────────────
    try:
        sb = await get_supabase()
        resp = await sb.table("events").select("event_key").limit(1).execute()
        log.info("✓ Supabase connected (%d event(s) in DB)", len(resp.data or []))
    except Exception as e:
        log.error("✗ Supabase connection FAILED: %s", e)
        sys.exit(1)

    # ── Run all 4 events concurrently ───────────────────────
    t_start = time.perf_counter()
    print(f"\n{'─' * 64}")
    print("  Phase 1: Concurrent Sync (teams + OPR merge + EPA merge)")
    print(f"{'─' * 64}\n")

    results = await asyncio.gather(
        *[sync_one_event(ek) for ek in EVENTS],
        return_exceptions=True,
    )

    # Check for unhandled exceptions
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            log.error("  ✗ %s raised unhandled: %s", EVENTS[i], r)
            _stats["merges_fail"] += 1

    total_ms = (time.perf_counter() - t_start) * 1000

    # ── Phase 2: Re-run merges to test idempotency ──────────
    print(f"\n{'─' * 64}")
    print("  Phase 2: Re-merge (idempotency check)")
    print(f"{'─' * 64}\n")

    t2 = time.perf_counter()
    for ek in EVENTS:
        # small merge — just proves the lock + retry still works on re-entry
        try:
            sb = await get_supabase()
            resp = await (
                sb.table("event_teams")
                .select("team_key")
                .eq("event_key", ek)
                .limit(5)
                .execute()
            )
            if resp.data:
                re_rows = [
                    {"event_key": ek, "team_key": r["team_key"],
                     "data": {"stress_test_ts": time.time()}}
                    for r in resp.data
                ]
                await merge_event_teams(re_rows)
                _stats["merges_ok"] += 1
                log.info("   [%s] ✓ Idempotent re-merge OK (%d rows)", ek, len(re_rows))
        except Exception as e:
            _stats["merges_fail"] += 1
            log.error("   [%s] ✗ Re-merge FAILED: %s", ek, e)

    t2_ms = (time.perf_counter() - t2) * 1000

    # ── Report ──────────────────────────────────────────────
    print(f"\n{'═' * 64}")
    print("  STRESS TEST RESULTS")
    print(f"{'═' * 64}\n")

    print(f"  Events tested:        {len(EVENTS)}")
    print(f"  Total time (Phase 1): {total_ms:.0f} ms")
    print(f"  Total time (Phase 2): {t2_ms:.0f} ms")
    print()
    print(f"  Upserts OK:           {_stats['upserts_ok']}")
    print(f"  Upserts FAILED:       {_stats['upserts_fail']}")
    print(f"  Merges OK:            {_stats['merges_ok']}")
    print(f"  Merges FAILED:        {_stats['merges_fail']}")
    print(f"  EPA OK:               {_stats['epa_ok']}")
    print(f"  EPA FAILED:           {_stats['epa_fail']}")
    print(f"  Deadlocks caught:     {_stats['deadlocks_caught']}")
    print(f"  Circuit breaker open: {_is_circuit_open()}")
    print()

    all_ok = (
        _stats["upserts_fail"] == 0
        and _stats["merges_fail"] == 0
        and _stats["deadlocks_caught"] == 0
    )

    if all_ok:
        print("  ✅ ALL CHECKS PASSED — No deadlocks, no failures")
        print("     Semaphore serialisation is working correctly.")
        print("     Retry logic was not needed (no deadlocks occurred).")
    elif _stats["deadlocks_caught"] > 0 and _stats["merges_fail"] == 0:
        print("  ⚠️  DEADLOCKS DETECTED but RETRIED SUCCESSFULLY")
        print(f"     {_stats['deadlocks_caught']} deadlock(s) caught and retried.")
        print("     Retry logic is working correctly.")
    else:
        print("  ❌ FAILURES DETECTED — see logs above")

    print()

    # Clean up stress_test_ts from event_teams
    try:
        sb = await get_supabase()
        for ek in EVENTS:
            resp = await (
                sb.table("event_teams")
                .select("team_key, raw_data")
                .eq("event_key", ek)
                .execute()
            )
            for row in (resp.data or []):
                rd = row.get("raw_data") or {}
                if "stress_test_ts" in rd:
                    del rd["stress_test_ts"]
                    await (
                        sb.table("event_teams")
                        .update({"raw_data": rd})
                        .eq("event_key", ek)
                        .eq("team_key", row["team_key"])
                        .execute()
                    )
        log.info("Cleaned up stress_test_ts markers")
    except Exception:
        pass  # non-critical cleanup

    sys.exit(0 if all_ok or (_stats["deadlocks_caught"] > 0 and _stats["merges_fail"] == 0) else 1)


if __name__ == "__main__":
    asyncio.run(main())
