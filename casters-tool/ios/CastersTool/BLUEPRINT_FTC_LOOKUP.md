# Blueprint: FTC Team Lookup (iOS)
### For XCode Claude — implement the FTC variant of the Team Lookup / Spotlight view

---

## Overview

The FRC `LOOKUP.md` describes the general wiring for team lookup. This blueprint covers
the **FTC-specific divergences** only. Read `LOOKUP.md` first for the surrounding
navigation, entry points, and boilerplate; this doc replaces or overrides each FTC-specific
section.

When `store.activeMode == .ftc`, the lookup view must:

1. Hit the FTC lookup endpoint (different URL + shape).
2. Show FTC-specific stats (OPR components, global rank, no EPA/DPR/CCWM).
3. Replace prestige badges with FTC award equivalents.
4. Render per-event results with FTC playoff labels and 2-robot alliance roles.
5. Show season history using `event_results` instead of the FRC `seasons[]` model.

---

## 1. API Endpoint

```
GET /ftc/team/{team_number}?season={year}&include_history=true
```

- `team_number` — bare integer, e.g. `12345` (no "ftc" prefix in the URL).
- `season` — current FTC season year (kickoff year). Default is `2025` for the
  2025-2026 "DECODE" season.
- `include_history=true` — required to populate `season_achievements` and
  `all_awards`. Always pass this for the lookup view.

**No `event_key` parameter.** FTC lookup is season-scoped, not event-scoped.
The current event stats come from `event_results` filtered to the loaded event.

### Full response shape

```json
{
  "team_number": 12345,
  "team_key": "ftc12345",
  "nickname": "Gear Grinders",
  "name": "Gear Grinders / Sponsor A / Sponsor B",
  "school_name": "Lincoln High School",
  "city": "Portland",
  "state_prov": "Oregon",
  "country": "USA",
  "location": "Portland, Oregon, USA",
  "rookie_year": 2019,
  "website": "https://geargrinders.org",
  "season": 2025,

  "quick_stats": {
    "tot": { "value": 88.4, "rank": 312, "count": 8201 },
    "auto": { "value": 21.3, "rank": 290 },
    "dc": { "value": 55.7, "rank": 340 }
  },
  "opr_global": 88.4,
  "opr_auto_global": 21.3,
  "opr_dc_global": 55.7,
  "global_rank": 312,
  "total_teams": 8201,

  "awards": [
    { "name": "Think Award", "event": "Portland Qualifier", "award_id": 1 }
  ],
  "alliance_selections": [
    { "name": "Winning Alliance - Captain", "event": "Portland Qualifier", "award_id": 13 }
  ],

  "event_results": [
    {
      "event_name": "Portland Qualifier",
      "event_code": "ORPOR",
      "event_type": "Qualifier",
      "year": 2025,
      "date_end": "2026-01-18T00:00:00",
      "alliance": "Alliance Captain",
      "playoff_result": "Winner",
      "awards": ["Think Award"]
    }
  ],
  "events_this_season": [
    {
      "event_code": "ORPOR",
      "event_name": "Portland Qualifier",
      "event_type": "Qualifier",
      "city": "Portland",
      "state_prov": "Oregon",
      "start_date": "2026-01-17",
      "end_date": "2026-01-18",
      "year": 2025
    }
  ],

  "season_achievements": [
    { "year": 2024, "achievement": "Winner", "event_name": "Oregon State Championship" },
    { "year": 2023, "achievement": "Finalist", "event_name": "Pacific Northwest Regional" }
  ],
  "all_awards": [
    { "name": "Inspire Award", "event": "Oregon State Championship", "year": 2024 },
    { "name": "Think Award", "event": "Portland Qualifier", "year": 2023 }
  ],
  "program": "FTC"
}
```

---

## 2. Data Models (FTC-specific)

Add these alongside the existing FRC `TeamStats` model. They do **not** replace it.

```swift
// FTCTeamStats.swift

struct FTCTeamStats: Codable {
    let teamNumber: Int
    let teamKey: String
    let nickname: String
    let name: String
    let schoolName: String
    let city: String
    let stateProv: String
    let country: String
    let location: String
    let rookieYear: Int?
    let website: String
    let season: Int

    let quickStats: FTCQuickStats?
    let oprGlobal: Double?
    let oprAutoGlobal: Double?
    let oprDcGlobal: Double?
    let globalRank: Int?
    let totalTeams: Int?

    let awards: [FTCSimpleAward]
    let allianceSelections: [FTCSimpleAward]
    let eventResults: [FTCEventResult]
    let eventsThisSeason: [FTCEventEntry]
    let seasonAchievements: [FTCSeasonAchievement]?
    let allAwards: [FTCAllTimeAward]?
    let program: String

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case teamKey = "team_key"
        case nickname, name
        case schoolName = "school_name"
        case city
        case stateProv = "state_prov"
        case country, location
        case rookieYear = "rookie_year"
        case website, season
        case quickStats = "quick_stats"
        case oprGlobal = "opr_global"
        case oprAutoGlobal = "opr_auto_global"
        case oprDcGlobal = "opr_dc_global"
        case globalRank = "global_rank"
        case totalTeams = "total_teams"
        case awards
        case allianceSelections = "alliance_selections"
        case eventResults = "event_results"
        case eventsThisSeason = "events_this_season"
        case seasonAchievements = "season_achievements"
        case allAwards = "all_awards"
        case program
    }
}

struct FTCQuickStats: Codable {
    let tot: FTCStatEntry?
    let auto: FTCStatEntry?
    let dc: FTCStatEntry?
}

struct FTCStatEntry: Codable {
    let value: Double?
    let rank: Int?
    let count: Int?
}

struct FTCSimpleAward: Codable, Identifiable {
    var id: String { "\(awardId ?? 0)-\(event)" }
    let name: String
    let event: String
    let awardId: Int?

    enum CodingKeys: String, CodingKey {
        case name, event
        case awardId = "award_id"
    }
}

struct FTCEventResult: Codable, Identifiable {
    var id: String { "\(year)-\(eventCode)" }
    let eventName: String
    let eventCode: String
    let eventType: String
    let year: Int
    let dateEnd: String
    let alliance: String?        // "Alliance Captain", "1st Team Selected", etc.
    let playoffResult: String?   // "Winner", "Finalist", nil
    let awards: [String]

    enum CodingKeys: String, CodingKey {
        case eventName = "event_name"
        case eventCode = "event_code"
        case eventType = "event_type"
        case year
        case dateEnd = "date_end"
        case alliance
        case playoffResult = "playoff_result"
        case awards
    }
}

struct FTCEventEntry: Codable, Identifiable {
    var id: String { eventCode }
    let eventCode: String
    let eventName: String
    let eventType: String
    let city: String
    let stateProv: String
    let startDate: String
    let endDate: String
    let year: Int

    enum CodingKeys: String, CodingKey {
        case eventCode = "event_code"
        case eventName = "event_name"
        case eventType = "event_type"
        case city
        case stateProv = "state_prov"
        case startDate = "start_date"
        case endDate = "end_date"
        case year
    }
}

struct FTCSeasonAchievement: Codable, Identifiable {
    var id: Int { year }
    let year: Int
    let achievement: String   // "Winner", "Finalist", "Qualifications", "No events"
    let eventName: String
}

struct FTCAllTimeAward: Codable, Identifiable {
    var id: String { "\(year)-\(name)-\(event)" }
    let name: String
    let event: String
    let year: Int
}
```

---

## 3. Fetch the FTC Lookup

Add a method to `BroadcastStore` (or a dedicated `FTCLookupService`):

```swift
// In BroadcastStore or a service layer:

@MainActor
func loadFTCLookup(teamNumber: Int) async {
    let season = currentFTCSeason()   // derive from store.eventKey or hard-code 2025
    guard let url = URL(string: "\(baseURL)/ftc/team/\(teamNumber)?season=\(season)&include_history=true") else { return }

    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        selectedFTCTeam = try JSONDecoder().decode(FTCTeamStats.self, from: data)
    } catch {
        // handle
    }
}

private func currentFTCSeason() -> Int {
    // FTC season: kickoff year. For 2025-2026 "DECODE" season, this is 2025.
    // Derive from the loaded event's event_key prefix if available,
    // otherwise use the store's known current season.
    if let eventKey = store.selectedEventKey, eventKey.contains("ftc") {
        return Int(eventKey.prefix(4)) ?? 2025
    }
    return 2025
}
```

Add `@State var selectedFTCTeam: FTCTeamStats? = nil` to the lookup view (or store).

---

## 4. View Layout — Section by Section

Gate the entire FTC lookup view behind `store.activeMode == .ftc`.
In the navigation destination, branch on mode:

```swift
// Inside the NavigationSplitView detail or NavigationStack destination:
if store.activeMode == .ftc {
    FTCTeamLookupView(teamNumber: store.selectedTeamNumber)
} else {
    TeamLookupView(...)   // existing FRC view
}
```

---

### 4a. Header Card

Same structure as FRC — reuse `TeamLookupHeader`. Pass the FTC fields:

```swift
TeamLookupHeader(
    teamNumber: team.teamNumber,
    nickname: team.nickname,
    school: team.schoolName,
    location: team.location,
    rookieYear: team.rookieYear,
    avatar: nil              // FTC avatars are CSS sprites, not direct image URLs
)
```

> **FTC Avatars**: The FTC scoring server serves avatars as a CSS sprite sheet at
> `https://ftc-scoring.firstinspires.org/avatars/composed/{year}.css`.
> The backend provides a proxy at `GET /ftc/avatar-css/{year}` that strips CORS headers.
> Parsing sprite coordinates from CSS is complex — skip avatars in the first pass and
> show the team number placeholder.

---

### 4b. Prestige Badges Row (FTC version)

FTC equivalents of FRC prestige:

| FTC Award | FRC Equivalent | Display |
|---|---|---|
| Inspire Award (awardId 11) | Impact / Chairman's | "Inspire Award" |
| Winning Alliance (awardId 13) | Event Winner | counted as blue banner |
| Finalist Alliance (awardId 12) | Event Finalist | — |

No Hall of Fame in FTC.

Count Inspire awards and alliance wins across `all_awards`:

```swift
struct FTCPrestigeBadges: View {
    let team: FTCTeamStats

    private var inspireCount: Int {
        (team.allAwards ?? []).filter { $0.name.lowercased().contains("inspire") }.count
    }

    private var winnerCount: Int {
        (team.allAwards ?? []).filter {
            $0.name.lowercased().contains("winning alliance")
        }.count
    }

    private var globalRankText: String? {
        guard let rank = team.globalRank, let total = team.totalTeams else { return nil }
        return "#\(rank) of \(total)"
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if inspireCount > 0 {
                    PrestigePill(icon: "star.fill",
                                 text: "\(inspireCount)× Inspire",
                                 color: .purple)
                }
                if winnerCount > 0 {
                    PrestigePill(icon: "trophy.fill",
                                 text: "\(winnerCount)× Alliance Winner",
                                 color: .yellow)
                }
                if let rankText = globalRankText {
                    PrestigePill(icon: "chart.bar.fill",
                                 text: "Global \(rankText)",
                                 color: .indigo)
                }
            }
            .padding(.horizontal)
        }
    }
}
```

---

### 4c. Current Event Stats Card (FTC version)

The FRC card shows Rank, Record, OPR, EPA, Avg RP, DPR, CCWM, Played.
FTC replaces this with OPR components and season averages.

**Find current-event data**: filter `team.eventResults` by the loaded event key's event code.
The event code is the suffix of the event key after "ftcNNNN" (e.g. `"2026ftcorpor"` → `"orpor"`).

```swift
struct FTCCurrentEventCard: View {
    let result: FTCEventResult   // the entry matching the current event

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("This Event")
                .font(.headline)

            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible()),
                           GridItem(.flexible()), GridItem(.flexible())],
                spacing: 12
            ) {
                // Playoff result badge if competed
                if let pr = result.playoffResult {
                    MiniStatCard(label: "Result", value: pr)
                }
                if let alliance = result.alliance {
                    MiniStatCard(label: "Alliance", value: alliance)
                }
            }

            // Awards at this event
            if !result.awards.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Awards")
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                    ForEach(result.awards, id: \.self) { awardName in
                        Label(awardName, systemImage: ftcAwardIcon(awardName))
                            .font(.caption)
                    }
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

---

### 4d. Global OPR Card

Show OPR components from FTC Scout QuickStats. These are **global season OPRs**, not
event-local:

```swift
struct FTCGlobalOPRCard: View {
    let team: FTCTeamStats

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Season OPR")
                    .font(.headline)
                Spacer()
                if let rank = team.globalRank, let total = team.totalTeams {
                    Text("Global #\(rank) / \(total)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            LazyVGrid(
                columns: [GridItem(.flexible()), GridItem(.flexible()),
                           GridItem(.flexible())],
                spacing: 12
            ) {
                MiniStatCard(label: "Total OPR",
                             value: team.oprGlobal.map { String(format: "%.1f", $0) } ?? "—")
                MiniStatCard(label: "Auto OPR",
                             value: team.oprAutoGlobal.map { String(format: "%.1f", $0) } ?? "—")
                MiniStatCard(label: "DC OPR",
                             value: team.oprDcGlobal.map { String(format: "%.1f", $0) } ?? "—")
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

> **No EPA for FTC.** FTC Scout QuickStats (`tot/auto/dc`) serve as the performance
> metric. Do not display an EPA cell.

---

### 4e. Current Season Awards

Show `team.awards` (non-alliance awards this season) + `team.allianceSelections`:

```swift
struct FTCCurrentSeasonAwards: View {
    let team: FTCTeamStats

    var body: some View {
        let allThisSeason = team.awards + team.allianceSelections
        if allThisSeason.isEmpty { return AnyView(EmptyView()) }

        return AnyView(
            VStack(alignment: .leading, spacing: 6) {
                Text("This Season")
                    .font(.headline)

                ForEach(allThisSeason) { award in
                    HStack {
                        Image(systemName: ftcAwardIcon(award.name))
                            .foregroundStyle(ftcAwardColor(award.name))
                        VStack(alignment: .leading) {
                            Text(award.name)
                                .font(.subheadline)
                            Text(award.event)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
            }
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        )
    }
}
```

---

### 4f. Season History Table

FTC uses `event_results` (per completed event) rather than a nested seasons/events model.
Group `team.eventResults` by `year` and render as collapsible sections — same
`SeasonRow` + `DisclosureGroup` pattern from `LOOKUP.md §4b`, with FTC column labels.

**Columns per event row**: Event Name · Type · Alliance Role · Result · Awards

```swift
struct FTCSeasonHistorySection: View {
    let eventResults: [FTCEventResult]
    @State private var expandedYears: Set<Int> = []

    private var byYear: [(year: Int, events: [FTCEventResult])] {
        let grouped = Dictionary(grouping: eventResults, by: \.year)
        return grouped.keys.sorted(by: >).map { y in
            (year: y, events: grouped[y]!.sorted { $0.dateEnd > $1.dateEnd })
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Season History")
                .font(.headline)
                .padding(.bottom, 8)

            ForEach(byYear, id: \.year) { group in
                FTCSeasonYearRow(
                    year: group.year,
                    events: group.events,
                    isExpanded: expandedYears.contains(group.year),
                    toggle: {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            if expandedYears.contains(group.year) {
                                expandedYears.remove(group.year)
                            } else {
                                expandedYears.insert(group.year)
                            }
                        }
                    }
                )
                Divider()
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .onAppear {
            if let mostRecent = byYear.first?.year {
                expandedYears.insert(mostRecent)
            }
        }
    }
}

struct FTCSeasonYearRow: View {
    let year: Int
    let events: [FTCEventResult]
    let isExpanded: Bool
    let toggle: () -> Void

    /// Best achievement this year (Winner > Finalist > Qualifications)
    private var yearSummary: String {
        if events.contains(where: { $0.playoffResult == "Winner" }) { return "Won" }
        if events.contains(where: { $0.playoffResult == "Finalist" }) { return "Finalist" }
        return "\(events.count) event\(events.count == 1 ? "" : "s")"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                HStack {
                    // FTC season label: "2025-26 DECODE"
                    Text(ftcSeasonLabel(year))
                        .font(.subheadline.bold().monospacedDigit())
                    Spacer()
                    if !isExpanded {
                        Text(yearSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)

            if isExpanded {
                ForEach(events) { ev in
                    FTCEventResultRow(event: ev)
                        .padding(.leading, 8)
                    if ev.id != events.last?.id { Divider().padding(.leading, 8) }
                }
            }
        }
    }
}

struct FTCEventResultRow: View {
    let event: FTCEventResult

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Playoff result indicator
            Circle()
                .fill(resultColor(event.playoffResult))
                .frame(width: 8, height: 8)
                .padding(.top, 5)

            VStack(alignment: .leading, spacing: 2) {
                Text(event.eventName)
                    .font(.subheadline)

                HStack(spacing: 6) {
                    Text(event.eventType)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let alliance = event.alliance {
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(alliance)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let result = event.playoffResult {
                        Text("·")
                            .foregroundStyle(.tertiary)
                        Text(result)
                            .font(.caption.bold())
                            .foregroundStyle(resultColor(result))
                    }
                }

                if !event.awards.isEmpty {
                    FlowLayout(spacing: 4) {
                        ForEach(event.awards, id: \.self) { award in
                            AwardChip(name: award)
                        }
                    }
                }
            }
            Spacer()
        }
        .padding(.vertical, 6)
    }

    private func resultColor(_ result: String?) -> Color {
        switch result {
        case "Winner": return .yellow
        case "Finalist": return .blue
        default: return .secondary
        }
    }
}
```

---

## 5. FTC Award Helpers

Add these free functions (or static members on a utility type):

```swift
func ftcAwardIcon(_ name: String) -> String {
    let n = name.lowercased()
    if n.contains("inspire") { return "star.fill" }
    if n.contains("winning alliance") || n.contains("winner") { return "trophy.fill" }
    if n.contains("finalist") { return "medal.fill" }
    if n.contains("think") { return "brain.head.profile" }
    if n.contains("connect") { return "network" }
    if n.contains("innovate") { return "lightbulb.fill" }
    if n.contains("design") { return "pencil.and.ruler.fill" }
    if n.contains("motivate") { return "megaphone.fill" }
    if n.contains("control") { return "gearshape.fill" }
    if n.contains("promote") { return "person.3.fill" }
    if n.contains("compass") { return "safari.fill" }
    if n.contains("judges") { return "rosette" }
    return "rosette"
}

func ftcAwardColor(_ name: String) -> Color {
    let n = name.lowercased()
    if n.contains("inspire") { return .purple }
    if n.contains("winning alliance") || n.contains("winner") { return .yellow }
    if n.contains("finalist") { return .blue }
    if n.contains("think") { return .cyan }
    if n.contains("innovate") { return .orange }
    return .indigo
}

/// Human-readable FTC season label: 2025 → "2025–26"
func ftcSeasonLabel(_ kickoffYear: Int) -> String {
    let end = (kickoffYear + 1) % 100
    return String(format: "%d–%02d", kickoffYear, end)
}
```

---

## 6. Full `FTCTeamLookupView` Assembly

```swift
struct FTCTeamLookupView: View {
    let teamNumber: Int
    @Environment(BroadcastStore.self) private var store
    @State private var team: FTCTeamStats? = nil
    @State private var isLoading = false
    @State private var error: String? = nil

    // The event code of the currently loaded event (for filtering current-event card)
    private var currentEventCode: String? {
        guard let ek = store.selectedEventKey else { return nil }
        // e.g. "2026ftcorpor" → strip year + "ftc" prefix
        let stripped = ek.dropFirst(4)   // drop "2026"
        if stripped.lowercased().hasPrefix("ftc") {
            return String(stripped.dropFirst(3)).lowercased()
        }
        return String(stripped).lowercased()
    }

    private var currentEventResult: FTCEventResult? {
        guard let code = currentEventCode else { return nil }
        return team?.eventResults.first { $0.eventCode.lowercased() == code }
    }

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView().padding(.top, 60)
            } else if let team {
                VStack(spacing: 16) {
                    // 1. Header
                    TeamLookupHeader(
                        teamNumber: team.teamNumber,
                        nickname: team.nickname,
                        school: team.schoolName.isEmpty ? nil : team.schoolName,
                        location: team.location,
                        rookieYear: team.rookieYear,
                        avatar: nil
                    )

                    // 2. Prestige badges
                    FTCPrestigeBadges(team: team)

                    // 3. Current event card (only if team is at this event)
                    if let result = currentEventResult {
                        FTCCurrentEventCard(result: result)
                    }

                    // 4. Global OPR
                    FTCGlobalOPRCard(team: team)

                    // 5. This-season awards
                    FTCCurrentSeasonAwards(team: team)

                    // 6. Season history
                    if let achievements = team.eventResults, !achievements.isEmpty {
                        FTCSeasonHistorySection(eventResults: achievements)
                    }
                }
                .padding()
            } else if let error {
                ContentUnavailableView(error, systemImage: "exclamationmark.triangle")
                    .padding(.top, 60)
            }
        }
        .navigationTitle("Team \(teamNumber)")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: teamNumber) {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        error = nil
        do {
            team = try await store.apiClient.fetchFTCTeam(teamNumber,
                                                          season: store.currentFTCSeason)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
```

---

## 7. Trigger Points

Same entry points as FRC lookup (`LOOKUP.md §1`), but only active in FTC mode.
In each entry point, branch on `store.activeMode`:

```swift
// Rankings row tap:
Button {
    if store.activeMode == .ftc {
        store.selectedFTCTeamNumber = team.teamNumber
    } else {
        store.selectedTeam = team
    }
} label: { ... }
```

Add `@Published var selectedFTCTeamNumber: Int? = nil` to `BroadcastStore`.
The `NavigationSplitView` detail column (and `NavigationStack` destination) switches
on which is non-nil.

---

## 8. What Does NOT Apply from `LOOKUP.md`

| FRC Section | FTC Status |
|---|---|
| `current_event.opr / epa / dpr / ccwm` | **Replaced** by `FTCGlobalOPRCard` |
| `current_event.avg_rp` | Not used. FTC RP is from `sort_orders[0]` in rankings |
| `awards.hall_of_fame` | **No FTC equivalent** — omit |
| `awards.blue_banner_count` | Use Inspire count + Winning Alliance count instead |
| `seasons[].events[].opr` | Not in FTC history response; omit from history rows |
| Avatar (base64 PNG from TBA) | **Not available** — show team number placeholder |
| Social media links | Not returned by FTC API — omit |
| `stageLabel(for: .ftc)` from `BLUEPRINT_FTC_MODE.md` | Use `event.playoff_result` directly |

---

## 9. Implementation Order

1. Add `FTCTeamStats` and related models to `Models.swift` (no SwiftData — this is
   API response only, not cached locally).
2. Add `fetchFTCTeam(_:season:)` to `APIClient` (or however the app wraps `URLSession`).
3. Add `selectedFTCTeamNumber` + `currentFTCSeason` to `BroadcastStore`.
4. Create `FTCTeamLookupView.swift` with sections 4a–4f.
5. Create `FTCPrestigeBadges`, `FTCCurrentEventCard`, `FTCGlobalOPRCard`,
   `FTCCurrentSeasonAwards`, `FTCSeasonHistorySection` in the same file or separate files.
6. Add `ftcAwardIcon`, `ftcAwardColor`, `ftcSeasonLabel` helpers.
7. Wire the navigation branch in `ContentView`/`CockpitLayout`/`CompactLayout`.
8. Test with a known FTC team number at a live event (e.g. `12345` at `2026ftcorpor`).

---

## Backend Reference

| Endpoint | Purpose |
|---|---|
| `GET /ftc/team/{num}?season={year}&include_history=true` | Full team lookup card |
| `GET /ftc/team/{num}/opr-history?season={year}` | OPR trend across events (optional chart) |
| `GET /ftc/teams/awards-summary?teams=12345,67890` | Batch prestige summary |
| `GET /ftc/{event_key}/past-awards` | Previous-season awards at an event (used in rankings, not lookup) |
| `GET /ftc/avatar-css/{year}` | CSS sprite sheet proxy (skip for now) |
