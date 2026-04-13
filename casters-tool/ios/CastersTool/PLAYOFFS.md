# Playoffs Tab — Complete Wiring Guide (Alliances + Bracket Tree)

> **Purpose**: The Playoffs tab merges the old separate Alliances and Playoffs views into a single tab with **two sub-navigation segments**: "Alliances" and "Tree". This document covers both.

---

## 1. Tab Structure

```swift
struct PlayoffsView: View {
    @Environment(BroadcastStore.self) private var store
    @State private var selectedSegment: PlayoffSegment = .alliances

    enum PlayoffSegment: String, CaseIterable {
        case alliances = "Alliances"
        case tree = "Bracket"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Sub-nav picker
            Picker("View", selection: $selectedSegment) {
                ForEach(PlayoffSegment.allCases, id: \.self) { seg in
                    Text(seg.rawValue).tag(seg)
                }
            }
            .pickerStyle(.segmented)
            .padding()

            switch selectedSegment {
            case .alliances:
                AlliancesSubView()
            case .tree:
                BracketTreeSubView()
            }
        }
        .navigationTitle("Playoffs")
    }
}
```

---

## 2. API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /api/alliances/{event_key}` | Alliance selection data + per-team stats |
| `GET /api/matches/{event_key}/all` | All matches including playoff with bracket metadata |

---

## 3. Alliance Data Shape

```json
{
  "alliances": [
    {
      "number": 1,
      "name": "Alliance 1",
      "teams": [
        {
          "team_key": "frc254",
          "team_number": 254,
          "nickname": "The Cheesy Poofs",
          "rank": 1,
          "record": "10-2-0",
          "opr": 55.2,
          "epa": 60.1,
          "epa_auto": 20.0,
          "epa_teleop": 30.0,
          "epa_endgame": 10.0,
          "avatar": "base64_or_url"
        }
      ],
      "combined_opr": 110.4,
      "combined_epa": 120.2,
      "combined_epa_auto": 40.0,
      "combined_epa_teleop": 60.0,
      "combined_epa_endgame": 20.0,
      "playoff_result": "Winner",
      "playoff_type": "winner",
      "playoff_record": "3-0"
    }
  ],
  "partnerships": {
    "frc254+frc1678": {
      "history": [
        { "year": 2024, "event_name": "Sacramento Regional" }
      ]
    }
  },
  "max_combined_opr": 110.4
}
```

### Codable Models

```swift
struct AlliancesResponse: Codable {
    let alliances: [Alliance]
    let partnerships: [String: Partnership]?
    let maxCombinedOpr: Double?

    enum CodingKeys: String, CodingKey {
        case alliances, partnerships
        case maxCombinedOpr = "max_combined_opr"
    }
}

struct Alliance: Codable, Identifiable {
    var id: Int { number }
    let number: Int
    let name: String
    let teams: [AllianceTeam]
    let combinedOpr: Double?
    let combinedEpa: Double?
    let combinedEpaAuto: Double?
    let combinedEpaTeleop: Double?
    let combinedEpaEndgame: Double?
    let playoffResult: String?       // "Winner", "Finalist", null
    let playoffType: String?         // "winner", "finalist", null
    let playoffRecord: String?       // "3-0"

    enum CodingKeys: String, CodingKey {
        case number, name, teams
        case combinedOpr = "combined_opr"
        case combinedEpa = "combined_epa"
        case combinedEpaAuto = "combined_epa_auto"
        case combinedEpaTeleop = "combined_epa_teleop"
        case combinedEpaEndgame = "combined_epa_endgame"
        case playoffResult = "playoff_result"
        case playoffType = "playoff_type"
        case playoffRecord = "playoff_record"
    }
}

struct AllianceTeam: Codable, Identifiable {
    var id: String { teamKey }
    let teamKey: String
    let teamNumber: Int
    let nickname: String
    let rank: Int?
    let record: String?
    let opr: Double?
    let epa: Double?
    let epaAuto: Double?
    let epaTeleop: Double?
    let epaEndgame: Double?
    let avatar: String?

    enum CodingKeys: String, CodingKey {
        case teamKey = "team_key"
        case teamNumber = "team_number"
        case nickname, rank, record, opr, epa
        case epaAuto = "epa_auto"
        case epaTeleop = "epa_teleop"
        case epaEndgame = "epa_endgame"
        case avatar
    }
}

struct Partnership: Codable {
    let history: [PartnershipEvent]
}

struct PartnershipEvent: Codable {
    let year: Int
    let eventName: String

    enum CodingKeys: String, CodingKey {
        case year
        case eventName = "event_name"
    }
}
```

---

## 4. Alliances Sub-View

### 4a. Layout

8 alliance cards in a scrollable list. Each card shows:
1. Alliance number + playoff result ribbon
2. Combined stats (OPR, EPA)
3. Strength bar
4. Team rows (Captain, 1st Pick, 2nd Pick, optional 3rd Pick / Backup)
5. Partnerships badges

### 4b. Alliance Card

```swift
struct AllianceCard: View {
    let alliance: Alliance
    let maxOpr: Double
    let partnerships: [String: Partnership]

    @AppStorage("playoff_showEpa") private var showEpa = true
    @AppStorage("playoff_showAvatars") private var showAvatars = true

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // ── Header: Alliance # + Playoff ribbon ──
            HStack {
                Text("Alliance \(alliance.number)")
                    .font(.headline.bold())

                Spacer()

                if let result = alliance.playoffResult {
                    HStack(spacing: 4) {
                        Image(systemName: result == "Winner" ? "trophy.fill" : "medal.fill")
                            .font(.caption)
                        Text(result)
                            .font(.caption.bold())
                        if let record = alliance.playoffRecord {
                            Text("(\(record))")
                                .font(.caption2)
                        }
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(result == "Winner" ? Color.yellow.opacity(0.8) : .gray, in: Capsule())
                }
            }

            // ── Combined stats row ──
            HStack(spacing: 16) {
                if let opr = alliance.combinedOpr {
                    StatLabel(label: "Σ OPR", value: String(format: "%.1f", opr))
                }
                if showEpa, let epa = alliance.combinedEpa {
                    StatLabel(label: "Σ EPA", value: String(format: "%.1f", epa))
                }
            }

            // ── EPA breakdown (optional) ──
            if showEpa, let auto = alliance.combinedEpaAuto,
               let teleop = alliance.combinedEpaTeleop,
               let endgame = alliance.combinedEpaEndgame {
                HStack(spacing: 12) {
                    EPABar(label: "Auto", value: auto, total: alliance.combinedEpa ?? 1)
                    EPABar(label: "Teleop", value: teleop, total: alliance.combinedEpa ?? 1)
                    EPABar(label: "Endgame", value: endgame, total: alliance.combinedEpa ?? 1)
                }
            }

            // ── Strength bar ──
            if let opr = alliance.combinedOpr, maxOpr > 0 {
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(.quaternary)
                        RoundedRectangle(cornerRadius: 4)
                            .fill(.blue.gradient)
                            .frame(width: geo.size.width * min(opr / maxOpr, 1.0))
                    }
                }
                .frame(height: 6)
            }

            // ── Team rows ──
            ForEach(Array(alliance.teams.enumerated()), id: \.element.id) { index, team in
                AllianceTeamRow(
                    team: team,
                    role: pickRole(index: index, total: alliance.teams.count),
                    showAvatars: showAvatars,
                    showEpa: showEpa
                )
                if index < alliance.teams.count - 1 { Divider() }
            }

            // ── Partnerships ──
            let pairs = findPartnerships(for: alliance)
            if !pairs.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(pairs, id: \.key) { pair in
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.caption2)
                            Text(pair.label)
                                .font(.caption2)
                            Text("(\(pair.count)×)")
                                .font(.caption2.bold())
                        }
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    func pickRole(index: Int, total: Int) -> String {
        switch index {
        case 0: "Captain"
        case 1: "1st Pick"
        case 2: "2nd Pick"
        case 3 where total > 4: "3rd Pick"
        case 3: "Backup"
        default: "Backup"
        }
    }

    struct PartnerPair: Identifiable {
        let key: String
        let label: String
        let count: Int
        var id: String { key }
    }

    func findPartnerships(for alliance: Alliance) -> [PartnerPair] {
        var result: [PartnerPair] = []
        let teamKeys = alliance.teams.map(\.teamKey).sorted()

        for i in 0..<teamKeys.count {
            for j in (i+1)..<teamKeys.count {
                let key = "\(teamKeys[i])+\(teamKeys[j])"
                if let p = partnerships[key], !p.history.isEmpty {
                    let nums = [teamKeys[i], teamKeys[j]]
                        .map { $0.replacingOccurrences(of: "frc", with: "") }
                    result.append(PartnerPair(
                        key: key,
                        label: "\(nums[0]) + \(nums[1])",
                        count: p.history.count
                    ))
                }
            }
        }
        return result
    }
}
```

### 4c. Alliance Team Row

```swift
struct AllianceTeamRow: View {
    let team: AllianceTeam
    let role: String
    let showAvatars: Bool
    let showEpa: Bool

    var body: some View {
        HStack(spacing: 8) {
            // Role label
            Text(role)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(width: 55, alignment: .leading)

            // Avatar
            if showAvatars {
                if let avatar = team.avatar, !avatar.isEmpty,
                   let data = Data(base64Encoded: avatar),
                   let img = UIImage(data: data) {
                    Image(uiImage: img)
                        .resizable()
                        .frame(width: 24, height: 24)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                } else {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(.quaternary)
                        .frame(width: 24, height: 24)
                }
            }

            // Number + name
            VStack(alignment: .leading, spacing: 1) {
                Text("\(team.teamNumber)")
                    .font(.subheadline.bold().monospacedDigit())
                Text(team.nickname)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // Stats
            HStack(spacing: 12) {
                if let rank = team.rank {
                    Text("#\(rank)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(rank <= 8 ? .orange : .secondary)
                }
                if let record = team.record {
                    Text(record)
                        .font(.caption.monospacedDigit())
                }
                if let opr = team.opr {
                    Text(String(format: "%.1f", opr))
                        .font(.caption.monospacedDigit())
                }
                if showEpa, let epa = team.epa {
                    Text(String(format: "%.1f", epa))
                        .font(.caption.monospacedDigit())
                }
            }
        }
    }
}
```

### 4d. Alliances Settings

```swift
.toolbar {
    ToolbarItem(placement: .secondaryAction) {
        Menu {
            Toggle("Show EPA Breakdown", isOn: $showEpa)
            Toggle("Show Avatars", isOn: $showAvatars)
        } label: {
            Image(systemName: "slider.horizontal.3")
        }
    }
}
```

---

## 5. Bracket Tree Sub-View

### 5a. FRC Double-Elimination Bracket Map

The backend uses this exact mapping of `set_number` → bracket position:

| Set # | Round | Bracket | Description |
|-------|-------|---------|-------------|
| 1 | Round 1 | Upper | #1 vs #8 |
| 2 | Round 1 | Upper | #4 vs #5 |
| 3 | Round 1 | Upper | #2 vs #7 |
| 4 | Round 1 | Upper | #3 vs #6 |
| 5 | Round 2 | Lower | Loser 1 vs Loser 2 |
| 6 | Round 2 | Lower | Loser 3 vs Loser 4 |
| 7 | Round 2 | Upper | Winner 1 vs Winner 2 |
| 8 | Round 2 | Upper | Winner 3 vs Winner 4 |
| 9 | Round 3 | Lower | Winner 5 vs Loser 8 |
| 10 | Round 3 | Lower | Winner 6 vs Loser 7 |
| 11 | Round 4 | Upper | Winner 7 vs Winner 8 (Upper Final) |
| 12 | Round 4 | Lower | Winner 9 vs Winner 10 |
| 13 | Round 5 | Lower | Loser 11 vs Winner 12 (Lower Final) |
| f | Finals | Finals | Winner 11 vs Winner 13 (Best of 3) |

Each match has:
- `bracket`: `"upper"`, `"lower"`, or `"final"` (from backend)
- `set_number`: identifies the slot
- `match_number`: for replays within a set (1, 2, 3)

### 5b. Match Data Shape (Playoff Matches)

From `GET /api/matches/{event_key}/all`, each playoff match includes:
```json
{
  "key": "2026tuak_sf1m1",
  "comp_level": "sf",
  "match_number": 1,
  "set_number": 1,
  "label": "Round 1 (Upper) Match 1",
  "bracket": "upper",
  "red": {
    "teams": [{ "team_key": "frc254", "team_number": 254, "nickname": "..." }],
    "score": 150,
    "alliance_number": 1
  },
  "blue": {
    "teams": [{ "team_key": "frc1678", "team_number": 1678, "nickname": "..." }],
    "score": 130,
    "alliance_number": 8
  },
  "winning_alliance": "red"
}
```

### 5c. Building the Bracket Grid

```swift
struct BracketTreeSubView: View {
    @Environment(BroadcastStore.self) private var store
    @State private var matchesBySet: [Int: [CachedMatch]] = [:]  // set_number -> matches
    @State private var finalsMatches: [CachedMatch] = []

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(spacing: 0) {
                // Header row: Round labels
                bracketHeader

                // Upper bracket row
                HStack(alignment: .top, spacing: 2) {
                    Text("Upper")
                        .font(.caption2.bold())
                        .rotationEffect(.degrees(-90))
                        .frame(width: 20)

                    roundColumn(sets: [1, 2, 3, 4], label: "R1")    // Round 1 Upper
                    roundColumn(sets: [7, 8], label: "R2")            // Round 2 Upper
                    Spacer().frame(width: slotWidth)                  // Round 3 empty
                    roundColumn(sets: [11], label: "R4")              // Round 4 Upper
                    Spacer().frame(width: slotWidth)                  // Round 5 empty

                    // Finals column (spans both rows)
                    finalsColumn
                }

                Divider()

                // Lower bracket row
                HStack(alignment: .top, spacing: 2) {
                    Text("Lower")
                        .font(.caption2.bold())
                        .rotationEffect(.degrees(-90))
                        .frame(width: 20)

                    Spacer().frame(width: slotWidth)                  // Round 1 empty
                    roundColumn(sets: [5, 6], label: "R2")            // Round 2 Lower
                    roundColumn(sets: [9, 10], label: "R3")           // Round 3 Lower
                    roundColumn(sets: [12], label: "R4")              // Round 4 Lower
                    roundColumn(sets: [13], label: "R5")              // Round 5 Lower
                }
            }
            .padding()
        }
        .onAppear { buildMatchMap() }
        .onChange(of: store.matches) { _, _ in buildMatchMap() }
    }

    let slotWidth: CGFloat = 160

    func buildMatchMap() {
        var map: [Int: [CachedMatch]] = [:]
        var finals: [CachedMatch] = []

        for match in store.matches where match.compLevel == "sf" || match.compLevel == "f" {
            if match.compLevel == "f" {
                finals.append(match)
            } else {
                map[match.setNumber, default: []].append(match)
            }
        }

        // Sort each set by match_number, keep latest replay
        for (set, matches) in map {
            map[set] = matches.sorted { $0.matchNumber < $1.matchNumber }
        }
        finals.sort { $0.matchNumber < $1.matchNumber }

        matchesBySet = map
        finalsMatches = finals
    }
}
```

### 5d. Match Slot

```swift
struct BracketSlot: View {
    let setNumber: Int
    let matches: [CachedMatch]?
    let description: String?

    var body: some View {
        VStack(spacing: 4) {
            if let matches, let latest = matches.last {
                // Header: slot label + replay badge
                HStack {
                    Text("M\(setNumber)")
                        .font(.caption2.bold())
                        .foregroundStyle(.secondary)
                    Spacer()
                    if latest.matchNumber > 1 {
                        Text("R\(latest.matchNumber)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.orange, in: Capsule())
                    }
                }

                // Red row
                allianceRow(
                    teams: latest.redTeamKeys,
                    score: latest.redScore,
                    seed: latest.alliances?.red?.allianceNumber,
                    isWinner: latest.winningAlliance == "red",
                    color: .red
                )

                // Blue row
                allianceRow(
                    teams: latest.blueTeamKeys,
                    score: latest.blueScore,
                    seed: latest.alliances?.blue?.allianceNumber,
                    isWinner: latest.winningAlliance == "blue",
                    color: .blue
                )
            } else {
                // TBD slot
                VStack(spacing: 4) {
                    Text("M\(setNumber)")
                        .font(.caption2.bold())
                        .foregroundStyle(.secondary)
                    Text("TBD")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    if let desc = description {
                        Text(desc)
                            .font(.caption2)
                            .foregroundStyle(.quaternary)
                    }
                }
            }
        }
        .frame(width: 155)
        .padding(8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    func allianceRow(teams: [String], score: Int?, seed: Int?, isWinner: Bool, color: Color) -> some View {
        HStack(spacing: 4) {
            // Seed badge
            if let seed {
                Text("#\(seed)")
                    .font(.caption2.bold().monospacedDigit())
                    .foregroundStyle(color)
                    .frame(width: 22)
            }

            // Team numbers
            Text(teams.map { $0.replacingOccurrences(of: "frc", with: "") }.joined(separator: " · "))
                .font(.caption2.monospacedDigit())
                .lineLimit(1)

            Spacer()

            // Score
            if let score, score >= 0 {
                Text("\(score)")
                    .font(.caption.bold().monospacedDigit())
                    .foregroundStyle(isWinner ? color : .secondary)
            } else {
                Text("–")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 3)
        .padding(.horizontal, 6)
        .background(isWinner ? color.opacity(0.1) : .clear, in: RoundedRectangle(cornerRadius: 6))
        .opacity(isWinner ? 1.0 : (score != nil ? 0.6 : 1.0))
    }
}
```

### 5e. Set Descriptions

```swift
let setDescriptions: [Int: String] = [
    1: "#1 vs #8",
    2: "#4 vs #5",
    3: "#2 vs #7",
    4: "#3 vs #6",
    5: "L1 vs L2",
    6: "L3 vs L4",
    7: "W1 vs W2",
    8: "W3 vs W4",
    9: "W5 vs L8",
    10: "W6 vs L7",
    11: "W7 vs W8",
    12: "W9 vs W10",
    13: "L11 vs W12"
]
```

### 5f. Mobile-Friendly Bracket

On compact (iPhone), the grid doesn't fit. Use a **collapsible round list** instead:

```swift
@Environment(\.horizontalSizeClass) private var hSize

var body: some View {
    if hSize == .compact {
        // Mobile: collapsible rounds
        mobileBracket
    } else {
        // iPad: full grid
        fullBracketGrid
    }
}

@ViewBuilder var mobileBracket: some View {
    List {
        Section("Round 1 — Upper") {
            ForEach([1, 2, 3, 4], id: \.self) { set in
                BracketSlot(setNumber: set, matches: matchesBySet[set],
                            description: setDescriptions[set])
            }
        }

        Section("Round 2") {
            Group {
                Text("Upper").font(.caption2.bold())
                ForEach([7, 8], id: \.self) { set in
                    BracketSlot(setNumber: set, matches: matchesBySet[set],
                                description: setDescriptions[set])
                }
            }
            Group {
                Text("Lower").font(.caption2.bold())
                ForEach([5, 6], id: \.self) { set in
                    BracketSlot(setNumber: set, matches: matchesBySet[set],
                                description: setDescriptions[set])
                }
            }
        }

        Section("Round 3 — Lower") {
            ForEach([9, 10], id: \.self) { set in
                BracketSlot(setNumber: set, matches: matchesBySet[set],
                            description: setDescriptions[set])
            }
        }

        Section("Round 4") {
            BracketSlot(setNumber: 11, matches: matchesBySet[11],
                        description: setDescriptions[11])
            BracketSlot(setNumber: 12, matches: matchesBySet[12],
                        description: setDescriptions[12])
        }

        Section("Round 5 — Lower Final") {
            BracketSlot(setNumber: 13, matches: matchesBySet[13],
                        description: setDescriptions[13])
        }

        Section("Finals (Best of 3)") {
            ForEach(finalsMatches) { match in
                BracketSlot(setNumber: 0, matches: [match], description: "W11 vs W13")
            }
        }
    }
}
```

---

## 6. Polling

Playoff data refreshes on a **30-second interval** when the event is ongoing:

```swift
.task(id: store.selectedEvent) {
    guard let ek = store.selectedEvent else { return }
    while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(30))
        // Re-fetch matches — store.matches update triggers rebuild
        await store.refreshMatches(eventKey: ek)
    }
}
```

---

## 7. APIService Additions

```swift
func fetchAlliances(eventKey: String) async throws -> AlliancesResponse {
    return try await get(url: "\(base)/alliances/\(eventKey)")
}
```

---

## 8. FTC Bracket Differences

FTC uses a different bracket structure. The backend detects this and returns matches with labels containing "Upper"/"Lower" for double-elim, or simple "SF"/"F" for traditional.

**Detection**:
```swift
var isDoubleElim: Bool {
    store.matches.contains { m in
        m.compLevel == "sf" && (m.label?.contains("Upper") == true || m.label?.contains("Lower") == true)
    }
}
```

For FTC double-elim, group matches by `set_number` and classify by label regex:
- Label contains "Upper" → upper bracket
- Label contains "Lower" → lower bracket
- `comp_level == "f"` → finals

For FTC simple-elim, just list matches grouped by comp_level (sf, f).

---

## 9. Gotchas

1. **Placeholder matches**: The backend injects placeholder matches for all 13 double-elim sets even when no teams are assigned. Handle TBD slots gracefully (no teams, no score).
2. **Replays**: A set may have multiple matches (match_number 1, 2, 3). Show the latest (highest match_number) in the bracket, with a replay badge.
3. **`bracket` field**: Values are `"upper"`, `"lower"`, `"final"`. This is computed by the backend.
4. **Alliance `partnerships` keys**: Sorted alphabetically, like `"frc1678+frc254"` (not `"frc254+frc1678"`). Sort team keys before lookup.
5. **`max_combined_opr`**: Use this for the strength bar width calculation.
6. **Auto-refresh**: 30s interval for playoffs, but also listen for Realtime match updates.
