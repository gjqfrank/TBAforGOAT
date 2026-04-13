# Event Summaries, History & Regional Facts — Complete Wiring Guide

> **Purpose**: The "Event Info" menus (Summary, History, Regional Facts) are the areas where the Xcode Claude agent is "clueless on how to act once the menus are open." This document provides exact API calls, response shapes, and rendering instructions for all event info sub-sections.

---

## 1. Endpoint Map

| Section | Endpoint | Method | Notes |
|---------|----------|--------|-------|
| Demographics + Prestige + Top Scorers + High Scores | `GET /api/events/{event_key}/summary` | GET | Main summary payload |
| Refresh Stats Only | `GET /api/events/{event_key}/summary/refresh-stats` | GET | Forces fresh fetch |
| Past Champions & Awards | `GET /api/events/{event_key}/summary/awards` | GET | Lazy-loaded |
| Season Awards | `GET /api/events/{event_key}/summary/season-awards` | GET | Lazy-loaded |
| Advancement | `GET /api/events/{event_key}/summary/advancement` | GET | Lazy-loaded |
| Connections | `GET /api/events/{event_key}/summary/connections?all_time=false` | GET | Lazy-loaded; `all_time=true` for full history |
| Event History | `GET /api/events/{event_key}/history` | GET | Timeline + leaderboards |
| Region Facts | `GET /api/events/region/{region_name}/facts` | GET | Static pre-computed |
| Region List | `GET /api/events/regions/list` | GET | All known region names |

---

## 2. Lazy-Loading Pattern

The event summary is **too large** to fetch in one call. Use a lazy-loading pattern:

1. **On panel open**: Fetch `GET .../summary` (demographics, HoF, top scorers, high scores)
2. **On scroll/expand**: Fetch each deferred section on demand
3. **Cache on client**: Once fetched, store in a `@State` dict so re-opening doesn't re-fetch

```swift
@Observable
class EventSummaryViewModel {
    var demographics: Demographics?
    var hallOfFame: [HoFTeam] = []
    var impactFinalists: [HoFTeam] = []
    var topScorers: [TopScorer] = []
    var highScores: [HighScore] = []

    // Lazy sections
    var awards: AwardsPayload?
    var seasonAwards: SeasonAwardsPayload?
    var advancement: AdvancementPayload?
    var connections: ConnectionsPayload?
    var history: EventHistory?
    var regionFacts: RegionFacts?

    var isLoadingMain = false
    var loadingSection: String?
}
```

---

## 3. Main Summary Response

### `GET /api/events/{event_key}/summary`

```json
{
  "event_key": "2026tuak",
  "demographics": {
    "total_teams": 39,
    "rookie_count": 5,
    "rookie_pct": 12.8,
    "veteran_count": 34,
    "veteran_pct": 87.2,
    "avg_team_age": 8.5,
    "foreign_count": 3,
    "foreign_pct": 7.7,
    "event_country": "USA",
    "country_count": 4,
    "countries": ["Canada", "Mexico", "Turkey", "USA"]
  },
  "hall_of_fame": [
    {
      "team_number": 341,
      "nickname": "Miss Daisy",
      "city": "Wissahickon",
      "state_prov": "PA",
      "country": "USA",
      "impact_years": [2012]
    }
  ],
  "impact_finalists": [
    {
      "team_number": 1756,
      "nickname": "Argos",
      "city": "Melbourne",
      "state_prov": "FL",
      "country": "USA",
      "impact_years": [2023, 2024]
    }
  ],
  "top_scorers": [
    {
      "team_number": 254,
      "nickname": "The Cheesy Poofs",
      "opr": 55.2,
      "epa": 60.1,
      "rank": 1,
      "record": "10-2-0"
    }
  ],
  "high_scores": [
    {
      "match_key": "2026tuak_qm42",
      "label": "Qual 42",
      "score": 285,
      "red_teams": ["frc254", "frc1678", "frc846"],
      "blue_teams": ["frc118", "frc148", "frc217"],
      "red_score": 285,
      "blue_score": 230,
      "winning_alliance": "red"
    }
  ]
}
```

### Codable Models

```swift
struct EventSummaryResponse: Codable {
    let eventKey: String
    let demographics: Demographics
    let hallOfFame: [PrestigeTeam]
    let impactFinalists: [PrestigeTeam]
    let topScorers: [TopScorer]
    let highScores: [HighScore]

    enum CodingKeys: String, CodingKey {
        case eventKey = "event_key"
        case demographics
        case hallOfFame = "hall_of_fame"
        case impactFinalists = "impact_finalists"
        case topScorers = "top_scorers"
        case highScores = "high_scores"
    }
}

struct Demographics: Codable {
    let totalTeams: Int
    let rookieCount: Int
    let rookiePct: Double
    let veteranCount: Int
    let veteranPct: Double
    let avgTeamAge: Double
    let foreignCount: Int
    let foreignPct: Double
    let eventCountry: String
    let countryCount: Int
    let countries: [String]

    enum CodingKeys: String, CodingKey {
        case totalTeams = "total_teams"
        case rookieCount = "rookie_count"
        case rookiePct = "rookie_pct"
        case veteranCount = "veteran_count"
        case veteranPct = "veteran_pct"
        case avgTeamAge = "avg_team_age"
        case foreignCount = "foreign_count"
        case foreignPct = "foreign_pct"
        case eventCountry = "event_country"
        case countryCount = "country_count"
        case countries
    }
}

struct PrestigeTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let city: String?
    let stateProv: String?
    let country: String?
    let impactYears: [Int]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, city
        case stateProv = "state_prov"
        case country
        case impactYears = "impact_years"
    }
}

struct TopScorer: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let opr: Double?
    let epa: Double?
    let rank: Int?
    let record: String?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, opr, epa, rank, record
    }
}

struct HighScore: Codable, Identifiable {
    var id: String { matchKey }
    let matchKey: String
    let label: String?
    let score: Int
    let redTeams: [String]?
    let blueTeams: [String]?
    let redScore: Int?
    let blueScore: Int?
    let winningAlliance: String?

    enum CodingKeys: String, CodingKey {
        case matchKey = "match_key"
        case label, score
        case redTeams = "red_teams"
        case blueTeams = "blue_teams"
        case redScore = "red_score"
        case blueScore = "blue_score"
        case winningAlliance = "winning_alliance"
    }
}
```

---

## 4. Season Awards

### `GET /api/events/{event_key}/summary/season-awards`

Returns teams at this event who won notable awards at **other events this season**.

```json
{
  "teams": [
    {
      "team_number": 254,
      "nickname": "The Cheesy Poofs",
      "awards": [
        {
          "type": "Winner",
          "event_key": "2026casf",
          "event_name": "San Francisco Regional",
          "pick": 1,
          "alliance": 1
        }
      ]
    }
  ]
}
```

```swift
struct SeasonAwardsResponse: Codable {
    let teams: [SeasonAwardTeam]
}

struct SeasonAwardTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let awards: [SeasonAward]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, awards
    }
}

struct SeasonAward: Codable, Identifiable {
    var id: String { "\(type)_\(eventKey)" }
    let type: String
    let eventKey: String
    let eventName: String?
    let pick: Int?
    let alliance: Int?

    enum CodingKeys: String, CodingKey {
        case type
        case eventKey = "event_key"
        case eventName = "event_name"
        case pick, alliance
    }
}
```

---

## 5. Advancement

### `GET /api/events/{event_key}/summary/advancement`

```json
{
  "event_type": "regional",
  "event_winners": [
    { "team_number": 8044, "nickname": "Denham Venom", "is_backup": false }
  ],
  "point_standings": [
    {
      "team_number": 2481,
      "nickname": "Roboteers",
      "total": 70,
      "qual_points": 19,
      "elim_points": 30,
      "alliance_points": 16,
      "award_points": 5
    }
  ],
  "qualified_teams": [
    {
      "team_number": 8044,
      "nickname": "Denham Venom",
      "method": "Event Winner",
      "awards": ["Championship Division Winner"],
      "total_points": 68
    }
  ],
  "advancement_awards": [
    { "team_number": 10466, "nickname": "Federal Force", "award": "Rookie All-Star" }
  ]
}
```

```swift
struct AdvancementResponse: Codable {
    let eventType: String?
    let eventWinners: [WinnerTeam]?
    let pointStandings: [PointStanding]?
    let qualifiedTeams: [QualifiedTeam]?
    let advancementAwards: [AdvancementAward]?

    enum CodingKeys: String, CodingKey {
        case eventType = "event_type"
        case eventWinners = "event_winners"
        case pointStandings = "point_standings"
        case qualifiedTeams = "qualified_teams"
        case advancementAwards = "advancement_awards"
    }
}

struct WinnerTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let isBackup: Bool?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname
        case isBackup = "is_backup"
    }
}

struct PointStanding: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let total: Int
    let qualPoints: Int?
    let elimPoints: Int?
    let alliancePoints: Int?
    let awardPoints: Int?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, total
        case qualPoints = "qual_points"
        case elimPoints = "elim_points"
        case alliancePoints = "alliance_points"
        case awardPoints = "award_points"
    }
}

struct QualifiedTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let method: String?
    let awards: [String]?
    let totalPoints: Int?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, method, awards
        case totalPoints = "total_points"
    }
}

struct AdvancementAward: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let award: String
    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, award
    }
}
```

---

## 6. Connections

### `GET /api/events/{event_key}/summary/connections?all_time=false`

Returns pairs of teams at this event who were previously **playoff alliance partners**.

```json
{
  "connections": [
    {
      "team_a": 254,
      "team_b": 1678,
      "team_a_name": "The Cheesy Poofs",
      "team_b_name": "Citrus Circuits",
      "events": [
        { "event_key": "2025casf", "event_name": "SF Regional", "year": 2025 }
      ]
    }
  ]
}
```

```swift
struct ConnectionsResponse: Codable {
    let connections: [Connection]
}

struct Connection: Codable, Identifiable {
    var id: String { "\(teamA)-\(teamB)" }
    let teamA: Int
    let teamB: Int
    let teamAName: String?
    let teamBName: String?
    let events: [ConnectionEvent]

    enum CodingKeys: String, CodingKey {
        case teamA = "team_a"
        case teamB = "team_b"
        case teamAName = "team_a_name"
        case teamBName = "team_b_name"
        case events
    }
}

struct ConnectionEvent: Codable {
    let eventKey: String
    let eventName: String?
    let year: Int

    enum CodingKeys: String, CodingKey {
        case eventKey = "event_key"
        case eventName = "event_name"
        case year
    }
}
```

---

## 7. Event History

### `GET /api/events/{event_key}/history`

Full history of this recurring event over the years.

```json
{
  "event_name": "Archimedes Division",
  "event_key": "2025arc",
  "first_held": 2001,
  "editions": 20,
  "years_held": [2001, 2003, 2004, ...],
  "most_wins": [
    { "team_number": 33, "nickname": "Killer Bees", "count": 2 }
  ],
  "most_finalists": [
    { "team_number": 33, "nickname": "Killer Bees", "count": 4 }
  ],
  "most_impact": [],
  "most_ei": [
    { "team_number": 2158, "nickname": "the ausTIN CANs", "count": 1 }
  ],
  "most_ras": [
    { "team_number": 4731, "nickname": "", "count": 1 }
  ],
  "timeline": [
    {
      "year": 2025,
      "event_key": "2025arc",
      "winners": [
        { "team_number": 8044, "nickname": "Denham Venom" }
      ],
      "finalists": [
        { "team_number": 4391, "nickname": "BraveBots" }
      ],
      "impact": null
    }
  ]
}
```

```swift
struct EventHistory: Codable {
    let eventName: String
    let eventKey: String
    let firstHeld: Int?
    let editions: Int?
    let yearsHeld: [Int]?
    let mostWins: [Leaderboard]?
    let mostFinalists: [Leaderboard]?
    let mostImpact: [Leaderboard]?
    let mostEi: [Leaderboard]?
    let mostRas: [Leaderboard]?
    let timeline: [TimelineYear]?

    enum CodingKeys: String, CodingKey {
        case eventName = "event_name"
        case eventKey = "event_key"
        case firstHeld = "first_held"
        case editions
        case yearsHeld = "years_held"
        case mostWins = "most_wins"
        case mostFinalists = "most_finalists"
        case mostImpact = "most_impact"
        case mostEi = "most_ei"
        case mostRas = "most_ras"
        case timeline
    }
}

struct Leaderboard: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let count: Int

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, count
    }
}

struct TimelineYear: Codable, Identifiable {
    var id: Int { year }
    let year: Int
    let eventKey: String?
    let winners: [TimelineTeam]?
    let finalists: [TimelineTeam]?
    let impact: TimelineTeam?   // can be null

    enum CodingKeys: String, CodingKey {
        case year
        case eventKey = "event_key"
        case winners, finalists, impact
    }
}

struct TimelineTeam: Codable, Identifiable {
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

## 8. Region Facts

### `GET /api/events/region/{region_name}/facts`

Pre-computed static data about a FIRST region/district.

```json
{
  "first_event_year": 1992,
  "team_count": 350,
  "hof_teams": [
    { "team_number": 341, "nickname": "Miss Daisy", "years": [2012] }
  ],
  "impact_finalists": [
    { "team_number": 1756, "nickname": "Argos", "years": [2023, 2024] }
  ],
  "einstein_teams": [
    { "team_number": 254, "nickname": "The Cheesy Poofs", "years": [2014, 2017, 2018] }
  ]
}
```

```swift
struct RegionFacts: Codable {
    let firstEventYear: Int?
    let teamCount: Int?
    let hofTeams: [RegionTeam]?
    let impactFinalists: [RegionTeam]?
    let einsteinTeams: [RegionTeam]?

    enum CodingKeys: String, CodingKey {
        case firstEventYear = "first_event_year"
        case teamCount = "team_count"
        case hofTeams = "hof_teams"
        case impactFinalists = "impact_finalists"
        case einsteinTeams = "einstein_teams"
    }
}

struct RegionTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let years: [Int]?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, years
    }
}
```

---

## 9. View Implementation

### 9a. Event Info Panel — Main Structure

```swift
struct EventInfoView: View {
    @Environment(BroadcastStore.self) private var store
    @State private var vm = EventSummaryViewModel()
    @State private var selectedSection: InfoSection = .summary

    enum InfoSection: String, CaseIterable {
        case summary = "Summary"
        case history = "History"
        case region = "Region"
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Section", selection: $selectedSection) {
                    ForEach(InfoSection.allCases, id: \.self) { s in
                        Text(s.rawValue).tag(s)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                ScrollView {
                    switch selectedSection {
                    case .summary:
                        SummarySection(vm: vm, eventKey: store.selectedEvent ?? "")
                    case .history:
                        HistorySection(vm: vm, eventKey: store.selectedEvent ?? "")
                    case .region:
                        RegionSection(vm: vm, eventKey: store.selectedEvent ?? "")
                    }
                }
            }
            .navigationTitle("Event Info")
            .task {
                guard let ek = store.selectedEvent else { return }
                await vm.loadMain(eventKey: ek)
            }
        }
    }
}
```

### 9b. Summary Section

```swift
struct SummarySection: View {
    @Bindable var vm: EventSummaryViewModel
    let eventKey: String

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            // 1. Demographics cards
            if let demo = vm.demographics {
                demographicsCards(demo)
            }

            // 2. Hall of Fame / Impact
            if !vm.hallOfFame.isEmpty || !vm.impactFinalists.isEmpty {
                prestigeSection
            }

            // 3. Top Scorers (by OPR)
            if !vm.topScorers.isEmpty {
                topScorersSection
            }

            // 4. High Scores (by match)
            if !vm.highScores.isEmpty {
                highScoresSection
            }

            // 5. Season Awards (lazy)
            DisclosureGroup("Season Awards") {
                if let sa = vm.seasonAwards {
                    seasonAwardsView(sa)
                } else {
                    ProgressView()
                        .task { await vm.loadSeasonAwards(eventKey: eventKey) }
                }
            }

            // 6. Advancement (lazy)
            DisclosureGroup("Advancement") {
                if let adv = vm.advancement {
                    advancementView(adv)
                } else {
                    ProgressView()
                        .task { await vm.loadAdvancement(eventKey: eventKey) }
                }
            }

            // 7. Connections (lazy)
            DisclosureGroup("Playoff Connections") {
                if let conn = vm.connections {
                    connectionsView(conn)
                } else {
                    ProgressView()
                        .task { await vm.loadConnections(eventKey: eventKey) }
                }
            }
        }
        .padding()
    }
}
```

### 9c. Demographics Cards

```swift
@ViewBuilder func demographicsCards(_ demo: Demographics) -> some View {
    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
        StatCard(title: "Teams", value: "\(demo.totalTeams)", icon: "person.3")
        StatCard(title: "Rookies", value: "\(demo.rookieCount) (\(String(format: "%.0f", demo.rookiePct))%)", icon: "sparkles")
        StatCard(title: "Avg Age", value: String(format: "%.1f yr", demo.avgTeamAge), icon: "calendar")
        StatCard(title: "Countries", value: "\(demo.countryCount)", icon: "globe")
        if demo.foreignCount > 0 {
            StatCard(title: "International", value: "\(demo.foreignCount) (\(String(format: "%.0f", demo.foreignPct))%)", icon: "airplane")
        }
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        HStack {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.blue)
                .frame(width: 30)
            VStack(alignment: .leading) {
                Text(title)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.bold())
            }
            Spacer()
        }
        .padding(10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }
}
```

### 9d. History Section

```swift
struct HistorySection: View {
    @Bindable var vm: EventSummaryViewModel
    let eventKey: String

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            if let h = vm.history {
                // Header
                VStack(alignment: .leading, spacing: 4) {
                    Text(h.eventName)
                        .font(.title2.bold())
                    if let first = h.firstHeld, let editions = h.editions {
                        Text("First held \(first) · \(editions) editions")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                // Leaderboards
                if let wins = h.mostWins, !wins.isEmpty {
                    leaderboard(title: "Most Wins", data: wins, icon: "trophy.fill", color: .yellow)
                }
                if let finalists = h.mostFinalists, !finalists.isEmpty {
                    leaderboard(title: "Most Finalist", data: finalists, icon: "medal.fill", color: .gray)
                }

                // Timeline
                if let tl = h.timeline, !tl.isEmpty {
                    Text("Timeline")
                        .font(.headline)
                    ForEach(tl) { year in
                        timelineCard(year)
                    }
                }
            } else {
                ProgressView()
                    .task { await vm.loadHistory(eventKey: eventKey) }
            }
        }
        .padding()
    }

    @ViewBuilder func leaderboard(title: String, data: [Leaderboard], icon: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: icon)
                .font(.headline)
                .foregroundStyle(color)
            ForEach(data.prefix(5)) { entry in
                HStack {
                    Text("\(entry.teamNumber)")
                        .font(.caption.bold().monospacedDigit())
                    Text(entry.nickname)
                        .font(.caption)
                        .lineLimit(1)
                    Spacer()
                    Text("\(entry.count)×")
                        .font(.caption.bold().monospacedDigit())
                }
            }
        }
    }

    @ViewBuilder func timelineCard(_ year: TimelineYear) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(year.year)")
                .font(.subheadline.bold().monospacedDigit())

            if let winners = year.winners, !winners.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "trophy.fill")
                        .font(.caption2)
                        .foregroundStyle(.yellow)
                    Text(winners.map { "\($0.teamNumber)" }.joined(separator: ", "))
                        .font(.caption.monospacedDigit())
                }
            }

            if let finalists = year.finalists, !finalists.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "medal.fill")
                        .font(.caption2)
                        .foregroundStyle(.gray)
                    Text(finalists.map { "\($0.teamNumber)" }.joined(separator: ", "))
                        .font(.caption.monospacedDigit())
                }
            }

            if let impact = year.impact {
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                    Text("\(impact.teamNumber) \(impact.nickname)")
                        .font(.caption)
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }
}
```

---

## 10. ViewModel Load Methods

```swift
extension EventSummaryViewModel {
    func loadMain(eventKey: String) async {
        guard demographics == nil else { return }
        isLoadingMain = true
        do {
            let resp: EventSummaryResponse = try await APIService.get(
                url: "\(APIService.base)/events/\(eventKey)/summary"
            )
            demographics = resp.demographics
            hallOfFame = resp.hallOfFame
            impactFinalists = resp.impactFinalists
            topScorers = resp.topScorers
            highScores = resp.highScores
        } catch { print("Summary load failed: \(error)") }
        isLoadingMain = false
    }

    func loadSeasonAwards(eventKey: String) async {
        guard seasonAwards == nil else { return }
        do {
            seasonAwards = try await APIService.get(
                url: "\(APIService.base)/events/\(eventKey)/summary/season-awards"
            )
        } catch { print("Season awards failed: \(error)") }
    }

    func loadAdvancement(eventKey: String) async {
        guard advancement == nil else { return }
        do {
            advancement = try await APIService.get(
                url: "\(APIService.base)/events/\(eventKey)/summary/advancement"
            )
        } catch { print("Advancement failed: \(error)") }
    }

    func loadConnections(eventKey: String) async {
        guard connections == nil else { return }
        do {
            connections = try await APIService.get(
                url: "\(APIService.base)/events/\(eventKey)/summary/connections"
            )
        } catch { print("Connections failed: \(error)") }
    }

    func loadHistory(eventKey: String) async {
        guard history == nil else { return }
        do {
            history = try await APIService.get(
                url: "\(APIService.base)/events/\(eventKey)/history"
            )
        } catch { print("History failed: \(error)") }
    }

    func loadRegionFacts(regionName: String) async {
        guard regionFacts == nil else { return }
        let encoded = regionName.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? regionName
        do {
            regionFacts = try await APIService.get(
                url: "\(APIService.base)/events/region/\(encoded)/facts"
            )
        } catch { print("Region facts failed: \(error)") }
    }
}
```

---

## 11. Gotchas

1. **Lazy loading is critical**: Do NOT fetch all sections at once. Each deferred section (awards, connections, advancement, season-awards) should load when expanded.
2. **Championship events are special**: Championship divisions and Einstein have different data paths. The backend handles this, but the UI should expect `event_type: "regional"` vs `"district"` vs `"championship"`.
3. **FTC events**: FTC uses "Inspire" instead of "Impact" award. The backend normalizes some of this, but display labels should handle both.
4. **`most_impact` can be empty**: Not all events have Impact Award winners. Handle empty arrays.
5. **Timeline years are descending**: Most recent first in the `timeline` array.
6. **Region name**: Use the region/district name from the event metadata. Example: `"Texas"`, `"New England"`, `"Ontario"`.
7. **Connections `all_time` param**: Default is `false` (last 3 years). Add a toggle for users who want full history.
8. **Missing data**: Some sections may return 404 for newer or obscure events. Show a "No data available" message rather than an error.
9. **Advancement point breakdown**: The `point_standings` array has `qual_points`, `elim_points`, `alliance_points`, `award_points` — all optional ints. Render as a stacked bar or simple row.
