# Caster's Tool — iOS Native: AI Handoff Document

## 1. Project Overview

**Caster's Tool** is a live broadcast dashboard for FIRST Robotics competitions (FRC and FTC). It gives event commentators real-time access to team rankings, play-by-play match scores, score breakdowns, team history/connections, caster notes, and alliance selection data — all during a live event.

The production web app is a vanilla JS single-page application at `docs/index.html`. We are building a **native iOS companion** that mirrors its core functionality using SwiftUI and SwiftData, targeting iPad as the primary form factor (broadcast tables) with iPhone support.

**Repository:** `kleium/casters-tool` — branch `v2-offline-architecture`

---

## 2. The Backend Reality

The iOS app is a **pure consumer**. All data ingestion is handled by a Python/FastAPI backend running 4 background workers:

| Worker | Interval | Job |
|--------|----------|-----|
| `event_sync` | 120s | Discovers ongoing events, seeds teams/OPR/EPA into Supabase |
| `match_poller` | 5s | Polls FRC Events API for live match scores + rankings |
| `ftc_event_sync` | 120s | Same as above for FTC events |
| `ftc_match_poller` | 5s | Same as above for FTC matches |

These workers write to a **Supabase Pro** PostgreSQL instance. The web frontend and the iOS app both consume this data in two ways:

1. **REST reads** — The FastAPI backend acts as a BFF (Backend-For-Frontend), exposing enriched endpoints like `/api/events/{event_key}/teams`, `/api/matches/{event_key}/all`, `/api/events/{event_key}/summary/connections`, etc.
2. **Supabase Realtime** — WebSocket subscriptions on `event_teams`, `matches`, and `caster_notes` tables, filtered by `event_key`. Changes are pushed to the client within seconds of a worker upsert.

The iOS app's responsibilities are:
- Consume team/match/note data from the BFF API and Realtime channels
- Cache everything locally in SwiftData for offline resilience
- Queue caster note writes locally when offline, push to Supabase when connectivity returns
- **Never** talk to TBA, FRC Events API, or FTC Scout directly — those are backend-only

### Supabase Coordinates (configure at build time)

```
SUPABASE_URL=https://qytovurlcjrpvlbmkyip.supabase.co
SUPABASE_ANON_KEY=(stored in .env, not committed)
```

Use `supabase-swift` SDK (v2+) for Realtime and direct PostgREST writes (notes only).

---

## 3. Database Schema

These are the exact Supabase table definitions the app interacts with.

### `event_teams` (composite PK: event_key + team_key)

| Column | Type | Constraints |
|--------|------|-------------|
| `event_key` | `TEXT` | NOT NULL, FK → events, part of PK |
| `team_key` | `TEXT` | NOT NULL, FK → teams, part of PK |
| `raw_data` | `JSONB` | NOT NULL, DEFAULT `'{}'` — contains rank, wins, losses, ties, OPR, EPA, team metadata |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()`, auto-updated by trigger |

**Realtime:** REPLICA IDENTITY FULL — every UPDATE broadcasts the complete row.

The `raw_data` JSONB is the primary payload. It contains fields merged by the backend workers over time:

```json
{
  "team_number": 254,
  "nickname": "The Cheesy Poofs",
  "rank": 1,
  "wins": 10, "losses": 2, "ties": 0,
  "matches_played": 12,
  "sort_orders": [2.5, 450],
  "opr_total_points": 85.3,
  "opr_auto_points": 32.1,
  "epa_total": 78.5,
  "epa_recent": 82.0,
  "country": "USA",
  "state_prov": "CA",
  "city": "San Jose",
  "rookie_year": 1999,
  "avatar_base64": "data:image/png;base64,..."
}
```

### `matches` (PK: match_key)

| Column | Type | Constraints |
|--------|------|-------------|
| `match_key` | `TEXT` | PRIMARY KEY — e.g. `2026tuak_qm15` |
| `event_key` | `TEXT` | NOT NULL, FK → events, indexed |
| `comp_level` | `TEXT` | NOT NULL, DEFAULT `'qm'` — values: `qm`, `sf`, `f` |
| `match_number` | `INTEGER` | NOT NULL, DEFAULT `0` |
| `set_number` | `INTEGER` | NOT NULL, DEFAULT `1` |
| `status` | `TEXT` | NOT NULL, DEFAULT `'upcoming'` — values: `upcoming`, `in_progress`, `completed` |
| `alliances` | `JSONB` | NOT NULL, DEFAULT `'{}'` |
| `score_breakdown` | `JSONB` | NOT NULL, DEFAULT `'{}'` — game-year-specific scoring detail |
| `scheduled_time` | `TIMESTAMPTZ` | nullable |
| `raw_data` | `JSONB` | NOT NULL, DEFAULT `'{}'` — full upstream API payload |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()`, auto-updated by trigger |

**Realtime:** REPLICA IDENTITY FULL.

The `alliances` JSONB structure:

```json
{
  "red": {
    "score": 285,
    "team_keys": ["frc254", "frc1678", "frc971"],
    "teams": [{"teamNumber": 254, "station": "Red1"}, ...]
  },
  "blue": {
    "score": 275,
    "team_keys": ["frc118", "frc148", "frc2056"],
    "teams": [...]
  }
}
```

### `caster_notes` (PK: UUID)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | `UUID` | PRIMARY KEY, DEFAULT `uuid_generate_v4()` |
| `event_key` | `TEXT` | NOT NULL, indexed |
| `match_key` | `TEXT` | nullable, indexed with event_key |
| `team_key` | `TEXT` | nullable, indexed with event_key |
| `author` | `TEXT` | NOT NULL |
| `content` | `TEXT` | NOT NULL |
| `type` | `TEXT` | NOT NULL, DEFAULT `'manual'`, CHECK `('manual', 'system')` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL, DEFAULT `now()`, indexed DESC |

**RLS:** Anon + authenticated can SELECT. Authenticated can INSERT. Authenticated can DELETE own notes (author matches JWT email).

**Realtime:** Added to `supabase_realtime` publication. The web client subscribes to INSERTs only.

---

## 4. The iOS Architecture Mandate

These are non-negotiable architecture rules for the native app:

### Target
- **iOS 17.0+** minimum deployment target
- **Swift 5.9+** (use modern concurrency, macros)
- **No UIKit** — pure SwiftUI

### Adaptive Size Classes (Pillar 1)
- Use `@Environment(\.horizontalSizeClass)` in the root `ContentView` to switch layouts
- **iPad** (`.regular`): `NavigationSplitView` with 3 columns — sidebar (event list), content (rankings/PbP), detail (team inspector)
- **iPhone** (`.compact`): `TabView` with tabs for Rankings, Play-by-Play, Breakdown, Teams, Notes

### State Management (Pillar 2)
- Single `BroadcastStore` class annotated with `@Observable` (iOS 17 macro, NOT `ObservableObject`)
- Injected into the SwiftUI environment via `.environment(store)`
- Accessed in views via `@Environment(BroadcastStore.self)`
- Store owns all live state: `selectedEvent`, `rankings`, `matches`, `notes`, `isConnected`

### Offline-First with SwiftData (Pillar 3)
- `@Model` types: `CachedTeam`, `CachedMatch`, `CachedNote`
- On app launch and event selection, load from SwiftData **first**, then background-sync from API
- `CachedNote` has a `pendingSync: Bool` field — notes created offline are queued and flushed when connectivity returns
- `NWPathMonitor` gates when sync operations fire

### Native Realtime (Pillar 4)
- Use `supabase-swift` v2 SDK (`import Supabase`)
- Subscribe to a single multiplexed channel per event: `event:{eventKey}`
- Listen to 3 tables: `event_teams` (any change), `matches` (any change), `caster_notes` (INSERT only)
- Filter: `event_key=eq.{eventKey}`
- On disconnect: exponential backoff reconnect (0.5s base, 30s max), then full reconciliation (re-fetch all data from API)

### Dependencies
- `supabase-swift` (v2+) — Realtime + PostgREST client
- No other third-party dependencies unless absolutely necessary

---

## 5. Current Progress — The Scaffold

We have already generated the foundational architecture files. **Do not recreate these — build on top of them.**

### File Map

```
CastersTool/Sources/
├── App/
│   └── ContentView.swift          (153 lines)
├── Models/
│   └── Models.swift               (321 lines)
├── Stores/
│   └── BroadcastStore.swift       (189 lines)
├── Sync/
│   └── SyncEngine.swift           (225 lines)
└── Realtime/
    └── RealtimeManager.swift      (269 lines)
```

### What Each File Contains

**`ContentView.swift`** — Root layout router.
- Reads `horizontalSizeClass` to switch between `CockpitLayout` (iPad) and `CompactLayout` (iPhone)
- `CockpitLayout`: `NavigationSplitView` with `EventSidebarView`, content area switchable between Rankings/PbP/Breakdown via `CockpitTabPicker`, and `TeamDetailView` in detail column
- `CompactLayout`: `TabView` with 5 tabs (Rankings, PbP, Breakdown, Teams, Notes)
- `ConnectionStatusBadge`: green/red dot showing `store.isConnected`
- Placeholder views exist for: `EventSidebarView`, `RankingsView`, `PlayByPlayView`, `BreakdownView`, `TeamLookupView`, `NotesView`, `TeamDetailView`

**`BroadcastStore.swift`** — Central `@Observable` state container.
- Properties: `selectedEvent`, `selectedTeam`, `selectedMatch`, `rankings: [CachedTeam]`, `matches: [CachedMatch]`, `notes: [CachedNote]`, `isConnected`, `lastSyncDate`, `syncError`
- `bootstrap()`: Creates `ModelContainer`, sets up `SyncEngine` + `RealtimeManager`, loads cached data
- `selectEvent(_:)`: Loads cache → subscribes Realtime → triggers background sync
- `didReceiveTeamUpdate(_:)`, `didReceiveMatchUpdate(_:)`, `didReceiveNoteInsert(_:)`: Realtime callbacks that update arrays and persist to SwiftData
- `createNote(content:teamKey:matchKey:)`: Creates a `CachedNote` with `pendingSync: true`, queues via `SyncEngine`
- `reconcileAfterReconnect()`: Full re-fetch after Realtime reconnection

**`Models.swift`** — SwiftData `@Model` types + Codable DTOs.
- `CachedTeam`: Flattened from `event_teams.raw_data` — has `eventKey`, `teamKey`, `teamNumber`, `nickname`, `rank`, `wins/losses/ties`, `oprTotalPoints`, `epaTotal`, location fields, `updatedAt`. Unique constraint on `[eventKey, teamKey]`.
- `CachedMatch`: Mirrors `matches` table — has `matchKey`, `eventKey`, `compLevel`, `matchNumber`, `status`, `redScore/blueScore`, `redTeamKeys/blueTeamKeys`, `alliancesJSON/scoreBreakdownJSON` as `Data?` for full JSONB, `scheduledTime`. Unique on `[matchKey]`.
- `CachedNote`: Mirrors `caster_notes` — has `id: UUID`, `eventKey`, `matchKey?`, `teamKey?`, `author`, `content`, `type`, `createdAt`, `pendingSync: Bool`. Unique on `[id]`.
- `TeamDTO`, `TeamRawData`, `MatchDTO`, `AlliancesDTO`, `AllianceSideDTO`, `NoteDTO`: Codable wire types with `snake_case` CodingKeys for Supabase JSON mapping.
- `AnyCodable`: Type-erased Codable wrapper for arbitrary JSONB (score breakdowns).

**`SyncEngine.swift`** — Offline/online sync actor.
- `actor SyncEngine` — thread-safe, isolated
- `syncEvent(_:)`: Fetches teams from `/api/events/{key}/teams` and matches from `/api/matches/{key}/all`, upserts into SwiftData
- `upsertTeam(_:eventKey:)` / `upsertMatch(_:)`: Query SwiftData by key, update existing or insert new
- `pushNote(_:)`: POSTs note to Supabase PostgREST `/rest/v1/caster_notes` with anon key auth. On success, clears `pendingSync`.
- `flushPendingNotes()`: Fetches all `pendingSync == true` notes and pushes each
- `NWPathMonitor`: When connectivity returns after being offline, auto-calls `flushPendingNotes()`
- `applyTeamUpdate(_:)` / `applyMatchUpdate(_:)`: Bridge methods for RealtimeManager to persist incoming changes

**`RealtimeManager.swift`** — Supabase Realtime WebSocket manager.
- `actor RealtimeManager`
- `subscribe(eventKey:)`: Creates channel `"event:{eventKey}"`, attaches 3 listeners (`event_teams` any, `matches` any, `caster_notes` INSERT), starts `AsyncStream` processing loops
- `unsubscribe()`: Tears down channel + cancels reconnect task
- `handleTeamChange`, `handleMatchChange`, `handleNoteInsert`: Decode Realtime payload JSON → DTO → SwiftData model → call `store.didReceive*`
- `monitorConnection`: Watches channel `statusChange` stream, triggers `reconcileAfterReconnect()` on reconnect, calls `scheduleReconnect` on close
- `scheduleReconnect`: Exponential backoff — `0.5s × 2^attempt`, capped at 30s
- Contains placeholder `AnyAction` / `InsertAction` structs (to be replaced by actual `supabase-swift` types)

### What Still Needs Building

The scaffold has placeholder views. The next steps are to implement the actual UI:

1. **`EventSidebarView`** — API call to `/api/events/season/{year}` to list events, selection drives `store.selectEvent()`
2. **`RankingsView`** — Render `store.rankings` as a sortable `List`/`Table` with rank, team number, nickname, record, OPR
3. **`PlayByPlayView`** — Render `store.matches` grouped by comp_level, show scores, highlight in-progress matches
4. **`BreakdownView`** — Render `match.scoreBreakdownJSON` as a detailed scoring table for a selected match
5. **`TeamDetailView`** — Show full team profile: stats, match history, caster notes filtered by team_key
6. **`NotesView`** — List `store.notes`, compose new notes via `store.createNote()`
7. **`TeamLookupView`** — Search by team number, display quick stats
8. **App entry point** (`CastersToolApp.swift`) — `@main` struct with `.modelContainer(for:)` and `.environment(store)`

### Backend API Endpoints the App Consumes

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/events/season/{year}` | Array of event objects for a season |
| GET | `/api/events/{event_key}/info` | Single event metadata |
| GET | `/api/events/{event_key}/teams` | Array of enriched team objects |
| GET | `/api/events/{event_key}/snapshot` | Full event snapshot (teams + matches + alliances) |
| GET | `/api/events/{event_key}/summary` | Demographics, HoF count, high scores |
| GET | `/api/events/{event_key}/summary/connections` | Team-to-team historical connections |
| GET | `/api/matches/{event_key}/all` | All matches for an event |
| GET | `/api/matches/{event_key}/scores` | Score summary per match |
| GET | `/api/alliances/{event_key}` | Alliance selections |
| GET | `/api/events/{event_key}/history` | Team history at this event |
| GET | `/api/events/{event_key}/notes` | Caster notes for event |
| POST | (Supabase direct) `/rest/v1/caster_notes` | Insert a new caster note |

All GET requests go through the FastAPI BFF. Only note writes go directly to Supabase PostgREST.
