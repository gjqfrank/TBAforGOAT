# Caster's Tool — iOS Native: Complete Wiring Guide

> **Purpose**: This document tells you EXACTLY how to wire every SwiftUI view to the backend. Every API call, every response shape, every Supabase query, every Realtime subscription — nothing is left to inference. Follow this document sequentially.

---

## 0. Credentials & Config

```
SUPABASE_URL  = "https://qytovurlcjrpvlbmkyip.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dG92dXJsY2pycHZsYm1reWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDUzNDIsImV4cCI6MjA5MDk4MTM0Mn0.-nRiYhXoHtZ4kTZgarq8r-c4HUYj8gmbem5qMxVQ8Ss"
BFF_BASE_URL  = "https://your-backend.fly.dev"  // Configure at build time
```

The app talks to **two** servers:
1. **BFF (FastAPI backend)** — all GET reads go here. Prefix: `/api/`
2. **Supabase PostgREST** — only note writes + auth + Realtime WebSocket

---

## 1. What Already Exists (DO NOT RECREATE)

```
CastersTool/Sources/
├── App/ContentView.swift          — Adaptive layout (NavigationSplitView iPad / TabView iPhone)
├── Models/Models.swift            — SwiftData @Model: CachedTeam, CachedMatch, CachedNote + DTOs
├── Stores/BroadcastStore.swift    — @Observable state: rankings, matches, notes, selectedEvent
├── Sync/SyncEngine.swift          — Offline queue actor, NWPathMonitor, note push
└── Realtime/RealtimeManager.swift — Supabase channel subscriptions, backoff reconnect
```

These 5 files compile and wire together. Your job is to implement the **views** and fill in the **API service layer**.

---

## 2. The API Service You Must Create

Create `Sources/Services/APIService.swift`. This is the single gateway for all BFF calls.

Every endpoint below is relative to `BFF_BASE_URL`. All responses are JSON. All requests are GET unless noted.

```swift
actor APIService {
    static let shared = APIService()
    private let base: URL
    private let decoder: JSONDecoder  // .convertFromSnakeCase

    // Event discovery
    func fetchSeasonEvents(year: Int) async throws -> [EventInfo]
    // → GET /api/events/season/{year}

    // Event load (Phase 1 — call both in parallel)
    func fetchEventInfo(eventKey: String) async throws -> EventInfo
    // → GET /api/events/{eventKey}/info

    func fetchEventTeams(eventKey: String) async throws -> [TeamStats]
    // → GET /api/events/{eventKey}/teams

    // Phase 2 — fire all three in parallel after Phase 1
    func fetchAllMatches(eventKey: String) async throws -> MatchesResponse
    // → GET /api/matches/{eventKey}/all

    func fetchPlayoffMatches(eventKey: String) async throws -> MatchesResponse
    // → GET /api/matches/{eventKey}/playoffs

    func fetchAlliances(eventKey: String) async throws -> AlliancesResponse
    // → GET /api/alliances/{eventKey}

    // Tab-specific (lazy, on demand)
    func fetchSummary(eventKey: String) async throws -> SummaryResponse
    // → GET /api/events/{eventKey}/summary

    func fetchConnections(eventKey: String) async throws -> [Connection]
    // → GET /api/events/{eventKey}/summary/connections

    func fetchSummaryAwards(eventKey: String) async throws -> AwardsResponse
    // → GET /api/events/{eventKey}/summary/awards

    func fetchHistory(eventKey: String) async throws -> EventHistory
    // → GET /api/events/{eventKey}/history

    func fetchMatchBreakdown(matchKey: String) async throws -> BreakdownResponse
    // → GET /api/matches/match/{matchKey}/breakdown

    func fetchTeamStats(teamNumber: Int, year: Int) async throws -> TeamFullStats
    // → GET /api/teams/{teamNumber}/stats?year={year}

    func fetchHeadToHead(teamA: Int, teamB: Int, allTime: Bool) async throws -> H2HResponse
    // → GET /api/teams/head-to-head/{teamA}/{teamB}?all_time={allTime}

    func fetchEventNotes(eventKey: String) async throws -> [NoteResponse]
    // → GET /api/events/{eventKey}/notes

    func fetchFastRankings(eventKey: String) async throws -> [FastRanking]
    // → GET /api/events/{eventKey}/fast-rankings
}
```

---

## 3. EXACT Event Load Sequence

When the user selects an event, this is the EXACT order of operations. Implement this in `BroadcastStore.selectEvent()`.

### Phase 1: Blocking (user sees loading spinner)

Fire these two in parallel with `async let`:

```swift
async let info = APIService.shared.fetchEventInfo(eventKey: key)
async let teams = APIService.shared.fetchEventTeams(eventKey: key)
let (eventInfo, teamList) = try await (info, teams)
```

Store results:
```swift
self.eventInfo = eventInfo
self.rankings = teamList.sorted { ($0.rank ?? .max) < ($1.rank ?? .max) }
```

Display Rankings tab immediately.

### Phase 2: Non-blocking background (fire-and-forget, parallel)

```swift
Task {
    async let m = APIService.shared.fetchAllMatches(eventKey: key)
    async let p = APIService.shared.fetchPlayoffMatches(eventKey: key)
    async let a = APIService.shared.fetchAlliances(eventKey: key)
    let (matchResp, playoffResp, allianceResp) = try await (m, p, a)
    await MainActor.run {
        self.matches = matchResp.matches
        self.eventHighScore = matchResp.eventHighScore
        self.playoffMatches = playoffResp.matches
        self.alliances = allianceResp.alliances
    }
}
```

### Phase 3: Subscribe Realtime

```swift
await realtimeManager.subscribe(eventKey: key)
```

### Phase 4: Tab-specific data loads on demand

Each tab calls its endpoint lazily when the user navigates to it.

---

## 4. EXACT Response Shapes (Every Field)

### `GET /api/events/season/{year}` → `[EventInfo]`

```json
[
  {
    "key": "2026tuak",
    "name": "FIRST in Texas District Amarillo Event",
    "year": 2026,
    "event_type": 1,
    "event_type_string": "District",
    "city": "Amarillo",
    "state_prov": "TX",
    "country": "USA",
    "start_date": "2026-03-15",
    "end_date": "2026-03-17",
    "status": "ongoing"
  }
]
```

### `GET /api/events/{event_key}/info` → `EventInfo`

Same shape as above, single object.

### `GET /api/events/{event_key}/teams` → `[TeamStats]`

```json
[
  {
    "team_key": "frc254",
    "team_number": 254,
    "nickname": "The Cheesy Poofs",
    "school_name": "Bellarmine College Prep",
    "city": "San Jose",
    "state_prov": "CA",
    "country": "USA",
    "rookie_year": 1999,
    "avatar": "data:image/png;base64,...",
    "rank": 1,
    "wins": 10,
    "losses": 2,
    "ties": 0,
    "qual_average": 150.5,
    "ranking_points": 45.0,
    "opr": 125.5,
    "epa": 78.2,
    "epa_auto": 32.1,
    "epa_teleop": 28.5,
    "epa_endgame": 17.6,
    "has_tims_overrides": false,
    "tims_author": null,
    "tims_event_key": null,
    "tims_updated_at": null
  }
]
```

**Swift Codable struct**:
```swift
struct TeamStats: Codable, Identifiable {
    var id: String { teamKey }
    let teamKey: String
    let teamNumber: Int
    let nickname: String
    let schoolName: String?
    let city: String?
    let stateProv: String?
    let country: String?
    let rookieYear: Int?
    let avatar: String?
    let rank: Int?
    let wins: Int
    let losses: Int
    let ties: Int
    let qualAverage: Double?
    let rankingPoints: Double?
    let opr: Double?
    let epa: Double?
    let epaAuto: Double?
    let epaTeleop: Double?
    let epaEndgame: Double?
    let hasTimsOverrides: Bool?
}
```

### `GET /api/matches/{event_key}/all` → `MatchesResponse`

```json
{
  "matches": [
    {
      "key": "2026tuak_qm1",
      "label": "Qual 1",
      "comp_level": "qm",
      "match_number": 1,
      "set_number": 1,
      "red": {
        "teams": [
          {
            "team_number": 254,
            "nickname": "The Cheesy Poofs",
            "opr": 125.5,
            "epa": 78.2
          },
          { "team_number": 1678, "nickname": "Citrus Circuits", "opr": 110.3, "epa": 72.1 },
          { "team_number": 971, "nickname": "Spartan Robotics", "opr": 95.2, "epa": 65.0 }
        ],
        "score": 285
      },
      "blue": {
        "teams": [...],
        "score": 275
      },
      "winning_alliance": "red",
      "has_breakdown": true,
      "scheduled_time": "2026-03-15T10:30:00Z"
    }
  ],
  "event_high_score": {
    "score": 350,
    "teams": [254, 1690],
    "match": "Qual 43"
  }
}
```

**Swift structs**:
```swift
struct MatchesResponse: Codable {
    let matches: [Match]
    let eventHighScore: EventHighScore?
}

struct Match: Codable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let compLevel: String       // "qm", "sf", "f"
    let matchNumber: Int
    let setNumber: Int?
    let red: Alliance
    let blue: Alliance
    let winningAlliance: String? // "red", "blue", or null
    let hasBreakdown: Bool?
    let scheduledTime: String?
}

struct Alliance: Codable {
    let teams: [AllianceTeam]
    let score: Int?
}

struct AllianceTeam: Codable {
    let teamNumber: Int
    let nickname: String?
    let opr: Double?
    let epa: Double?
}

struct EventHighScore: Codable {
    let score: Int
    let teams: [Int]
    let match: String
}
```

### `GET /api/matches/{event_key}/playoffs` → `MatchesResponse`

Same shape as above, filtered to `comp_level = "sf"` or `"f"`.

### `GET /api/alliances/{event_key}` → `AlliancesResponse`

```json
{
  "alliances": [
    {
      "number": 1,
      "name": "Alliance 1",
      "picks": [
        {
          "team_key": "frc254",
          "team_number": 254,
          "nickname": "The Cheesy Poofs",
          "opr": 125.5,
          "epa": 78.2
        }
      ]
    }
  ]
}
```

### `GET /api/events/{event_key}/summary` → `SummaryResponse`

```json
{
  "demographics": {
    "total_teams": 45,
    "rookie_count": 5,
    "countries": ["USA", "MX"],
    "states": ["TX", "OK", "NM"],
    "avg_team_age": 8.2
  },
  "hall_of_fame": [
    { "team_number": 254, "nickname": "The Cheesy Poofs", "induction_year": 2003 }
  ],
  "hof_count": 1,
  "impact_finalists": [
    { "team_number": 148, "nickname": "Robowranglers" }
  ],
  "einstein_teams": [
    { "team_number": 1678, "nickname": "Citrus Circuits" }
  ],
  "einstein_count": 1,
  "top_opr": [
    { "team_number": 254, "opr": 125.5, "rank": 1 }
  ],
  "high_scores": {
    "highest_qual": { "score": 350, "teams": [254, 1678, 971], "match": "Qual 43" },
    "highest_playoff": null
  }
}
```

### `GET /api/events/{event_key}/summary/connections` → `[Connection]`

This is the "prior matchup history" feature. Shows which teams on the field have played together or against each other before.

```json
[
  {
    "team_a": 254,
    "team_a_name": "The Cheesy Poofs",
    "team_b": 1678,
    "team_b_name": "Citrus Circuits",
    "partnered_at": [
      {
        "event_key": "2025casj",
        "event_name": "Silicon Valley Regional",
        "year": 2025,
        "stage": "Semifinals",
        "result": "winner"
      }
    ],
    "opponents_at": [
      {
        "event_key": "2024cmptx",
        "event_name": "Einstein",
        "year": 2024,
        "stage": "Finals"
      }
    ]
  }
]
```

**Usage in Play-by-Play**: When displaying a match, call this endpoint with a `?teams=` query parameter containing the 6 team numbers on the field:

```
GET /api/events/{event_key}/summary/connections?teams=254,1678,971,118,148,2056
```

The backend filters to only return connections between those 6 teams. Display as "Prior Connections on the Field" below the match card.

### `GET /api/events/{event_key}/history` → `EventHistory`

```json
{
  "event_name": "FIRST in Texas District Amarillo Event",
  "event_key": "2026tuak",
  "first_held": 2020,
  "editions": 5,
  "years_held": [2020, 2021, 2022, 2024, 2025],
  "most_wins": [
    { "team_number": 148, "nickname": "Robowranglers", "count": 3 }
  ],
  "most_finalists": [...],
  "most_impact": [...],
  "most_ei": [...],
  "most_ras": [...],
  "timeline": [
    {
      "year": 2025,
      "event_key": "2025tuak",
      "winners": [{ "team_number": 148, "nickname": "Robowranglers" }],
      "finalists": [{ "team_number": 254, "nickname": "The Cheesy Poofs" }],
      "impact": { "team_number": 118, "nickname": "Robonauts" }
    }
  ]
}
```

### `GET /api/matches/match/{match_key}/breakdown` → `BreakdownResponse`

The `match_key` format is `{event_key}_{comp_level}{match_number}`, e.g. `2026tuak_qm15`.

```json
{
  "match_key": "2026tuak_qm15",
  "available": true,
  "red": {
    "team_numbers": [254, 1678, 971],
    "auto": 45,
    "teleop": 120,
    "endgame": 30,
    "total": 195,
    "breakdown": {
      "robots": [
        {
          "team_number": 254,
          "auto_points": 18,
          "teleop_points": 52,
          "endgame_points": 15
        }
      ]
    }
  },
  "blue": {
    "team_numbers": [118, 148, 2056],
    "auto": 38,
    "teleop": 95,
    "endgame": 25,
    "total": 158,
    "breakdown": { "robots": [...] }
  },
  "game_year": 2026
}
```

**Important**: If `"available": false`, the breakdown hasn't been posted yet. Show a "Waiting for breakdown…" state and poll every 5 seconds.

### `GET /api/teams/{team_number}/stats?year={year}` → `TeamFullStats`

This is the **Team Lookup / Spotlight** response. It's a rich profile.

```json
{
  "team_number": 254,
  "team_key": "frc254",
  "nickname": "The Cheesy Poofs",
  "city": "San Jose",
  "state_prov": "CA",
  "country": "USA",
  "rookie_year": 1999,
  "years_active": 27,
  "has_competed": true,
  "avatar": "data:image/png;base64,...",
  "year": 2026,
  "events_this_year": [
    {
      "event_key": "2026casj",
      "event_name": "Silicon Valley Regional",
      "event_type": "Regional",
      "start_date": "2026-03-08",
      "end_date": "2026-03-10",
      "city": "San Jose",
      "state_prov": "CA",
      "is_upcoming": false,
      "qual_rank": 1,
      "qual_record": "10-2-0",
      "playoff_level": "Finals",
      "playoff_status": "Winner",
      "alliance_pick": "Captain",
      "alliance_number": 1
    }
  ],
  "blue_banners": [
    {
      "award_type": 1,
      "name": "Regional Winner",
      "year": 2026,
      "event_key": "2026casj",
      "event_name": "Silicon Valley Regional"
    }
  ],
  "blue_banner_count": 42,
  "awards": [
    { "award_type": 0, "name": "Chairman's Award", "year": 2003, "event_key": "2003cmp", "event_name": "Championship" }
  ],
  "is_hof": true,
  "hof_awards": [{ "year": 2003, "event_key": "2003cmp", "event_name": "Championship" }],
  "is_impact_finalist": false,
  "impact_finalist_awards": [],
  "is_einstein_winner": true,
  "einstein_wins": [
    { "year": 2022, "event_key": "2022cmptx", "event_name": "Einstein" }
  ],
  "highest_stage_of_play": "Einstein Finals",
  "highest_event_level": "Championship",
  "last_season": {
    "year": 2025,
    "achievement": "Regional Winner",
    "event_name": "SVR"
  },
  "season_achievements": [
    { "year": 2025, "achievement": "Regional Winner", "event_name": "SVR" }
  ]
}
```

### `GET /api/teams/head-to-head/{teamA}/{teamB}?all_time={bool}` → `H2HResponse`

```json
{
  "team_a": 254,
  "team_b": 1690,
  "h2h_summary": {
    "total_opponent_matches": 12,
    "team_a_wins": 8,
    "team_b_wins": 4,
    "total_ally_matches": 5
  },
  "opponent_matches": [
    {
      "event_key": "2025casj",
      "event_name": "Silicon Valley Regional",
      "match_key": "2025casj_f1m1",
      "match_label": "Finals 1",
      "comp_level": "f",
      "year": 2025,
      "red_teams": ["frc254", "frc1678", "frc971"],
      "blue_teams": ["frc1690", "frc118", "frc148"],
      "red_score": 285,
      "blue_score": 260,
      "winner": "red",
      "relationship": "opponents"
    }
  ],
  "ally_matches": [
    {
      "event_key": "2024casj",
      "event_name": "Silicon Valley Regional",
      "match_key": "2024casj_sf1m1",
      "match_label": "Semifinal 1-1",
      "comp_level": "sf",
      "year": 2024,
      "red_teams": ["frc254", "frc1690", "frc971"],
      "blue_teams": ["frc118", "frc148", "frc2056"],
      "red_score": 310,
      "blue_score": 275,
      "winner": "red",
      "relationship": "allies"
    }
  ],
  "years_checked": [2022, 2023, 2024, 2025, 2026],
  "all_time": true,
  "team_nicknames": {
    "254": "The Cheesy Poofs",
    "1690": "Orbit"
  }
}
```

### `GET /api/events/{event_key}/fast-rankings` → `[FastRanking]`

Lightweight endpoint for polling (no OPR/EPA, just rank + record). Use for 15-second auto-refresh.

```json
[
  {
    "team_number": 254,
    "rank": 1,
    "wins": 10,
    "losses": 2,
    "ties": 0
  }
]
```

### `GET /api/events/{event_key}/notes` → `[NoteResponse]`

```json
[
  {
    "id": "a1b2c3d4-...",
    "event_key": "2026tuak",
    "match_key": "2026tuak_qm15",
    "team_key": "frc254",
    "author": "broadcaster@email.com",
    "content": "Strong autonomous mode, consistently scores in teleop",
    "type": "manual",
    "created_at": "2026-03-15T14:30:00Z"
  }
]
```

---

## 5. Supabase Direct Operations (PostgREST)

These are NOT routed through the BFF. They go directly to Supabase.

### 5a. Insert a Note

```
POST https://qytovurlcjrpvlbmkyip.supabase.co/rest/v1/caster_notes
Headers:
  apikey: {SUPABASE_ANON}
  Authorization: Bearer {user_jwt_or_SUPABASE_ANON}
  Content-Type: application/json
  Prefer: return=representation
Body:
{
  "event_key": "2026tuak",
  "match_key": "2026tuak_qm15",   // optional
  "team_key": "frc254",            // optional
  "author": "Broadcaster Name",
  "content": "Note text here",
  "type": "manual"
}
Response: 201 with the inserted row
```

If the user is authenticated (has a JWT from Supabase Auth), use that JWT in Authorization. Otherwise fall back to the anon key. Anon can SELECT, only authenticated can INSERT.

### 5b. Fetch Notes (alternative to BFF route)

```
GET https://qytovurlcjrpvlbmkyip.supabase.co/rest/v1/caster_notes
  ?event_key=eq.2026tuak
  &order=created_at.desc
  &select=*
Headers:
  apikey: {SUPABASE_ANON}
  Authorization: Bearer {SUPABASE_ANON}
```

Optional extra filters: `&match_key=eq.2026tuak_qm15` or `&team_key=eq.frc254`

### 5c. Authentication (Email OTP)

The web app uses Supabase GoTrue for passwordless email login:

**Step 1: Send OTP**
```
POST https://qytovurlcjrpvlbmkyip.supabase.co/auth/v1/otp
Headers:
  apikey: {SUPABASE_ANON}
  Content-Type: application/json
Body:
{
  "email": "caster@example.com"
}
Response: 200 {}
```

**Step 2: Verify OTP code**
```
POST https://qytovurlcjrpvlbmkyip.supabase.co/auth/v1/verify
Headers:
  apikey: {SUPABASE_ANON}
  Content-Type: application/json
Body:
{
  "email": "caster@example.com",
  "token": "123456",
  "type": "email"
}
Response: 200
{
  "access_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "abc123...",
  "user": {
    "id": "uuid",
    "email": "caster@example.com",
    "role": "authenticated"
  }
}
```

**Step 3: Store session**
Save `access_token`, `refresh_token`, `expires_in` to Keychain. Attach `access_token` as `Bearer` in all Supabase writes.

**Step 4: Refresh token** (before expiry)
```
POST https://qytovurlcjrpvlbmkyip.supabase.co/auth/v1/token?grant_type=refresh_token
Headers:
  apikey: {SUPABASE_ANON}
  Content-Type: application/json
Body:
{
  "refresh_token": "abc123..."
}
Response: 200 (same shape as verify — new access_token + refresh_token)
```

**For supabase-swift SDK**: Use `client.auth.signInWithOTP(email:)` and `client.auth.verifyOTP(email:token:type:)`. The SDK handles token storage and refresh automatically.

---

## 6. Realtime Subscriptions (supabase-swift)

When the user selects an event, subscribe to ONE multiplexed channel:

```swift
let channel = supabase.realtimeV2.channel("event:\(eventKey)")

// 1. Team stat updates (rank changes, OPR recalculated)
let teamChanges = channel.postgresChange(
    AnyAction.self,
    schema: "public",
    table: "event_teams",
    filter: "event_key=eq.\(eventKey)"
)

// 2. Match updates (new scores, status changes)
let matchChanges = channel.postgresChange(
    AnyAction.self,
    schema: "public",
    table: "matches",
    filter: "event_key=eq.\(eventKey)"
)

// 3. New caster notes (INSERT only)
let noteInserts = channel.postgresChange(
    InsertAction.self,
    schema: "public",
    table: "caster_notes",
    filter: "event_key=eq.\(eventKey)"
)

await channel.subscribe()
```

### What Realtime payloads look like

**event_teams UPDATE** (rank/OPR changed):
```json
{
  "type": "UPDATE",
  "table": "event_teams",
  "schema": "public",
  "record": {
    "event_key": "2026tuak",
    "team_key": "frc254",
    "raw_data": { "rank": 1, "wins": 11, "opr": 128.3, ... },
    "updated_at": "2026-03-15T15:00:00Z"
  },
  "old_record": { ... }
}
```

**matches UPDATE** (score posted):
```json
{
  "type": "UPDATE",
  "table": "matches",
  "record": {
    "match_key": "2026tuak_qm16",
    "event_key": "2026tuak",
    "comp_level": "qm",
    "match_number": 16,
    "status": "completed",
    "alliances": {
      "red": { "score": 285, "team_keys": ["frc254","frc1678","frc971"], "teams": [...] },
      "blue": { "score": 260, "team_keys": ["frc118","frc148","frc2056"], "teams": [...] }
    },
    "score_breakdown": { ... },
    "updated_at": "2026-03-15T15:05:00Z"
  }
}
```

**caster_notes INSERT**:
```json
{
  "type": "INSERT",
  "table": "caster_notes",
  "record": {
    "id": "uuid-...",
    "event_key": "2026tuak",
    "match_key": null,
    "team_key": "frc254",
    "author": "broadcaster@email.com",
    "content": "Watch this team in playoffs",
    "type": "manual",
    "created_at": "2026-03-15T15:10:00Z"
  }
}
```

### How to handle each Realtime message

1. **Team update** → Parse `record.raw_data`, find team in `store.rankings` by `team_key`, update rank/opr/wins/losses. Re-sort rankings.
2. **Match update** → Parse `record`, find match in `store.matches` by `match_key`, update scores/status. If user is viewing this match in PBP, re-render.
3. **Note insert** → Parse `record`, prepend to `store.notes`.

### Reconnection

If the channel status becomes `.closed` or errors out:
1. Wait with exponential backoff: `0.5s × 2^attempt`, max 30s
2. Re-subscribe to the same event
3. On successful reconnect, do a FULL re-fetch (call both `fetchEventTeams` and `fetchAllMatches` again) because you may have missed updates while disconnected

---

## 7. View Implementation Guide (Tab by Tab)

### 7a. EventSidebarView (iPad sidebar / Event Picker)

**Data**: Call `APIService.shared.fetchSeasonEvents(year: currentYear)` on appear.
**Display**: List of events grouped by status (ongoing first, then upcoming, then completed).
**Action**: Tapping an event calls `store.selectEvent(event.key)`.
**State**: Highlight the currently selected event.

### 7b. RankingsView

**Data source**: `store.rankings` (populated by Phase 1).
**Display**: Table/List with columns: Rank, #, Name, Record (W-L-T), OPR, EPA.
**Sorting**: Tappable column headers to re-sort.
**Auto-refresh**: Every 15 seconds, call `fetchFastRankings(eventKey:)` and merge updated ranks/records into `store.rankings`. Only update changed fields to avoid UI flicker.
**Action**: Tap a team row → set `store.selectedTeam`, on iPad this populates the detail column with `TeamDetailView`.

### 7c. PlayByPlayView

**Data source**: `store.matches` (populated by Phase 2).
**Display**: Match selector (Picker or segmented control) showing all matches labeled "Qual 1", "Qual 2", etc. Auto-advances to the latest scored match.
**For each match, render**:
- Red Alliance card: 3 team rows with number, name, OPR, EPA. Background: red-tinted.
- Blue Alliance card: same, blue-tinted.
- Scores: large score display for each alliance.
- Winning alliance highlighted.
- "Prior Connections on the Field" section (see below).

**Prior Connections**: After rendering a match, extract the 6 team numbers and call:
```
GET /api/events/{eventKey}/summary/connections?teams=254,1678,971,118,148,2056
```
Cache the result by team-set so you don't re-fetch for the same combination. Display connections as pills: "254 & 1678: Partners at 2025casj (Winners)" etc.

**Auto-refresh**: Every 15 seconds, re-fetch matches. If the currently displayed match's score changed, update it. Auto-advance the index to the latest scored match.

**Compare button**: Selecting two teams from opposite alliances opens the H2H view.

### 7d. BreakdownView

**Data source**: User selects a match, then:
```swift
let breakdown = try await APIService.shared.fetchMatchBreakdown(matchKey: match.key)
```

**Display**: Two columns (Red | Blue) showing point categories:
- Auto points
- Teleop points
- Endgame points
- Total
- Per-robot breakdown if available (from `breakdown.robots`)

**Not available yet**: If `breakdown.available == false`, show "Waiting for breakdown…" and poll every 5 seconds:
```swift
Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { _ in
    Task { let bd = try? await APIService.shared.fetchMatchBreakdown(matchKey: key)
        if bd?.available == true { /* render and stop timer */ }
    }
}
```

### 7e. TeamDetailView (Team Lookup / Spotlight)

**Trigger**: User enters team number in search, or taps a team in rankings/PBP.
**API call**:
```swift
let stats = try await APIService.shared.fetchTeamStats(teamNumber: 254, year: 2026)
```

**Display sections**:
1. **Header**: Team number, name, location (city, state, country), rookie year, avatar image.
2. **Prestige badges**: Hall of Fame badge (gold), Einstein Winner badge, Impact Finalist badge. Only show if `is_hof`, `is_einstein_winner`, etc. are true.
3. **Blue Banners**: Count + list of all event wins.
4. **This Season**: Table of `events_this_year` showing event name, rank, record, playoff result, alliance pick.
5. **Awards**: Full list of career awards.

### 7f. Head-to-Head View

**Trigger**: User enters two team numbers, or taps "Compare" on two teams from a match.
**API call**:
```swift
let h2h = try await APIService.shared.fetchHeadToHead(teamA: 254, teamB: 1690, allTime: true)
```

**Display**:
1. **Summary bar**: "254 leads 8-4 (12 meetings as opponents, 5 as allies)"
2. **Opponent matches table**: List each match with event name, year, comp level, scores, winner highlighted.
3. **Ally matches table**: Same format but labeled "Partnered" with combined result.
4. **Toggle**: "This year only" ↔ "All time" — re-fetches with `all_time` param.

### 7g. NotesView

**Data sources**:
- **Read**: `store.notes` (loaded from Supabase + Realtime inserts)
- **Write**: `store.createNote(content:teamKey:matchKey:)` → queues in SyncEngine

**On appear**: Fetch notes:
```swift
let notes = try await APIService.shared.fetchEventNotes(eventKey: store.selectedEvent!)
store.notes = notes
```

**Display**: Reverse-chronological list. Each note shows:
- Author name
- Content
- Team badge (if team_key present)
- Match reference (if match_key present)
- Timestamp

**Compose**: Text field + optional team/match picker. On submit:
```swift
store.createNote(content: text, teamKey: selectedTeam, matchKey: selectedMatch)
```
This creates a local `CachedNote` with `pendingSync = true`, inserts into `store.notes` for instant UI, then SyncEngine POSTs to Supabase in background. If offline, it stays queued and flushes when connectivity returns.

**Live updates**: New notes from other casters appear via Realtime INSERT subscription — they auto-prepend to `store.notes`.

### 7h. AlliancesView

**Data source**: `store.alliances` (populated by Phase 2).
**Display**: 8 alliance cards, each showing captain + picks with team numbers, names, OPR/EPA.

### 7i. SummaryView

**API call**: `fetchSummary(eventKey:)` — lazy loaded when tab selected.
**Display sections**:
1. Demographics: total teams, rookies, countries, avg age
2. Hall of Fame teams at this event
3. Einstein teams at this event
4. Top OPR scorers
5. Event high scores (qual + playoff)

**Sub-sections** (loaded on demand):
- **Connections**: `fetchConnections(eventKey:)` → shows all prior partnerships at this event
- **Awards**: `fetchSummaryAwards(eventKey:)` → past event award history

### 7j. HistoryView

**API call**: `fetchHistory(eventKey:)` — lazy loaded.
**Display**:
1. Event stats: first held, total editions
2. Most wins leaders (with counts)
3. Timeline: year-by-year winners/finalists/impact award

---

## 8. Authentication Flow (Sign In)

Use `supabase-swift` Auth module:

```swift
// Step 1: Send OTP
try await supabase.auth.signInWithOTP(email: "caster@example.com")
// User receives 6-digit code via email

// Step 2: Verify
try await supabase.auth.verifyOTP(
    email: "caster@example.com",
    token: "123456",
    type: .email
)
// Session is now stored automatically by supabase-swift

// Step 3: Get current session
let session = try await supabase.auth.session
let jwt = session.accessToken
// Use this JWT in Authorization header for note writes

// Step 4: Check auth state
let user = try await supabase.auth.user()
// user.email → display in UI

// Step 5: Sign out
try await supabase.auth.signOut()
```

**UI**: Create `AuthView.swift`:
- If not authenticated: show email input + "Send Code" button
- After OTP sent: show 6-digit code input + "Verify" button
- If authenticated: show user email + "Sign Out" button
- Display auth state in settings/profile area

**Why it matters**: Anonymous users can read everything. Only authenticated users can create notes. The auth state should be visible but not blocking — the app works fully in read-only mode without signing in.

---

## 9. Offline-First Rules

1. **On app launch**: Load `selectedEvent` from UserDefaults. Fetch from SwiftData cache. Display immediately.
2. **On event selection**: Show SwiftData cache first, THEN fetch from API in background. When API returns, merge into SwiftData and update UI.
3. **Notes created offline**: Set `pendingSync = true`. When `NWPathMonitor` detects connectivity, `SyncEngine.flushPendingNotes()` pushes all pending notes.
4. **Realtime disconnected**: Show red dot in `ConnectionStatusBadge`. On reconnect, do full reconciliation (re-fetch teams + matches).
5. **SwiftData is the source of truth for display**. API responses update SwiftData, and views read from SwiftData (via BroadcastStore arrays which are populated from SwiftData fetches).

---

## 10. Polling Schedule Summary

| What | Interval | Endpoint | When |
|------|----------|----------|------|
| Rankings refresh | 15s | `/api/events/{key}/fast-rankings` | While event loaded and `status == "ongoing"` |
| Match auto-advance | 15s | `/api/matches/{key}/all` | While PBP tab is visible |
| Breakdown poll | 5s | `/api/matches/match/{key}/breakdown` | While viewing an unscored match |
| Realtime heartbeat | Automatic | Supabase WebSocket | Always while subscribed |

Stop all polling when user navigates away from the event or the app backgrounds.

---

## 11. FTC Mode

The app supports both FRC and FTC events. FTC event keys start with a year + "ftc", e.g. `"2025ftctrcmp"`.

FTC uses different endpoints (prefixed `/api/ftc/`):

| FRC Endpoint | FTC Equivalent |
|-------------|---------------|
| `/api/events/{key}/info` | `/api/ftc/events/{key}/info` |
| `/api/events/{key}/teams` | `/api/ftc/events/{key}/teams` |
| `/api/matches/{key}/all` | `/api/ftc/matches/{key}/all` |
| `/api/matches/{key}/playoffs` | `/api/ftc/matches/{key}/playoffs` |
| `/api/alliances/{key}` | `/api/ftc/alliances/{key}` |
| `/api/events/{key}/fast-rankings` | `/api/ftc/events/{key}/fast-rankings` |
| `/api/events/season/{year}` | `/api/ftc/events/season/{year}` |
| `/api/matches/match/{key}/breakdown` | `/api/ftc/matches/match/{key}/{level}/{number}/breakdown` |
| `/api/teams/{num}/stats` | `/api/ftc/events/team/{num}` |
| `/api/teams/h2h/{a}/{b}` | `/api/ftc/matches/head-to-head/{a}/{b}` |

Detect FTC mode: `eventKey.contains("ftc")`. Route API calls through the correct prefix.

**FTC team differences**:
- No EPA (FTC uses QuickStats instead: `tot`, `auto`, `dc`)
- Team key format: just the number (no `frc` prefix)
- Avatar source: different (FTC Events API)
- Rankings use `opr` not `epa`

Create a helper in APIService:
```swift
private func prefix(for eventKey: String) -> String {
    eventKey.contains("ftc") ? "/api/ftc" : "/api"
}
```

---

## 12. Error Handling

- **HTTP 429 (Rate Limited)**: Read `Retry-After` header, wait that many seconds, retry once.
- **HTTP 404**: Event/team not found — show empty state.
- **HTTP 504 (Timeout)**: Backend upstream is slow — show "Data sources are slow, retrying…" and retry after 5s.
- **Network error**: Set `store.isConnected = false`, show offline badge, use SwiftData cache.
- **Realtime disconnect**: Handled by RealtimeManager backoff. Show red dot. On reconnect, reconcile.
