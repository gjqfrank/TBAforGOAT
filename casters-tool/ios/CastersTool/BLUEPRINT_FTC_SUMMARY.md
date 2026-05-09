# Blueprint: FTC Event Summary (iOS)
### For XCode Claude — implement the FTC variant of the Event Info / Summary view

---

## Overview

`EVENT_SUMMARIES.md` describes the FRC wiring for the Event Info panel (Summary, History,
Region tabs). This blueprint covers the **FTC-specific divergences** only. Read
`EVENT_SUMMARIES.md` first for the lazy-loading pattern, `DisclosureGroup` structure,
and `EventSummaryViewModel` skeleton; this doc replaces or overrides each FTC-specific
section.

When `store.activeMode == .ftc`, the Event Info sheet must use `FTCEventSummaryViewModel`
and the `FTCEventInfoView` described below. The FRC `EventInfoView` must not be rendered.

---

## 1. Endpoint Map

| Section | Endpoint | Method | Status |
|---------|----------|--------|--------|
| Main summary (demographics, inspire pedigree, top OPR, high scores) | `GET /ftc/{event_key}/summary` | GET | **Needs backend** (§2) |
| Past Season Awards | `GET /ftc/{event_key}/past-awards` | GET | ✅ Exists |
| Season Awards (big-3 at prior events this season) | `GET /ftc/{event_key}/season-awards` | GET | ✅ Exists |
| Playoff Connections | `GET /ftc/{event_key}/summary/connections?all_time=false` | GET | ✅ Exists |
| Advancement | `GET /ftc/{event_key}/advancement` | GET | **Needs backend** (§6) |
| Event History | `GET /ftc/{event_key}/history` | GET | **Needs backend** (§7) |

> **No Region Facts for FTC.** The FRC `/api/events/region/{name}/facts` endpoint is
> FRC-only (Einstein, HoF, etc.). The Region tab is hidden in FTC mode.

---

## 2. Backend: `GET /ftc/{event_key}/summary`

This endpoint does not yet exist. Add it to `ftc_events.py` and the corresponding
function to `ftc_event_service.py`. It mirrors `GET /api/events/{event_key}/summary`
in structure so the iOS view layer needs minimal branching.

### Request

```
GET /ftc/{event_key}/summary
```

No query parameters. Caches aggressively (10 min TTL in disk cache, fallback in Supabase).

### Response shape

```json
{
  "event_key": "2026ftcorpor",
  "event_name": "Portland Qualifier",
  "event_type_string": "Qualifier",
  "demographics": {
    "total_teams": 24,
    "rookie_count": 4,
    "rookie_pct": 16.7,
    "veteran_count": 20,
    "veteran_pct": 83.3,
    "avg_team_age": 5.2,
    "foreign_count": 0,
    "foreign_pct": 0.0,
    "event_country": "USA",
    "country_count": 1,
    "countries": ["USA"]
  },
  "inspire_pedigree": [
    {
      "team_number": 9872,
      "nickname": "Robotic Eagles",
      "city": "Portland",
      "state_prov": "OR",
      "country": "USA",
      "inspire_years": [2024]
    }
  ],
  "inspire_finalists": [
    {
      "team_number": 11406,
      "nickname": "Gear Works",
      "city": "Salem",
      "state_prov": "OR",
      "country": "USA",
      "inspire_years": [2023, 2024]
    }
  ],
  "top_opr_teams": [
    {
      "team_number": 9872,
      "nickname": "Robotic Eagles",
      "opr_total": 142.8,
      "opr_auto": 38.2,
      "opr_dc": 95.7,
      "rank": 1,
      "record": "5-1-0"
    }
  ],
  "high_scores": [
    {
      "match_key": "2026ftcorpor_qm14",
      "label": "Qual 14",
      "score": 312,
      "red_teams": ["ftc9872", "ftc11406"],
      "blue_teams": ["ftc15234", "ftc8801"],
      "red_score": 312,
      "blue_score": 198,
      "winning_alliance": "red"
    }
  ]
}
```

### Backend implementation sketch

Add to `ftc_event_service.py`:

```python
async def get_ftc_event_summary(event_key: str) -> dict:
    """Package FTC event demographics, inspire pedigree, top OPR, and high scores."""
    year, event_code = _parse_ftc_key(event_key)

    # Check disk / Supabase caches first (10 min TTL)
    cached = read_payload("ftc_summary", event_key, ttl=600)
    if cached:
        cached.pop("_ts", None)
        return cached

    client = get_ftc_client()
    scout = get_ftcscout_client()

    # Parallel fetches
    teams_raw, all_matches, scout_stats, awards_raw = await asyncio.gather(
        client.get_event_teams(year, event_code),
        client.get_all_matches(year, event_code),
        scout.get_event_team_stats(year, event_code),
        client.get_event_awards(year, event_code),
        return_exceptions=True,
    )
    # ... (guard isinstance checks, derive demographics from teams_raw, derive
    #      inspire_pedigree / inspire_finalists from awards_raw filtered to
    #      _FTC_INSPIRE_ID, derive top_opr_teams from scout_stats sorted by opr_total,
    #      derive high_scores from all_matches by max score)
    ...
    result = {
        "event_key": event_key,
        "event_name": ...,
        "demographics": ...,
        "inspire_pedigree": ...,
        "inspire_finalists": ...,
        "top_opr_teams": ...,
        "high_scores": ...,
    }
    write_payload("ftc_summary", event_key, result)
    return result
```

Add to `ftc_events.py`:

```python
@router.get("/{event_key}/summary")
async def ftc_event_summary(event_key: str):
    """FTC event summary card."""
    try:
        return await ftc_event_service.get_ftc_event_summary(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC summary for '{event_key}'.")
```

---

## 3. Data Models (FTC-specific, iOS)

These are **separate** from the FRC `EventSummaryResponse`. Add to a new file
`FTCEventSummaryModels.swift` or alongside `FTCTeamStats.swift`.

```swift
// MARK: - Main Summary

struct FTCEventSummaryResponse: Codable {
    let eventKey: String
    let eventName: String?
    let eventTypeString: String?
    let demographics: FTCDemographics
    let inspirePedigree: [FTCPrestigeTeam]
    let inspireFinalists: [FTCPrestigeTeam]
    let topOprTeams: [FTCTopOprEntry]
    let highScores: [FTCHighScore]

    enum CodingKeys: String, CodingKey {
        case eventKey = "event_key"
        case eventName = "event_name"
        case eventTypeString = "event_type_string"
        case demographics
        case inspirePedigree = "inspire_pedigree"
        case inspireFinalists = "inspire_finalists"
        case topOprTeams = "top_opr_teams"
        case highScores = "high_scores"
    }
}

struct FTCDemographics: Codable {
    let totalTeams: Int
    let rookieCount: Int
    let rookiePct: Double
    let veteranCount: Int
    let veteranPct: Double
    let avgTeamAge: Double
    let foreignCount: Int
    let foreignPct: Double
    let eventCountry: String?
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

struct FTCPrestigeTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let city: String?
    let stateProv: String?
    let country: String?
    let inspireYears: [Int]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, city
        case stateProv = "state_prov"
        case country
        case inspireYears = "inspire_years"
    }
}

struct FTCTopOprEntry: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let oprTotal: Double?
    let oprAuto: Double?
    let oprDc: Double?
    let rank: Int?
    let record: String?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname
        case oprTotal = "opr_total"
        case oprAuto = "opr_auto"
        case oprDc = "opr_dc"
        case rank, record
    }
}

struct FTCHighScore: Codable, Identifiable {
    var id: String { matchKey }
    let matchKey: String
    let label: String?
    let score: Int
    let redTeams: [String]?   // "ftc12345" — 2 entries max
    let blueTeams: [String]?  // "ftc67890" — 2 entries max
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

// MARK: - Past Season Awards

struct FTCPastAwardsResponse: Codable {
    let pastSeasonAwards: [FTCPrestigeAwardTeam]
    let prevSeason: Int?

    enum CodingKeys: String, CodingKey {
        case pastSeasonAwards = "past_season_awards"
        case prevSeason = "prev_season"
    }
}

// MARK: - Season Awards (big-3 at prior events this season)

struct FTCSeasonAwardsResponse: Codable {
    let seasonAwards: [FTCPrestigeAwardTeam]
    let season: Int

    enum CodingKeys: String, CodingKey {
        case seasonAwards = "season_awards"
        case season
    }
}

struct FTCPrestigeAwardTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let awards: [FTCPrestigeAward]

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, awards
    }
}

struct FTCPrestigeAward: Codable, Identifiable {
    var id: String { "\(type)_\(eventName)" }
    let name: String
    let eventName: String
    let type: String    // "inspire" | "winner" | "finalist"

    enum CodingKeys: String, CodingKey {
        case name
        case eventName = "event_name"
        case type
    }
}

// MARK: - Connections (reuse FRC Connection / ConnectionEvent models; shape is identical)
// The FTC endpoint /ftc/{event_key}/summary/connections returns the same JSON shape
// as the FRC endpoint. Reuse ConnectionsResponse, Connection, ConnectionEvent.

// MARK: - Advancement

struct FTCAdvancementResponse: Codable {
    let eventType: String?          // "Qualifier", "LeagueTournament", "Championship"
    let advancingTeams: [FTCAdvancingTeam]?
    let pointStandings: [FTCPointStanding]?

    enum CodingKeys: String, CodingKey {
        case eventType = "event_type"
        case advancingTeams = "advancing_teams"
        case pointStandings = "point_standings"
    }
}

struct FTCAdvancingTeam: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let method: String?    // "Event Winner", "Inspire Award", "Advancement Points"
    let nextEvent: String? // name of the event they advance to

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, method
        case nextEvent = "next_event"
    }
}

struct FTCPointStanding: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let totalPoints: Int
    let qualPoints: Int?
    let alliancePoints: Int?
    let awardPoints: Int?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname
        case totalPoints = "total_points"
        case qualPoints = "qual_points"
        case alliancePoints = "alliance_points"
        case awardPoints = "award_points"
    }
}

// MARK: - Event History

struct FTCEventHistory: Codable {
    let eventName: String
    let eventKey: String
    let firstHeld: Int?
    let editions: Int?
    let yearsHeld: [Int]?
    let mostWins: [FTCLeaderboard]?
    let mostInspire: [FTCLeaderboard]?
    let timeline: [FTCTimelineYear]?

    enum CodingKeys: String, CodingKey {
        case eventName = "event_name"
        case eventKey = "event_key"
        case firstHeld = "first_held"
        case editions
        case yearsHeld = "years_held"
        case mostWins = "most_wins"
        case mostInspire = "most_inspire"
        case timeline
    }
}

struct FTCLeaderboard: Codable, Identifiable {
    var id: Int { teamNumber }
    let teamNumber: Int
    let nickname: String
    let count: Int

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname, count
    }
}

struct FTCTimelineYear: Codable, Identifiable {
    var id: Int { year }
    let year: Int
    let eventKey: String?
    let winners: [FTCTimelineTeam]?
    let finalists: [FTCTimelineTeam]?
    let inspire: FTCTimelineTeam?    // may be null if not awarded / no data

    enum CodingKeys: String, CodingKey {
        case year
        case eventKey = "event_key"
        case winners, finalists, inspire
    }
}

struct FTCTimelineTeam: Codable, Identifiable {
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

## 4. ViewModel

```swift
// FTCEventSummaryViewModel.swift

@Observable
class FTCEventSummaryViewModel {
    // Main (loaded immediately)
    var demographics: FTCDemographics?
    var inspirePedigree: [FTCPrestigeTeam] = []
    var inspireFinalists: [FTCPrestigeTeam] = []
    var topOprTeams: [FTCTopOprEntry] = []
    var highScores: [FTCHighScore] = []

    // Lazy sections
    var pastAwards: FTCPastAwardsResponse?
    var seasonAwards: FTCSeasonAwardsResponse?
    var connections: ConnectionsResponse?      // reuse FRC model — shape identical
    var advancement: FTCAdvancementResponse?
    var history: FTCEventHistory?

    var isLoadingMain = false
    var loadingSection: String?
}

extension FTCEventSummaryViewModel {

    func loadMain(eventKey: String) async {
        guard demographics == nil else { return }
        isLoadingMain = true
        defer { isLoadingMain = false }
        do {
            let resp: FTCEventSummaryResponse = try await APIService.get(
                url: "\(APIService.base)/ftc/\(eventKey)/summary"
            )
            demographics = resp.demographics
            inspirePedigree = resp.inspirePedigree
            inspireFinalists = resp.inspireFinalists
            topOprTeams = resp.topOprTeams
            highScores = resp.highScores
        } catch {
            // leave fields nil — view shows empty states
        }
    }

    func loadPastAwards(eventKey: String) async {
        guard pastAwards == nil else { return }
        loadingSection = "past-awards"
        defer { loadingSection = nil }
        do {
            pastAwards = try await APIService.get(
                url: "\(APIService.base)/ftc/\(eventKey)/past-awards"
            )
        } catch {}
    }

    func loadSeasonAwards(eventKey: String) async {
        guard seasonAwards == nil else { return }
        loadingSection = "season-awards"
        defer { loadingSection = nil }
        do {
            seasonAwards = try await APIService.get(
                url: "\(APIService.base)/ftc/\(eventKey)/season-awards"
            )
        } catch {}
    }

    func loadConnections(eventKey: String, allTime: Bool = false) async {
        guard connections == nil else { return }
        loadingSection = "connections"
        defer { loadingSection = nil }
        do {
            connections = try await APIService.get(
                url: "\(APIService.base)/ftc/\(eventKey)/summary/connections?all_time=\(allTime)"
            )
        } catch {}
    }

    func loadAdvancement(eventKey: String) async {
        guard advancement == nil else { return }
        loadingSection = "advancement"
        defer { loadingSection = nil }
        do {
            advancement = try await APIService.get(
                url: "\(APIService.base)/ftc/\(eventKey)/advancement"
            )
        } catch {}
    }

    func loadHistory(eventKey: String) async {
        guard history == nil else { return }
        loadingSection = "history"
        defer { loadingSection = nil }
        do {
            history = try await APIService.get(
                url: "\(APIService.base)/ftc/\(eventKey)/history"
            )
        } catch {}
    }
}
```

---

## 5. View — `FTCEventInfoView`

Gate from the FRC `EventInfoView` on `store.activeMode`:

```swift
// In the sheet / navigation destination that opens Event Info:
if store.activeMode == .ftc {
    FTCEventInfoView()
} else {
    EventInfoView()   // existing FRC view
}
```

FTC has two tabs only: **Summary** and **History**. The Region tab is omitted.

```swift
struct FTCEventInfoView: View {
    @Environment(BroadcastStore.self) private var store
    @State private var vm = FTCEventSummaryViewModel()

    enum InfoSection: String, CaseIterable {
        case summary = "Summary"
        case history = "History"
    }
    @State private var selectedSection: InfoSection = .summary

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
                        FTCSummarySection(vm: vm, eventKey: store.selectedEvent ?? "")
                    case .history:
                        FTCHistorySection(vm: vm, eventKey: store.selectedEvent ?? "")
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

---

## 5a. Summary Section

```swift
struct FTCSummarySection: View {
    @Bindable var vm: FTCEventSummaryViewModel
    let eventKey: String

    var body: some View {
        LazyVStack(alignment: .leading, spacing: 16) {

            // 1. Demographics — reuse the FRC StatCard / demographicsCards helper;
            //    FTCDemographics has the identical field names, so pass directly.
            if let demo = vm.demographics {
                ftcDemographicsCards(demo)
            } else if vm.isLoadingMain {
                ProgressView().frame(maxWidth: .infinity)
            }

            // 2. Inspire Pedigree (FTC equivalent of Hall of Fame)
            if !vm.inspirePedigree.isEmpty || !vm.inspireFinalists.isEmpty {
                ftcInspireSection
            }

            // 3. Top OPR Teams
            if !vm.topOprTeams.isEmpty {
                ftcTopOprSection
            }

            // 4. High Scores
            if !vm.highScores.isEmpty {
                ftcHighScoresSection
            }

            // 5. Past Season Awards (lazy)
            DisclosureGroup("Past Season Accolades") {
                if let pa = vm.pastAwards {
                    ftcPastAwardsView(pa)
                } else {
                    ProgressView()
                        .task { await vm.loadPastAwards(eventKey: eventKey) }
                }
            }

            // 6. Season Awards (lazy)
            DisclosureGroup("Season Accolades") {
                if let sa = vm.seasonAwards {
                    ftcSeasonAwardsView(sa)
                } else {
                    ProgressView()
                        .task { await vm.loadSeasonAwards(eventKey: eventKey) }
                }
            }

            // 7. Advancement (lazy)
            DisclosureGroup("Advancement") {
                if let adv = vm.advancement {
                    ftcAdvancementView(adv)
                } else {
                    ProgressView()
                        .task { await vm.loadAdvancement(eventKey: eventKey) }
                }
            }

            // 8. Connections (lazy)
            DisclosureGroup("Playoff Connections") {
                if let conn = vm.connections {
                    connectionsView(conn)   // reuse FRC connectionsView — shape identical
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

---

## 5b. Demographics Cards

`FTCDemographics` has the same field names as the FRC `Demographics`. Reuse the FRC
`demographicsCards` helper directly if the types are protocol-compatible, or copy it:

```swift
@ViewBuilder func ftcDemographicsCards(_ demo: FTCDemographics) -> some View {
    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
        StatCard(title: "Teams", value: "\(demo.totalTeams)", icon: "person.3")
        StatCard(title: "Rookies",
                 value: "\(demo.rookieCount) (\(String(format: "%.0f", demo.rookiePct))%)",
                 icon: "sparkles")
        StatCard(title: "Avg Age",
                 value: String(format: "%.1f yr", demo.avgTeamAge),
                 icon: "calendar")
        StatCard(title: "Countries", value: "\(demo.countryCount)", icon: "globe")
        if demo.foreignCount > 0 {
            StatCard(title: "International",
                     value: "\(demo.foreignCount) (\(String(format: "%.0f", demo.foreignPct))%)",
                     icon: "airplane")
        }
    }
}
```

---

## 5c. Inspire Pedigree Section

FTC equivalent of the FRC Hall of Fame / Impact Finalists block. Label it
**"Inspire Award"** not "Hall of Fame" — FTC has no Hall of Fame.

```swift
@ViewBuilder var ftcInspireSection: some View {
    VStack(alignment: .leading, spacing: 10) {
        // Inspire Award winners (equivalent of HoF — attended this event AND won Inspire)
        if !vm.inspirePedigree.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label("Inspire Award Winners Here", systemImage: "star.fill")
                    .font(.headline)
                    .foregroundStyle(.purple)
                ForEach(vm.inspirePedigree) { team in
                    FTCPrestigeTeamRow(team: team, yearLabel: "Inspire")
                }
            }
        }

        // Multi-time Inspire finalists (equivalent of Impact finalists)
        if !vm.inspireFinalists.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label("Inspire Finalists", systemImage: "star.leadinghalf.filled")
                    .font(.subheadline.bold())
                    .foregroundStyle(.purple.opacity(0.7))
                ForEach(vm.inspireFinalists) { team in
                    FTCPrestigeTeamRow(team: team, yearLabel: "Finalist")
                }
            }
        }
    }
    .padding()
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
}

struct FTCPrestigeTeamRow: View {
    let team: FTCPrestigeTeam
    let yearLabel: String

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("\(team.teamNumber)")
                        .font(.subheadline.bold().monospacedDigit())
                    Text(team.nickname)
                        .font(.subheadline)
                        .lineLimit(1)
                }
                if !team.inspireYears.isEmpty {
                    Text(team.inspireYears.map { ftcSeasonLabel($0) }.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Image(systemName: "star.fill")
                .foregroundStyle(.purple)
                .font(.caption)
        }
    }
}
```

---

## 5d. Top OPR Teams Section

Replaces FRC "Top Scorers (by EPA/OPR)". FTC has no EPA — show OPR components.

```swift
@ViewBuilder var ftcTopOprSection: some View {
    VStack(alignment: .leading, spacing: 8) {
        Label("Top OPR", systemImage: "chart.bar.fill")
            .font(.headline)

        // Header row
        HStack {
            Text("Team").font(.caption.bold()).frame(maxWidth: .infinity, alignment: .leading)
            Text("Total").font(.caption.bold()).frame(width: 52, alignment: .trailing)
            Text("Auto").font(.caption.bold()).frame(width: 48, alignment: .trailing)
            Text("DC").font(.caption.bold()).frame(width: 48, alignment: .trailing)
        }
        .foregroundStyle(.secondary)
        .padding(.horizontal, 4)

        ForEach(vm.topOprTeams.prefix(8)) { entry in
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("\(entry.teamNumber)")
                        .font(.caption.bold().monospacedDigit())
                    Text(entry.nickname)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Text(entry.oprTotal.map { String(format: "%.1f", $0) } ?? "—")
                    .font(.caption.monospacedDigit())
                    .frame(width: 52, alignment: .trailing)
                Text(entry.oprAuto.map { String(format: "%.1f", $0) } ?? "—")
                    .font(.caption.monospacedDigit())
                    .frame(width: 48, alignment: .trailing)
                    .foregroundStyle(.secondary)
                Text(entry.oprDc.map { String(format: "%.1f", $0) } ?? "—")
                    .font(.caption.monospacedDigit())
                    .frame(width: 48, alignment: .trailing)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 3)

            if entry.id != vm.topOprTeams.prefix(8).last?.id {
                Divider()
            }
        }
    }
    .padding()
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
}
```

---

## 5e. High Scores Section

Same structure as FRC, but alliances have **2 teams** each. Reuse the FRC
`highScoresSection` view builder — `HighScore` and `FTCHighScore` have the same field
names. If you create a shared protocol, both can conform. Otherwise duplicate:

```swift
@ViewBuilder var ftcHighScoresSection: some View {
    VStack(alignment: .leading, spacing: 8) {
        Label("High Scores", systemImage: "flame.fill")
            .font(.headline)

        ForEach(vm.highScores.prefix(3)) { hs in
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(hs.label ?? hs.matchKey)
                        .font(.subheadline.bold())
                    // Red alliance (2 teams)
                    HStack(spacing: 4) {
                        Circle().fill(.red).frame(width: 6, height: 6)
                        Text((hs.redTeams ?? []).map { $0.replacingOccurrences(of: "ftc", with: "") }.joined(separator: " & "))
                            .font(.caption)
                    }
                    // Blue alliance (2 teams)
                    HStack(spacing: 4) {
                        Circle().fill(.blue).frame(width: 6, height: 6)
                        Text((hs.blueTeams ?? []).map { $0.replacingOccurrences(of: "ftc", with: "") }.joined(separator: " & "))
                            .font(.caption)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(hs.score)")
                        .font(.title3.bold().monospacedDigit())
                    if let red = hs.redScore, let blue = hs.blueScore {
                        Text("\(red) – \(blue)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(10)
            .background(
                (hs.winningAlliance == "red" ? Color.red : Color.blue).opacity(0.08),
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
    }
    .padding()
    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
}
```

---

## 5f. Past Season Awards View

Uses `FTCPastAwardsResponse.pastSeasonAwards`. Each team has `awards: [FTCPrestigeAward]`
with `type: "inspire" | "winner" | "finalist"` and `event_name`.

```swift
@ViewBuilder func ftcPastAwardsView(_ pa: FTCPastAwardsResponse) -> some View {
    if pa.pastSeasonAwards.isEmpty {
        Text("No past season accolades for teams at this event.")
            .font(.caption)
            .foregroundStyle(.secondary)
    } else {
        let seasonLabel = pa.prevSeason.map { ftcSeasonLabel($0) } ?? "Last season"
        Text("\(seasonLabel) Inspire / Alliance Awards")
            .font(.caption.bold())
            .foregroundStyle(.secondary)
            .padding(.bottom, 2)

        ForEach(pa.pastSeasonAwards) { team in
            ftcAwardTeamRow(team)
        }
    }
}
```

---

## 5g. Season Awards View

Uses `FTCSeasonAwardsResponse.seasonAwards`. Same shape as past awards — teams with
`awards[]` earned **at other events earlier this season**.

```swift
@ViewBuilder func ftcSeasonAwardsView(_ sa: FTCSeasonAwardsResponse) -> some View {
    if sa.seasonAwards.isEmpty {
        Text("No season accolades yet for teams at this event.")
            .font(.caption)
            .foregroundStyle(.secondary)
    } else {
        Text("\(ftcSeasonLabel(sa.season)) accolades earned at earlier events")
            .font(.caption.bold())
            .foregroundStyle(.secondary)
            .padding(.bottom, 2)

        ForEach(sa.seasonAwards) { team in
            ftcAwardTeamRow(team)
        }
    }
}

/// Shared row used by both past and season award views.
@ViewBuilder func ftcAwardTeamRow(_ team: FTCPrestigeAwardTeam) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        HStack {
            Text("\(team.teamNumber)")
                .font(.caption.bold().monospacedDigit())
            Text(team.nickname)
                .font(.caption)
                .lineLimit(1)
            Spacer()
        }
        ForEach(team.awards) { award in
            HStack(spacing: 6) {
                Image(systemName: ftcAwardIcon(award.name))
                    .foregroundStyle(ftcAwardTypeColor(award.type))
                    .font(.caption2)
                VStack(alignment: .leading, spacing: 1) {
                    Text(award.name)
                        .font(.caption2.bold())
                    Text(award.eventName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
    .padding(.vertical, 4)
    Divider()
}

/// Color by award type string ("inspire", "winner", "finalist")
func ftcAwardTypeColor(_ type: String) -> Color {
    switch type {
    case "inspire": return .purple
    case "winner":  return .yellow
    case "finalist": return .blue
    default: return .indigo
    }
}
```

---

## 5h. Advancement View

```swift
@ViewBuilder func ftcAdvancementView(_ adv: FTCAdvancementResponse) -> some View {
    VStack(alignment: .leading, spacing: 10) {
        if let advancing = adv.advancingTeams, !advancing.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label("Advancing Teams", systemImage: "arrow.up.circle.fill")
                    .font(.subheadline.bold())
                    .foregroundStyle(.green)
                ForEach(advancing) { team in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 6) {
                                Text("\(team.teamNumber)")
                                    .font(.caption.bold().monospacedDigit())
                                Text(team.nickname)
                                    .font(.caption)
                                    .lineLimit(1)
                            }
                            if let method = team.method {
                                Text(method)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if let next = team.nextEvent {
                            Text(next)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            }
        }

        if let standings = adv.pointStandings, !standings.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Label("Advancement Points", systemImage: "list.number")
                    .font(.subheadline.bold())
                ForEach(standings.prefix(10)) { s in
                    HStack {
                        Text("\(s.teamNumber)")
                            .font(.caption.bold().monospacedDigit())
                        Text(s.nickname)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer()
                        Text("\(s.totalPoints) pts")
                            .font(.caption.bold().monospacedDigit())
                    }
                }
            }
        }

        if (adv.advancingTeams ?? []).isEmpty && (adv.pointStandings ?? []).isEmpty {
            Text("Advancement data not available for this event type.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
```

---

## 5i. Connections View

FTC connections use the **same JSON shape** as FRC connections (same backend utility,
same Supabase query). Reuse the FRC `connectionsView` helper verbatim. The only visual
difference is that connection chips should show `ftcXXXXX` → strip the `"ftc"` prefix
and show the bare number:

```swift
// In ftcAwardTeamRow or wherever you render team numbers from connection data:
Text(String(teamKey.replacingOccurrences(of: "ftc", with: "")))
    .font(.caption.monospacedDigit())
```

---

## 6. Backend: `GET /ftc/{event_key}/advancement`

Add to `ftc_events.py` and `ftc_event_service.py`. FTC advancement rules vary by
event type (Qualifier → Inspire/Winner advance; League Tournament → points qualify to
Championship). Implement as a best-effort pass:

```python
@router.get("/{event_key}/advancement")
async def ftc_advancement(event_key: str):
    """FTC advancement summary for an event."""
    try:
        return await ftc_event_service.get_ftc_advancement(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC advancement for '{event_key}'.")
```

```python
async def get_ftc_advancement(event_key: str) -> dict:
    """Return advancing teams and optional point standings for an FTC event.

    FTC advancement rules by event_type:
    - Qualifier / Super Qualifier: Inspire Award winner + Winning Alliance captain advance.
    - League Tournament: Top N teams by league ranking points advance.
    - Championship (regional/state): Top N advance to FIRST Championship.

    Returns {"event_type": str, "advancing_teams": [...], "point_standings": [...]}
    """
    year, event_code = _parse_ftc_key(event_key)
    client = get_ftc_client()

    # Fetch event type + awards + rankings in parallel
    event_info, awards_raw, rankings_raw = await asyncio.gather(
        client.get_event(year, event_code),
        client.get_event_awards(year, event_code),
        client.get_rankings(year, event_code),
        return_exceptions=True,
    )
    # ... derive advancing_teams from Inspire winner + Alliance 1 captain
    # ... derive point_standings from rankings if available
    ...
    return {
        "event_type": event_type_string,
        "advancing_teams": advancing_teams,
        "point_standings": point_standings,
    }
```

---

## 7. Backend: `GET /ftc/{event_key}/history`

Add to `ftc_events.py` and `ftc_event_service.py`. FTC event history is harder to
pre-compute than FRC (no TBA historical data). Implement by querying the Supabase
`events` table for past editions sharing the same `region_code` + `event_type`:

```python
@router.get("/{event_key}/history")
async def ftc_event_history(event_key: str):
    """Year-over-year history for a recurring FTC event."""
    try:
        return await ftc_event_service.get_ftc_event_history(event_key)
    except HTTPException:
        raise
    except Exception as e:
        raise_api_error(e, fallback_detail=f"Could not load FTC event history for '{event_key}'.")
```

**Response shape**: mirrors `EventHistory` from `EVENT_SUMMARIES.md §7`, with
`most_inspire` replacing `most_impact` / `most_ei` / `most_ras`. No `most_finalists`
field (FTC finalist data sparsely available in historical records).

```json
{
  "event_name": "Oregon State Championship",
  "event_key": "2026ftcorcmp",
  "first_held": 2009,
  "editions": 17,
  "years_held": [2009, 2010, 2012, 2013, 2015, 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026],
  "most_wins": [
    { "team_number": 9872, "nickname": "Robotic Eagles", "count": 3 }
  ],
  "most_inspire": [
    { "team_number": 11406, "nickname": "Gear Works", "count": 2 }
  ],
  "timeline": [
    {
      "year": 2025,
      "event_key": "2025ftcorcmp",
      "winners": [{ "team_number": 9872, "nickname": "Robotic Eagles" }],
      "finalists": [{ "team_number": 14201, "nickname": "Iron Circuits" }],
      "inspire": { "team_number": 11406, "nickname": "Gear Works" }
    }
  ]
}
```

---

## 8. History Section View

```swift
struct FTCHistorySection: View {
    @Bindable var vm: FTCEventSummaryViewModel
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
                    ftcLeaderboard(title: "Most Wins",
                                   data: wins,
                                   icon: "trophy.fill",
                                   color: .yellow)
                }
                if let inspire = h.mostInspire, !inspire.isEmpty {
                    ftcLeaderboard(title: "Inspire Award",
                                   data: inspire,
                                   icon: "star.fill",
                                   color: .purple)
                }

                // Timeline
                if let tl = h.timeline, !tl.isEmpty {
                    Text("Timeline")
                        .font(.headline)
                    ForEach(tl) { year in
                        ftcTimelineCard(year)
                    }
                }
            } else {
                ProgressView()
                    .task { await vm.loadHistory(eventKey: eventKey) }
            }
        }
        .padding()
    }

    @ViewBuilder func ftcLeaderboard(title: String, data: [FTCLeaderboard],
                                     icon: String, color: Color) -> some View {
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
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder func ftcTimelineCard(_ year: FTCTimelineYear) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(ftcSeasonLabel(year.year))
                .font(.subheadline.bold().monospacedDigit())

            if let winners = year.winners, !winners.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "trophy.fill")
                        .font(.caption2)
                        .foregroundStyle(.yellow)
                    Text(winners.map { "\($0.teamNumber)" }.joined(separator: " & "))
                        .font(.caption.monospacedDigit())
                }
            }
            if let finalists = year.finalists, !finalists.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "medal.fill")
                        .font(.caption2)
                        .foregroundStyle(.gray)
                    Text(finalists.map { "\($0.teamNumber)" }.joined(separator: " & "))
                        .font(.caption.monospacedDigit())
                }
            }
            if let inspire = year.inspire {
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .font(.caption2)
                        .foregroundStyle(.purple)
                    Text("\(inspire.teamNumber) \(inspire.nickname)")
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

## 9. What Does NOT Apply from `EVENT_SUMMARIES.md`

| FRC Section | FTC Status |
|---|---|
| `GET /api/events/{key}/summary` | **Replaced** by `GET /ftc/{key}/summary` |
| `hall_of_fame` | **Replaced** by `inspire_pedigree` (Inspire Award winners at event) |
| `impact_finalists` | **Replaced** by `inspire_finalists` |
| `top_scorers.epa` | Not available — use `opr_total / opr_auto / opr_dc` |
| `high_scores.red_teams` length | FTC alliances = **2 teams** (not 3) |
| `GET .../summary/season-awards` | **Replaced** by `GET /ftc/{key}/season-awards` |
| `GET .../summary/advancement` | **Replaced** by `GET /ftc/{key}/advancement` |
| `GET .../history` (FRC prefix) | **Replaced** by `GET /ftc/{key}/history` |
| Region tab / `GET .../region/facts` | **Omitted** — no FTC equivalent |
| `most_ei`, `most_ras`, `most_impact` leaderboards | **Replaced** by `most_inspire` only |
| `EventSummaryViewModel` | Use `FTCEventSummaryViewModel` |
| `EventSummaryResponse` | Use `FTCEventSummaryResponse` |

---

## 10. Implementation Order

1. **Backend** — add `get_ftc_event_summary` to `ftc_event_service.py`; wire
   `GET /{event_key}/summary` in `ftc_events.py`.
2. **Backend** — add `get_ftc_advancement` + route `/{event_key}/advancement`.
3. **Backend** — add `get_ftc_event_history` + route `/{event_key}/history` (can stub
   returning an empty timeline until the Supabase query is built).
4. **iOS** — add `FTCEventSummaryModels.swift` with all Codable structs from §3.
5. **iOS** — add `FTCEventSummaryViewModel.swift` with load methods from §4.
6. **iOS** — create `FTCEventInfoView.swift` with `FTCSummarySection` + `FTCHistorySection`.
7. **iOS** — gate from existing `EventInfoView`: branch on `store.activeMode == .ftc`.
8. Test against a known FTC event (`2026ftcorpor` or similar).
