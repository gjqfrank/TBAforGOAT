# Regional Pool — Complete Wiring Guide

> **Purpose**: Display the regional advancement pool — a ranked list of teams qualified (or vying) for the FIRST Championship via the regional pathway. Highlight teams by qualification method and pool standing.

---

## 1. API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/events/regional-pool/{season}` | Global pool — all qualified teams |
| `GET /api/events/regional-pool/{season}/{event_code}` | Per-event detail — teams at a specific regional |

**Example**: `/api/events/regional-pool/2026` returns all 2026 qualified regional teams.

---

## 2. Response Shapes

### 2a. Global Pool

```http
GET /api/events/regional-pool/2026
```

```json
{
  "season": 2026,
  "teams": [
    {
      "teamNumber": 254,
      "teamName": "The Cheesy Poofs",
      "qualifiedFirstCmp": true,
      "totalPoints": 125,
      "events": [
        {
          "eventCode": "CASF",
          "eventName": "San Francisco Regional",
          "qualPoints": 65,
          "isDistrictEvent": false,
          "eventRank": 1
        },
        {
          "eventCode": "CALA",
          "eventName": "Los Angeles Regional",
          "qualPoints": 60,
          "isDistrictEvent": false,
          "eventRank": 3
        }
      ],
      "qualLevel": "qualified",
      "qualMethod": "points"
    }
  ]
}
```

**Key Fields per Team**:
- `teamNumber`, `teamName` — identity
- `qualifiedFirstCmp` — boolean, whether they've qualified
- `totalPoints` — sum of advancement points across events
- `events[]` — each event they attended with points earned
- `qualLevel` — `"qualified"`, `"waitlist"`, or null
- `qualMethod` — `"points"`, `"chairman"` (Impact Award), `"wildcard"`, etc.

### 2b. Per-Event Detail

```http
GET /api/events/regional-pool/2026/CASF
```

Returns richer per-event data including team point breakdowns and event-specific rankings.

---

## 3. Data Models

```swift
struct RegionalPoolResponse: Codable {
    let season: Int
    let teams: [PoolTeam]
}

struct PoolTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let teamName: String
    let qualifiedFirstCmp: Bool
    let totalPoints: Int?
    let events: [PoolEvent]?
    let qualLevel: String?       // "qualified", "waitlist", null
    let qualMethod: String?      // "points", "chairman", "wildcard"
}

struct PoolEvent: Codable, Identifiable {
    var id: String { eventCode }
    let eventCode: String
    let eventName: String?
    let qualPoints: Int?
    let isDistrictEvent: Bool?
    let eventRank: Int?
}
```

---

## 4. View Implementation

### 4a. Main Pool View

```swift
struct RegionalPoolView: View {
    @Environment(BroadcastStore.self) private var store
    @State private var pool: RegionalPoolResponse?
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var sortBy: SortOption = .totalPoints

    enum SortOption: String, CaseIterable {
        case totalPoints = "Points"
        case teamNumber = "Team #"
        case qualLevel = "Status"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Sort picker
            Picker("Sort", selection: $sortBy) {
                ForEach(SortOption.allCases, id: \.self) { opt in
                    Text(opt.rawValue).tag(opt)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let pool {
                List(filteredTeams) { team in
                    PoolTeamRow(
                        team: team,
                        isAtCurrentEvent: isTeamAtEvent(team.teamNumber),
                        maxPoints: pool.teams.compactMap(\.totalPoints).max() ?? 1
                    )
                }
                .searchable(text: $searchText, prompt: "Search teams")
            } else {
                ContentUnavailableView("No Pool Data", systemImage: "list.bullet",
                    description: Text("Regional pool data is not available."))
            }
        }
        .navigationTitle("Regional Pool")
        .task { await loadPool() }
    }

    var filteredTeams: [PoolTeam] {
        guard let teams = pool?.teams else { return [] }
        var result = teams

        if !searchText.isEmpty {
            result = result.filter {
                $0.teamName.localizedCaseInsensitiveContains(searchText) ||
                String($0.teamNumber).contains(searchText)
            }
        }

        switch sortBy {
        case .totalPoints:
            result.sort { ($0.totalPoints ?? 0) > ($1.totalPoints ?? 0) }
        case .teamNumber:
            result.sort { $0.teamNumber < $1.teamNumber }
        case .qualLevel:
            result.sort { statusOrder($0) < statusOrder($1) }
        }
        return result
    }

    func statusOrder(_ team: PoolTeam) -> Int {
        if team.qualifiedFirstCmp { return 0 }
        if team.qualLevel == "waitlist" { return 1 }
        return 2
    }

    func isTeamAtEvent(_ teamNumber: Int) -> Bool {
        store.teams.contains { t in
            // Assumes store.teams has team_number field
            t.teamNumber == teamNumber
        }
    }

    func loadPool() async {
        isLoading = true
        let year = store.selectedEvent.flatMap { Int($0.prefix(4)) } ?? 2026
        guard let url = URL(string: "\(APIService.base)/events/regional-pool/\(year)") else {
            isLoading = false
            return
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            pool = try JSONDecoder().decode(RegionalPoolResponse.self, from: data)
        } catch {
            print("Failed to load regional pool: \(error)")
        }
        isLoading = false
    }
}
```

### 4b. Pool Team Row

```swift
struct PoolTeamRow: View {
    let team: PoolTeam
    let isAtCurrentEvent: Bool
    let maxPoints: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                // Team number
                Text("\(team.teamNumber)")
                    .font(.subheadline.bold().monospacedDigit())
                    .foregroundStyle(isAtCurrentEvent ? .blue : .primary)

                // Team name
                Text(team.teamName)
                    .font(.subheadline)
                    .lineLimit(1)

                Spacer()

                // Status badge
                statusBadge
            }

            // Event rows
            if let events = team.events, !events.isEmpty {
                HStack(spacing: 12) {
                    ForEach(events) { ev in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ev.eventCode)
                                .font(.caption2.bold())
                                .foregroundStyle(.secondary)
                            if let pts = ev.qualPoints {
                                Text("\(pts) pts")
                                    .font(.caption2.monospacedDigit())
                            }
                            if let rank = ev.eventRank {
                                Text("#\(rank)")
                                    .font(.caption2.monospacedDigit())
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }

                    Spacer()

                    // Total points
                    if let total = team.totalPoints {
                        VStack(alignment: .trailing) {
                            Text("\(total)")
                                .font(.headline.bold().monospacedDigit())
                            Text("total")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }

            // Points bar
            if let pts = team.totalPoints, maxPoints > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(.quaternary)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(barColor)
                            .frame(width: geo.size.width * CGFloat(pts) / CGFloat(maxPoints))
                    }
                }
                .frame(height: 4)
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(isAtCurrentEvent ? Color.blue.opacity(0.05) : nil)
    }

    private var barColor: Color {
        if team.qualifiedFirstCmp { return .green }
        if team.qualLevel == "waitlist" { return .orange }
        return .gray
    }

    @ViewBuilder private var statusBadge: some View {
        if team.qualifiedFirstCmp {
            HStack(spacing: 3) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                Text("Qualified")
                    .font(.caption2.bold())
            }
            .foregroundStyle(.green)
        } else if team.qualLevel == "waitlist" {
            HStack(spacing: 3) {
                Image(systemName: "clock")
                    .font(.caption2)
                Text("Waitlist")
                    .font(.caption2.bold())
            }
            .foregroundStyle(.orange)
        } else if let method = team.qualMethod {
            Text(method.capitalized)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}
```

---

## 5. Highlighting Teams at Current Event

Teams at the currently-loaded event should be **visually highlighted** so the caster can quickly spot which teams in the pool are present:

- **Row background**: Subtle blue tint (`.blue.opacity(0.05)`)
- **Team number**: Blue text instead of default
- **Optional**: Pin at-event teams to top with a section divider

```swift
// Alternative: Split into two sections
var atEventTeams: [PoolTeam] { filteredTeams.filter { isTeamAtEvent($0.teamNumber) } }
var otherTeams: [PoolTeam] { filteredTeams.filter { !isTeamAtEvent($0.teamNumber) } }

List {
    if !atEventTeams.isEmpty {
        Section("At This Event") {
            ForEach(atEventTeams) { team in
                PoolTeamRow(team: team, isAtCurrentEvent: true, maxPoints: maxPts)
            }
        }
    }
    Section(atEventTeams.isEmpty ? "All Teams" : "Other Teams") {
        ForEach(otherTeams) { team in
            PoolTeamRow(team: team, isAtCurrentEvent: false, maxPoints: maxPts)
        }
    }
}
```

---

## 6. Qualification Method Icons

| Method | Icon | Color |
|--------|------|-------|
| `points` | `star.fill` | Yellow |
| `chairman` / `impact` | `medal.fill` | Gold |
| `wildcard` | `ticket.fill` | Purple |
| `engineering` | `gearshape.fill` | Gray |
| `rookie` | `sparkles` | Green |

---

## 7. Gotchas

1. **FRC-only**: Regional pool does not exist for FTC. Hide or disable this tab for FTC events.
2. **Season year**: Extract from event key (`Int(eventKey.prefix(4))`) — don't hardcode.
3. **Event code format**: The per-event endpoint uses the event code without year prefix (e.g. `CASF` not `2026casf`).
4. **Points may be nil**: Not all teams have `totalPoints` or `events` populated. Handle nil gracefully.
5. **Cache**: Backend caches for 5 minutes. Client-side, cache for 5+ minutes too.
6. **Large list**: Pool can be 200+ teams. Use `List` with lazy loading, not `LazyVStack` in `ScrollView`.
7. **qualifiedFirstCmp**: This is the definitive boolean for "qualified." `qualLevel` and `qualMethod` provide extra context.
