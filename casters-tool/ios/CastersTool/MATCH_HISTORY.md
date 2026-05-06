# Match History — iOS Blueprint

> **Purpose**: Present a team's match-by-match performance at the current event in a modal sheet. Covers summary stats, game-specific tower distribution (2026+), and a scrollable per-match table with tappable team numbers.

---

## 1. Entry Points

Match History opens from multiple locations. All paths funnel into the same `MatchHistorySheet`.

| Trigger | How |
|---|---|
| Rankings tab — row long-press context menu | "Match History" context action |
| PbP tab — team card long-press | "Match History" context action |
| Breakdown spotlight panel — team row | "View Match History" button |
| Compare bar (single selection) | "Matches" button in the floating bar |

```swift
// Any entry point sets these two values on the store and flips the flag
store.matchHistoryTeam = teamNumber   // Int
store.matchHistoryNick  = nickname    // String?
store.showMatchHistory  = true
```

The sheet is attached at the root navigator level so it can be triggered from any tab:

```swift
.sheet(isPresented: $store.showMatchHistory) {
    MatchHistorySheet(
        teamNumber: store.matchHistoryTeam,
        nick: store.matchHistoryNick
    )
    .environment(store)
}
```

---

## 2. API Endpoint

### FRC mode

```
GET /api/matches/team-perf/{event_key}/{team_number}
```

Called with `store.currentEventKey` and `teamNumber`. Load on sheet appear.

### FTC mode

When `store.isFTCMode == true`, **skip the network call**. Build the performance object locally by filtering `store.pbpData.matches` for the team — mirror the web's `_buildFtcTeamPerf` logic (see §7).

---

## 3. Response Shape

```json
{
  "team_number": 254,
  "event_key": "2026tuak",
  "season": 2026,
  "matches_played": 12,
  "record": { "wins": 10, "losses": 2, "ties": 0 },
  "avg_alliance_score": 88.4,
  "autoTower": {
    "total": 12, "active": 10, "activeRate": 83,
    "avgLevel": 2.1, "maxLevel": 3,
    "distribution": { "1": 2, "2": 5, "3": 3 }
  },
  "endGameTower": {
    "total": 12, "active": 11, "activeRate": 92,
    "avgLevel": 2.5, "maxLevel": 3,
    "distribution": { "1": 1, "2": 4, "3": 6 }
  },
  "matches": [
    {
      "description": "Qual 1",
      "matchLevel": "Qualification",
      "matchNumber": 1,
      "station": "Red2",
      "allianceColor": "Red",
      "robotIndex": 2,
      "result": "W",
      "allianceScore": 96,
      "opponentScore": 72,
      "allianceTeams": [1678, 3476],
      "opponentTeams": [148, 1114, 2056],
      "autoTower": "Level2",
      "endGameTower": "Level3",
      "allianceHub": { "autoFuel": 4, "teleopFuel": 18, "totalFuel": 22 },
      "dq": false
    }
  ]
}
```

**Result values**: `"W"` / `"L"` / `"T"` / `"?"` (unplayed or no score).

**Tower values**: `"None"` / `"Level1"` / `"Level2"` / `"Level3"` / `"N/A"` (pre-2026 or data missing).

---

## 4. Swift Models

```swift
struct TeamPerfResponse: Codable {
    let teamNumber: Int
    let eventKey: String
    let season: Int
    let matchesPlayed: Int
    let record: MatchRecord
    let avgAllianceScore: Double
    let autoTower: TowerSummary?
    let endGameTower: TowerSummary?
    let matches: [MatchPerfEntry]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case eventKey   = "event_key"
        case season
        case matchesPlayed  = "matches_played"
        case record
        case avgAllianceScore = "avg_alliance_score"
        case autoTower    = "autoTower"
        case endGameTower = "endGameTower"
        case matches
    }
}

struct MatchRecord: Codable {
    let wins: Int
    let losses: Int
    let ties: Int

    var formatted: String {
        ties > 0 ? "\(wins)-\(losses)-\(ties)" : "\(wins)-\(losses)"
    }
    var winPct: Int {
        let total = wins + losses + ties
        guard total > 0 else { return 0 }
        return Int((Double(wins) / Double(total)) * 100)
    }
}

struct TowerSummary: Codable {
    let total: Int
    let active: Int
    let activeRate: Int
    let avgLevel: Double
    let maxLevel: Int
    let distribution: [String: Int]  // "1", "2", "3" → count
}

struct MatchPerfEntry: Codable, Identifiable {
    var id: String { "\(matchLevel)-\(matchNumber)" }
    let description: String
    let matchLevel: String
    let matchNumber: Int
    let station: String
    let allianceColor: String   // "Red" | "Blue"
    let robotIndex: Int
    let result: String          // "W" | "L" | "T" | "?"
    let allianceScore: Int?
    let opponentScore: Int?
    let allianceTeams: [Int]
    let opponentTeams: [Int]
    let autoTower: String
    let endGameTower: String
    let allianceHub: HubContribution?
    let dq: Bool

    enum CodingKeys: String, CodingKey {
        case description, matchLevel, matchNumber, station
        case allianceColor, robotIndex, result
        case allianceScore, opponentScore
        case allianceTeams, opponentTeams
        case autoTower, endGameTower, allianceHub, dq
    }

    var isRed: Bool { allianceColor == "Red" }

    /// Short display label: "Qual 1", "Playoff 3", etc.
    var shortLabel: String {
        description
            .replacingOccurrences(of: "Qualification ", with: "Qual ")
    }
}

struct HubContribution: Codable {
    let autoFuel: Int
    let teleopFuel: Int
    let totalFuel: Int
}
```

---

## 5. BroadcastStore Additions

```swift
// In BroadcastStore
var showMatchHistory: Bool = false
var matchHistoryTeam: Int = 0
var matchHistoryNick: String? = nil
```

---

## 6. Sheet View Structure

```
MatchHistorySheet
├── NavigationStack
│   ├── toolbar: close button (dismiss)
│   └── ScrollView
│       ├── SummaryStatsRow          (record, win %, matches, avg pts)
│       ├── TowerDistributionSection  (2026+ only — Auto + Endgame)
│       └── MatchTable               (one MatchRow per match entry)
```

### 6a. Sheet Container

```swift
struct MatchHistorySheet: View {
    let teamNumber: Int
    let nick: String?

    @Environment(BroadcastStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var perf: TeamPerfResponse? = nil
    @State private var isLoading = true
    @State private var error: String? = nil

    var title: String {
        var t = "Match History · \(teamNumber)"
        if let n = nick, !n.isEmpty { t += " — \(n)" }
        return t
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView("Error", systemImage: "exclamationmark.triangle", description: Text(error))
                } else if let perf, perf.matchesPlayed > 0 {
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            SummaryStatsRow(perf: perf)
                            if let auto = perf.autoTower, let end = perf.endGameTower, perf.season >= 2026 {
                                TowerDistributionSection(auto: auto, endGame: end)
                            }
                            MatchTable(matches: perf.matches, store: store)
                        }
                        .padding()
                    }
                } else {
                    ContentUnavailableView("No Matches", systemImage: "clock", description: Text("No matches played yet."))
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            if store.isFTCMode {
                perf = buildFTCPerf(teamNumber: teamNumber, store: store)
            } else {
                perf = try await APIClient.shared.teamPerf(
                    eventKey: store.currentEventKey,
                    teamNumber: teamNumber
                )
            }
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
```

---

### 6b. Summary Stats Row

Four stats in a horizontal grid: record, win %, matches played, avg alliance pts.

```swift
struct SummaryStatsRow: View {
    let perf: TeamPerfResponse

    var body: some View {
        HStack(spacing: 0) {
            StatCell(value: perf.record.formatted,   label: "Record")
            StatCell(value: "\(perf.record.winPct)%", label: "Win Rate")
            StatCell(value: "\(perf.matchesPlayed)", label: "Matches")
            StatCell(value: String(format: "%.1f", perf.avgAllianceScore), label: "Avg Pts")
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct StatCell: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.bold().monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}
```

---

### 6c. Tower Distribution Section (2026+)

Show Auto Tower and Endgame Tower chip counts side by side. Only rendered when `season >= 2026` and both tower summaries exist.

```swift
struct TowerDistributionSection: View {
    let auto: TowerSummary
    let endGame: TowerSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Tower Distribution")
                .font(.footnote.bold())
                .foregroundStyle(.secondary)
                .textCase(.uppercase)

            TowerRow(label: "Auto Tower",    summary: auto)
            TowerRow(label: "Endgame Tower", summary: endGame)
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct TowerRow: View {
    let label: String
    let summary: TowerSummary

    var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 100, alignment: .leading)

            let dist = summary.distribution
            if dist.isEmpty || (dist["1"] == nil && dist["2"] == nil && dist["3"] == nil) {
                Text("–")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else {
                HStack(spacing: 4) {
                    if let c = dist["1"], c > 0 { TowerChip(level: 1, count: c) }
                    if let c = dist["2"], c > 0 { TowerChip(level: 2, count: c) }
                    if let c = dist["3"], c > 0 { TowerChip(level: 3, count: c) }
                }
            }
        }
    }
}

struct TowerChip: View {
    let level: Int
    let count: Int

    // L1 = green, L2 = blue, L3 = purple — match web colour scheme
    private var color: Color {
        switch level {
        case 1: .green
        case 2: .blue
        case 3: .purple
        default: .gray
        }
    }

    var body: some View {
        Text("L\(level) \(count)")
            .font(.caption2.bold())
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }
}
```

---

### 6d. Match Table

```swift
struct MatchTable: View {
    let matches: [MatchPerfEntry]
    let store: BroadcastStore

    var body: some View {
        VStack(spacing: 0) {
            // Header row
            HStack(spacing: 0) {
                Text("Match").frame(width: 70, alignment: .leading)
                Spacer()
                Text("").frame(width: 10)   // alliance dot
                Spacer()
                Text("").frame(width: 28)   // result badge
                Spacer()
                Text("Score").frame(width: 80, alignment: .center)
                Spacer()
                Text("Alliance").frame(minWidth: 60, alignment: .center)
                Spacer()
                Text("Opponents").frame(minWidth: 60, alignment: .center)
            }
            .font(.caption2.bold())
            .foregroundStyle(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .textCase(.uppercase)

            Divider()

            ForEach(matches) { match in
                MatchRow(match: match, store: store)
                if match.id != matches.last?.id { Divider().opacity(0.4) }
            }
        }
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

---

### 6e. Match Row

```swift
struct MatchRow: View {
    let match: MatchPerfEntry
    let store: BroadcastStore

    var body: some View {
        HStack(spacing: 4) {
            // Match label
            Text(match.shortLabel)
                .font(.caption.monospacedDigit())
                .frame(width: 70, alignment: .leading)
                .lineLimit(1)

            // Alliance colour dot
            Circle()
                .fill(match.isRed ? .red : .blue)
                .frame(width: 7, height: 7)

            // Result badge
            ResultBadge(result: match.result)
                .frame(width: 28)

            // Score
            ScoreCell(match: match)
                .frame(width: 80)

            // Alliance partners
            TeamPillGroup(teams: match.allianceTeams, isRed: match.isRed, store: store)

            Spacer()

            // Opponents
            TeamPillGroup(teams: match.opponentTeams, isRed: !match.isRed, store: store)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }
}

struct ResultBadge: View {
    let result: String

    private var color: Color {
        switch result {
        case "W": .green
        case "L": .red
        case "T": .yellow
        default:  .gray
        }
    }

    var body: some View {
        Text(result)
            .font(.caption2.bold())
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(color.opacity(0.2), in: RoundedRectangle(cornerRadius: 4))
            .foregroundStyle(color)
    }
}

struct ScoreCell: View {
    let match: MatchPerfEntry

    var body: some View {
        if let ally = match.allianceScore, let opp = match.opponentScore {
            HStack(spacing: 2) {
                Text("\(ally)")
                    .foregroundStyle(match.result == "W" ? .primary : .secondary)
                    .fontWeight(match.result == "W" ? .bold : .regular)
                Text("–").foregroundStyle(.tertiary)
                Text("\(opp)")
                    .foregroundStyle(match.result == "L" ? .primary : .secondary)
                    .fontWeight(match.result == "L" ? .bold : .regular)
            }
            .font(.caption.monospacedDigit())
        } else {
            Text("–")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}

/// Horizontal row of tappable team number chips.
/// Tapping a chip closes Match History and opens that team's Lookup.
struct TeamPillGroup: View {
    let teams: [Int]
    let isRed: Bool
    let store: BroadcastStore

    var body: some View {
        HStack(spacing: 3) {
            ForEach(teams, id: \.self) { num in
                Button {
                    store.showMatchHistory = false
                    // Small delay so the sheet dismissal animates cleanly
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                        store.selectedTeamNumber = num
                        store.showTeamLookup = true
                    }
                } label: {
                    Text("\(num)")
                        .font(.caption2.monospacedDigit())
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background((isRed ? Color.red : Color.blue).opacity(0.18),
                                    in: RoundedRectangle(cornerRadius: 4))
                        .foregroundStyle(isRed ? .red : .blue)
                }
                .buttonStyle(.plain)
            }
        }
    }
}
```

---

## 7. FTC Mode — Local Perf Build

When `store.isFTCMode == true`, skip the API call and compute from `store.pbpData.matches`:

```swift
func buildFTCPerf(teamNumber: Int, store: BroadcastStore) -> TeamPerfResponse {
    let matches = store.pbpData?.matches ?? []
    let teamMatches = matches.filter { m in
        (m.red?.teams ?? []).contains { $0.teamNumber == teamNumber } ||
        (m.blue?.teams ?? []).contains { $0.teamNumber == teamNumber }
    }

    var wins = 0, losses = 0, ties = 0, totalScore = 0
    var entries: [MatchPerfEntry] = []

    for m in teamMatches {
        let redTeams  = m.red?.teams ?? []
        let blueTeams = m.blue?.teams ?? []
        let onRed     = redTeams.contains { $0.teamNumber == teamNumber }
        let myAlliance  = onRed ? redTeams  : blueTeams
        let oppAlliance = onRed ? blueTeams : redTeams
        let myScore   = onRed ? (m.red?.score ?? 0)  : (m.blue?.score ?? 0)
        let oppScore  = onRed ? (m.blue?.score ?? 0) : (m.red?.score ?? 0)

        let result: String
        if myScore > oppScore { result = "W"; wins += 1 }
        else if myScore < oppScore { result = "L"; losses += 1 }
        else { result = "T"; ties += 1 }
        totalScore += myScore

        let partners = myAlliance.compactMap { $0.teamNumber == teamNumber ? nil : $0.teamNumber }
        let opps     = oppAlliance.compactMap { $0.teamNumber }
        let desc     = (m.label ?? m.matchKey ?? "").replacingOccurrences(of: "Qualification ", with: "Qual ")

        entries.append(MatchPerfEntry(
            description:   desc,
            matchLevel:    m.compLevel == "qm" ? "Qualification" : "Playoff",
            matchNumber:   m.matchNumber ?? 0,
            station:       onRed ? "Red" : "Blue",
            allianceColor: onRed ? "Red" : "Blue",
            robotIndex:    1,
            result:        result,
            allianceScore: myScore,
            opponentScore: oppScore,
            allianceTeams: partners,
            opponentTeams: opps,
            autoTower:     "N/A",
            endGameTower:  "N/A",
            allianceHub:   nil,
            dq:            false
        ))
    }

    let avg = teamMatches.isEmpty ? 0.0 : Double(totalScore) / Double(teamMatches.count)
    return TeamPerfResponse(
        teamNumber:       teamNumber,
        eventKey:         store.currentEventKey,
        season:           store.currentYear,
        matchesPlayed:    teamMatches.count,
        record:           MatchRecord(wins: wins, losses: losses, ties: ties),
        avgAllianceScore: (avg * 10).rounded() / 10,
        autoTower:        nil,
        endGameTower:     nil,
        matches:          entries
    )
}
```

---

## 8. APIClient Addition

```swift
extension APIClient {
    func teamPerf(eventKey: String, teamNumber: Int) async throws -> TeamPerfResponse {
        try await get("/matches/team-perf/\(eventKey)/\(teamNumber)")
    }
}
```

---

## 9. Context Menu Wiring

Add to any view that shows a team (rankings row, PbP team card, etc.):

```swift
.contextMenu {
    Button {
        store.matchHistoryTeam = team.teamNumber
        store.matchHistoryNick = team.nickname
        store.showMatchHistory = true
    } label: {
        Label("Match History", systemImage: "clock")
    }
    // ... other actions
}
```

---

## 10. Edge Cases

| Scenario | Behaviour |
|---|---|
| `matches_played == 0` | Show `ContentUnavailableView("No Matches")` |
| `result == "?"` | Result badge shows `?` in gray; score cells show `–` |
| `allianceScore == null` | Score cell shows `–` |
| `season < 2026` | Tower section hidden entirely |
| `autoTower == "N/A"` | FTC mode; tower section already hidden |
| Network error | Show `ContentUnavailableView` with error message; no retry button (user can dismiss and re-open) |
| `dq == true` | Optionally grey out the row or append `(DQ)` to the result badge |

---

## 11. Files to Create / Modify

| File | Action |
|---|---|
| `MatchHistorySheet.swift` | **Create** — sheet container + summary row |
| `MatchRow.swift` | **Create** — per-match row components |
| `TowerDistributionSection.swift` | **Create** — 2026 tower chips |
| `BroadcastStore.swift` | **Modify** — add `showMatchHistory`, `matchHistoryTeam`, `matchHistoryNick` |
| `APIClient.swift` | **Modify** — add `teamPerf(eventKey:teamNumber:)` |
| `RootView.swift` (or wherever sheets live) | **Modify** — attach `.sheet(isPresented: $store.showMatchHistory)` |
| Any team-displaying view (Rankings, PbP) | **Modify** — add context menu item |
