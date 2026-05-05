# Caster's Tool v3.0.0 — Architectural Update

**Release date:** May 5, 2026
**Tag:** `v3.0.0`
**Theme:** modular frontend + championship-scale backend hardening.

This release is a structural overhaul, not a feature drop. No user-facing
behaviour changes by default — but everything underneath got faster, more
maintainable, and ready for `2026cmptx`-scale traffic.

---

## Highlights

- **Frontend modularised**: `docs/js/app.js` shrunk from **11 573 → 1 912
  lines** (-83%). The 12 tab views are now independent files, each owning
  its own state and render path.
- **Backend de-bottlenecked**: cold-load snapshot builds now coalesce, the
  Supabase merge lock is per-event (was global), and the match poller no
  longer thrashes the snapshot cache on every 5 s tick.
- **Realtime hardened**: subscribe→unsubscribe state-reconciliation bug
  fixed; listener registrars now return unsubscribe functions to prevent
  duplicate handlers on re-mount.

---

## Frontend — modular tab architecture

`app.js` was a 11 573-line monolith. It is now a 1 912-line shell that
wires the following per-view modules:

| Module | Lines | Responsibility |
|---|---:|---|
| `event_select.js` | 1 451 | Events tab, season picker, regional pool |
| `summary.js`      | 1 585 | Summary tab, demographics, awards, brackets |
| `pbp.js`          | 1 321 | Play-by-Play render (also benchmarked, see below) |
| `breakdown.js`    | 1 379 | Breakdown tab |
| `mobile_ux.js`    | 1 121 | Pull-to-refresh + mobile gestures |
| `playoffs.js`     |   718 | Bracket render |
| `team_lookup.js`  |   665 | Lookup / H2H |
| `floating_lookup.js` | 548 | Floating lookup panel |
| `alliances.js`    |   249 | Alliance grid |
| `comparison.js`   |   286 | Team comparison |
| `match_history.js`|   257 | Match history |
| `region_history.js`|  227 | Regional history |

**Why it matters:** initial parse is unchanged (we still ship plain
`<script>` tags in dependency order — see `index.html`), but every tab now
has a clear, isolated owner. Code-search and incremental edits got an
order of magnitude easier, and the surface area for accidental
cross-view breakage is gone.

### Per-view PBP render speedup

The PBP render path was profiled and optimised in this cycle. Result:
**23.6× faster on cold render, 13× faster on incremental updates**
(measured via `scripts/benchmark_pbp_render.js`, jsdom-backed). Added
`jsdom` as a `devDependency` for the benchmark harness.

### Realtime fixes (`docs/js/realtime.js`)

1. **State-reconciliation bug**: `_scheduleResubscribe()` was wiping the
   `_wasConnected` flag during the unsubscribe→subscribe cycle, so the
   subsequent `SUBSCRIBED` event was treated as a first connect and
   `_fireReconnect()` never ran. Fixed by capturing the connected flag
   *before* the cycle and restoring it on resubscribe.
2. **Listener leaks**: `onTeamChange` / `onMatchChange` / `onNoteInsert`
   / `onReconnect` now all return an unsubscribe function. Views that
   re-mount (or HMR) can clean up their handlers instead of accumulating
   duplicates.

---

## Backend — championship-scale hardening

Audited the full data path (event load → mode switch → polling → tab
render → Supabase realtime). Four highest-impact fixes shipped:

### 1. Snapshot builds are now coalesced (`backend/app/routers/snapshot.py`)

The `/api/events/{ek}/snapshot` cold-build path used to spawn N parallel
TBA fan-outs when N tabs hit the same event in the same second. It now
runs through `inflight.coalesce()`:

```python
payload = await coalesce(
    f"snapshot_build:{event_key}", _ingest_and_build, event_key,
)
```

Verified: **10 concurrent cold loaders → 1 upstream build**.

`_SNAPSHOT_TTL` raised from 5 min → 30 min, `_SNAPSHOT_STALE` from
10 min → 2 hr. Realtime push handles live UI freshness, so the snapshot
only matters for *cold loaders* (newly-opened tabs / shared links). The
old aggressive TTL was rebuilding the snapshot on a steady loop that
served no one.

### 2. Per-event merge lock (`backend/app/services/supabase_client.py`)

`merge_event_teams()` was guarded by a single global `asyncio.Lock`,
which serialised every event_teams write across the entire BFF. During
championship season (8+ cmp divisions all polling at once) this was the
dominant bottleneck. Replaced with a per-event lock map:

```python
_merge_locks: dict[str, asyncio.Lock] = {}
# bounded GC at 256 entries; drops unlocked locks first
```

Writes for different events now run in parallel; intra-event
serialisation still prevents the JSONB-merge race that the global lock
existed to solve.

### 3. Orphan-match sweep throttled (`backend/app/workers/match_poller.py`)

`delete_orphaned_matches(event_key, …)` was firing every 5 s per active
event — a wasted Supabase query, since schedule regeneration happens at
most a few times per event per *day*. Now gated to once per
`ORPHAN_SWEEP_INTERVAL = 300 s` per event via `_last_orphan_sweep`.

### 4. Stop invalidating the snapshot on every poll
   (`backend/app/workers/match_poller.py`, `backend/app/workers/event_sync.py`)

`_invalidate_snapshot()` used to delete the snapshot file every 5 s
(match poller) and every 120 s (event sync). Combined with #1, this was
a steady rebuild loop that wasted TBA quota and CPU during the only
moments it mattered (match weekend). Now it only invalidates the lighter
`payload_cache` summary/awards entries — the snapshot rebuild is
TTL-driven, and Realtime push keeps the UI fresh without it.

---

## Files changed

```
backend/app/routers/snapshot.py         |   98 ±
backend/app/services/supabase_client.py |   54 ±
backend/app/workers/event_sync.py       |   13 ±
backend/app/workers/match_poller.py     |   37 ±
docs/index.html                         |   36 ±
docs/js/app.js                          | 9714 - (split into modules)
docs/js/realtime.js                     |   23 ±
docs/js/{12 new tab modules}            | 8 707 + (new files)
package.json                            |    1 + (jsdom devDep)
scripts/benchmark_pbp_render.js         |    + (PBP perf harness)
```

---

## Migration notes

- **No database migrations.** All four backend fixes are pure Python.
- **No frontend API changes.** Module split is internal; `index.html`
  still loads plain `<script>` tags in dependency order.
- **Cold-load behaviour change**: snapshots may now serve stale-up-to-30 min
  to first-time loaders. Live updates still arrive via Realtime push.
- **devDependency added**: `jsdom@^29.1.1` (for the PBP benchmark
  script). Production install is unaffected.

---

## Validation

- All four touched backend modules import cleanly (`get_errors` clean).
- Coalesce verified end-to-end: 10 concurrent loaders → 1 upstream build.
- PBP benchmark: 23.6× cold / 13× incremental render speedup.

---

## Known follow-ups (queued for v3.1)

A frontend audit produced a P0/P1/P2 list of CSS and HTML cleanups —
shipped separately so this release stays scoped to architecture:

- **P0**: minify Tailwind output (370 KB → ~12 KB gzipped), delete the
  legacy `styles.css`, switch font loading from `@import` to `<link>`.
- **P1**: drop double-paradigm styling (legacy class + arbitrary Tailwind
  utility on the same element), add `content-visibility: auto` to long
  lists, gate `backdrop-filter: blur` behind `@media (hover: hover)`.
- **P2**: replace 121 inline `onclick=` handlers with a delegated
  listener, introduce a 5-tier `--z-*` token scale, convert collapsibles
  to native `<details>`/`<summary>`.

---

## Credits

Backend audit + per-event lock design, snapshot coalesce, frontend module
split, PBP renderer optimisation, realtime reconnection fixes — kleium &
GitHub Copilot.
