# Blueprint: Region Facts & Event History (iOS)
### For Xcode Claude — wire the iOS model layer to fetch region/event history from the backend

---

## Overview

The backend exposes three region/history endpoints that the iOS app does not yet call.
This blueprint covers the exact URLs, response shapes, Swift model structs, and the
fetching pattern needed to drive a Region Facts view and an Event History view.

All three endpoints live under the `/api/events/` prefix (same router as everything else).

---

## 1. API Endpoints

| Endpoint | Cached? | Cost |
|----------|---------|------|
| `GET /api/events/regions/list` | Static JSON | Instant |
| `GET /api/events/region/{region_name}/facts` | Static JSON | Instant |
| `GET /api/events/{event_key}/history` | 1-hour disk + Supabase | Heavy |

The `region_name` path segment is **URL-encoded** (e.g. `FIRST%20in%20Michigan`).  
The `event_key` is a standard TBA key like `2026tuak`.

The `/history` endpoint is listed in `_HEAVY_PATTERNS` in `main.py`, so it is subject
to the heavy rate limit (60 req/min unauthenticated, 300 req/min with `X-API-Key`).
Call it once per event selection and cache the result locally — do **not** poll it.

---

## 2. Response Shapes

### 2a. Regions List

```http
GET /api/events/regions/list
```

```json
["FIRST Canada - Ontario", "FIRST Chesapeake", "FIRST in Michigan", "New England", ...]
```

A plain sorted `[String]`. Use this to populate a picker or search list.

---

### 2b. Region Facts

```http
GET /api/events/region/FIRST%20in%20Michigan/facts
```

```json
{
  "first_event_year": 1994,
  "first_event_name": "Michigan Regional",
  "active_years": [1994, 1995, 1996, ..., 2026],
  "total_events": 312,
  "team_count": 580,
  "current_season_teams": 420,
  "active_year": 2026,
  "official_team_count": 435,

  "hof_count": 14,
  "hof_teams": [
    { "team_number": 27, "nickname": "RUSH", "years": [2004, 2011] }
  ],

  "impact_count": 68,
  "impact_finalists": [
    { "team_number": 27, "nickname": "RUSH", "years": [2003, 2004, 2011] }
  ],

  "einstein_winner_count": 9,
  "einstein_winners": [
    {
      "team_number": 217,
      "nickname": "ThunderChickens",
      "years": [2015, 2019],
      "wins": [
        { "year": 2015, "division": "Tesla" },
        { "year": 2019, "division": "Daly" }
      ]
    }
  ],

  "einstein_count": 40,
  "einstein_teams": [
    { "team_number": 27, "nickname": "RUSH", "years": [2004, 2009, 2011] }
  ],

  "top_international_visitors": [
    { "team_number": 2990, "nickname": "...", "country": "Canada", "appearances": 5 }
  ]
}
```

`official_team_count` is only present for FIRST districts (fetched from the FRC API).
`team_count` is always present (derived from 5-year TBA sample).

---

### 2c. Event History

```http
GET /api/events/2026tuak/history
```

```json
{
  "event_name": "Turkey Regional",
  "event_key": "2026tuak",
  "first_held": 2010,
  "editions": 16,
  "years_held": [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2022, 2023, 2024, 2025, 2026],

  "most_wins": [
    { "team_number": 6025, "nickname": "...", "count": 3 }
  ],
  "most_finalists": [
    { "team_number": 6025, "nickname": "...", "count": 4 }
  ],
  "most_impact": [
    { "team_number": 5- , "nickname": "...", "count": 2 }
  ],
  "most_ei": [
    { "team_number": 7173, "nickname": "...", "count": 2 }
  ],
  "most_ras": [
    { "team_number": 8099, "nickname": "...", "count": 1 }
  ],

  "timeline": [
    {
      "year": 2026,
      "event_key": "2026tuak",
      "winners":   [{ "team_number": 1234, "nickname": "..." }],
      "finalists": [{ "team_number": 5678, "nickname": "..." }],
      "impact":    { "team_number": 2910, "nickname": "..." }
    },
    {
      "year": 2025,
      "event_key": "2025tuak",
      "winners":   [...],
      "finalists": [...],
      "impact":    null
    }
  ]
}
```

`timeline` is newest-first. `impact` may be `null` for years where no Impact Award was given.  
Leaderboard arrays (`most_wins`, etc.) are limited to 10 entries each (`most_ei`/`most_ras` to 5).

---

## 3. Swift Data Models

Add these structs. They are pure `Codable` value types — no SwiftData persistence needed
because both endpoints are cheap to re-fetch (static JSON / 1-hr cache on server).

```swift
// RegionModels.swift

import Foundation

// MARK: - Regions List
// Response of GET /api/events/regions/list
typealias RegionsList = [String]

// MARK: - Region Facts
// Response of GET /api/events/region/{name}/facts

struct RegionFacts: Codable {
    let firstEventYear: Int
    let firstEventName: String
    let activeYears: [Int]
    let totalEvents: Int
    let teamCount: Int
    let currentSeasonTeams: Int
    let activeYear: Int
    let officialTeamCount: Int?       // only present for FIRST districts

    let hofCount: Int
    let hofTeams: [RegionTeamEntry]

    let impactCount: Int
    let impactFinalists: [RegionTeamEntry]

    let einsteinWinnerCount: Int
    let einsteinWinners: [EinsteinWinnerEntry]

    let einsteinCount: Int
    let einsteinTeams: [RegionTeamEntry]

    let topInternationalVisitors: [RegionVisitorEntry]

    enum CodingKeys: String, CodingKey {
        case firstEventYear           = "first_event_year"
        case firstEventName           = "first_event_name"
        case activeYears              = "active_years"
        case totalEvents              = "total_events"
        case teamCount                = "team_count"
        case currentSeasonTeams       = "current_season_teams"
        case activeYear               = "active_year"
        case officialTeamCount        = "official_team_count"
        case hofCount                 = "hof_count"
        case hofTeams                 = "hof_teams"
        case impactCount              = "impact_count"
        case impactFinalists          = "impact_finalists"
        case einsteinWinnerCount      = "einstein_winner_count"
        case einsteinWinners          = "einstein_winners"
        case einsteinCount            = "einstein_count"
        case einsteinTeams            = "einstein_teams"
        case topInternationalVisitors = "top_international_visitors"
    }
}

struct RegionTeamEntry: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let years: [Int]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, years
    }
}

struct EinsteinWinnerEntry: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let years: [Int]
    let wins: [EinsteinWin]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, years, wins
    }
}

struct EinsteinWin: Codable {
    let year: Int
    let division: String

    enum CodingKeys: String, CodingKey {
        case year, division
    }
}

struct RegionVisitorEntry: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let country: String
    let appearances: Int

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, country, appearances
    }
}

// MARK: - Event History
// Response of GET /api/events/{event_key}/history

struct EventHistory: Codable {
    let eventName: String
    let eventKey: String
    let firstHeld: Int
    let editions: Int
    let yearsHeld: [Int]

    let mostWins: [HistoryLeaderboardEntry]
    let mostFinalists: [HistoryLeaderboardEntry]
    let mostImpact: [HistoryLeaderboardEntry]
    let mostEi: [HistoryLeaderboardEntry]
    let mostRas: [HistoryLeaderboardEntry]

    let timeline: [HistoryTimelineYear]

    enum CodingKeys: String, CodingKey {
        case eventName    = "event_name"
        case eventKey     = "event_key"
        case firstHeld    = "first_held"
        case editions
        case yearsHeld    = "years_held"
        case mostWins     = "most_wins"
        case mostFinalists = "most_finalists"
        case mostImpact   = "most_impact"
        case mostEi       = "most_ei"
        case mostRas      = "most_ras"
        case timeline
    }
}

struct HistoryLeaderboardEntry: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let count: Int

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, count
    }
}

struct HistoryTimelineYear: Codable, Identifiable {
    var id: Int { year }
    let year: Int
    let eventKey: String
    let winners: [HistoryTeamRef]
    let finalists: [HistoryTeamRef]
    let impact: HistoryTeamRef?    // null when no Impact Award was presented

    enum CodingKeys: String, CodingKey {
        case year
        case eventKey = "event_key"
        case winners, finalists, impact
    }
}

struct HistoryTeamRef: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname
    }
}
```

---

## 4. API Client Methods

Add these three methods wherever the existing backend calls live (e.g. `BackendClient.swift`
or whatever `APIClient` class already exists):

```swift
// Inside your BackendClient / APIClient

/// All known region names (sorted). Lightweight — backed by static JSON.
func fetchRegionsList() async throws -> [String] {
    try await get("/api/events/regions/list")
}

/// Pre-computed region facts for a named region. Lightweight — backed by static JSON.
/// - Parameter regionName: Exact string from `fetchRegionsList()`, e.g. "FIRST in Michigan"
func fetchRegionFacts(regionName: String) async throws -> RegionFacts {
    let encoded = regionName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? regionName
    return try await get("/api/events/region/\(encoded)/facts")
}

/// Full award history for a recurring event. Heavy — 1-hr cached on server.
/// Call once on event selection; do NOT poll.
/// - Parameter eventKey: TBA event key, e.g. "2026tuak"
func fetchEventHistory(eventKey: String) async throws -> EventHistory {
    try await get("/api/events/\(eventKey)/history")
}
```

---

## 5. Loading Pattern

Both region-facts and event-history are read-once / display-only.
Use a simple `@State` + `.task` pattern — no SwiftData persistence, no Realtime subscription.

```swift
// Example: EventHistoryView

struct EventHistoryView: View {
    let eventKey: String
    @State private var history: EventHistory?
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
            } else if let history {
                EventHistoryContent(history: history)
            } else if let errorMessage {
                ContentUnavailableView(errorMessage, systemImage: "exclamationmark.triangle")
            }
        }
        .task(id: eventKey) {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            history = try await BackendClient.shared.fetchEventHistory(eventKey: eventKey)
        } catch {
            errorMessage = "Could not load event history."
        }
        isLoading = false
    }
}
```

The same `.task(id:)` pattern works for `RegionFactsView` — swap `fetchEventHistory` for
`fetchRegionFacts(regionName:)` and drive the id from the selected region name.

---

## 6. Entry Points — Where to Trigger the Calls

| Where | Trigger | Call |
|-------|---------|------|
| Event detail view (header or dedicated tab) | `.task(id: eventKey)` | `fetchEventHistory(eventKey:)` |
| Region picker / browser | On `appear` once, then cache in-memory | `fetchRegionsList()` |
| Region detail view | `.task(id: regionName)` | `fetchRegionFacts(regionName:)` |

`fetchRegionsList()` and `fetchRegionFacts` are instant (static JSON on the server) so they
can be called on every navigation without concern.  
`fetchEventHistory` is heavy — the server caches it for 1 hour so the first call per event
may take 1–3 s; subsequent calls within the hour return immediately.

---

## 7. Error Cases

| HTTP Status | Meaning | Handle as |
|-------------|---------|-----------|
| `404` from `/region/.../facts` | Region name not in `region_stats.json` | Show "No data for this region" |
| `404` from `/{event_key}/history` | TBA doesn't know this event key | Show "Event not found" |
| `429` | Rate limited (heavy endpoint) | Back off; do not retry within 60 s |
| `5xx` | Backend error | Generic error message; do not retry automatically |

---

## 8. Notes for the Implementer

- **`region_name` is case-sensitive** — it must match a key from `fetchRegionsList()` exactly.
  Do not construct region names manually; always drive from the list endpoint.
- **Pre-district merge**: The static JSON already merges historical regional-era events into
  the district entry (e.g. "Michigan" data is inside "FIRST in Michigan"). No special handling
  needed on the client side.
- **`official_team_count` vs `team_count`**: For districts, prefer `official_team_count`
  (from the FIRST API) for display. Fall back to `team_count` for regions/non-districts.
- **Timeline is newest-first** — display as-is without reversing.
- **`impact` field on a timeline year can be `null`** — guard accordingly.
