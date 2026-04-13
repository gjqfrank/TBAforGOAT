# Team Lookup / Spotlight — Complete Wiring Guide

> **Purpose**: This document instructs the Xcode Claude agent on how to wire the Team Lookup (Spotlight) view. The view is mostly built; the **primary issue is the Season-by-Season Achievements table** which is not rendering correctly. This guide focuses on fixing that, plus ensuring all other lookup sub-sections are correctly wired.

---

## 1. How Lookup Is Triggered

Team Lookup opens from multiple entry points:
- **Rankings tab**: Tap any team row
- **PbP tab**: Tap team number badge
- **Battle Station**: Tap a team pill
- **Notes panel**: Tap a team reference
- **Context menu**: "Lookup" action from long-press

On **iPad**, this populates the right detail column via `NavigationSplitView`. On **iPhone**, it pushes onto the `NavigationStack`.

```swift
// Set store.selectedTeam to trigger navigation
store.selectedTeam = rankings.first { $0.teamKey == team.teamKey }
```

---

## 2. API Call

```
GET /api/teams/{team_number}/stats?event_key={event_key}
```

**Response shape** (actual backend response):
```json
{
  "team_number": 254,
  "nickname": "The Cheesy Poofs",
  "school_name": "Bellarmine College Preparatory",
  "city": "San Jose",
  "state_prov": "California",
  "country": "USA",
  "rookie_year": 1999,
  "website": "http://www.team254.com",
  "motto": null,
  "robot_name": "Callisto",
  "name_pronounce": null,
  "sponsor_read": "NASA Ames Research Center / Google / ...",

  "current_event": {
    "event_key": "2026tuak",
    "rank": 1,
    "record": "10-2-0",
    "opr": 55.2,
    "epa": 60.1,
    "avg_rp": 2.85,
    "qual_average": 100.5,
    "dpr": 22.3,
    "ccwm": 32.9,
    "matches_played": 12,
    "next_match": "2026tuak_qm45",
    "last_match": "2026tuak_qm40"
  },

  "awards": {
    "blue_banner_count": 42,
    "hall_of_fame": true,
    "hof_year": 2016,
    "impact_count": 8,
    "ei_count": 2,
    "ras_count": 0,
    "recent_awards": [
      { "name": "Impact Award", "year": 2024, "event_name": "Houston Championship" },
      { "name": "Event Winner", "year": 2024, "event_name": "Silicon Valley Regional" }
    ]
  },

  "seasons": [
    {
      "year": 2025,
      "events": [
        {
          "event_key": "2025casj",
          "event_name": "Silicon Valley Regional",
          "rank": 1,
          "record": "12-0-0",
          "opr": 62.1,
          "playoff_status": "Winner",
          "awards": ["Event Winner", "Excellence in Engineering"]
        },
        {
          "event_key": "2025arc",
          "event_name": "Archimedes Division",
          "rank": 3,
          "record": "8-4-0",
          "opr": 58.7,
          "playoff_status": "Finalist",
          "awards": ["Division Finalist"]
        }
      ]
    },
    {
      "year": 2024,
      "events": [...]
    }
  ],

  "social_media": [
    { "type": "twitter-profile", "foreign_key": "FRC254" },
    { "type": "youtube-channel", "foreign_key": "UC..." },
    { "type": "github-profile", "foreign_key": "Team254" }
  ]
}
```

---

## 3. View Layout — Top to Bottom

### 3a. Header Card

```swift
struct TeamLookupHeader: View {
    let team: TeamStats
    let avatar: UIImage?  // from avatars cache

    var body: some View {
        VStack(spacing: 8) {
            // Avatar or placeholder
            if let avatar {
                Image(uiImage: avatar)
                    .resizable()
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.ultraThinMaterial)
                        .frame(width: 64, height: 64)
                    Text("\(team.teamNumber)")
                        .font(.title2.bold().monospacedDigit())
                }
            }

            Text(team.nickname)
                .font(.title2.bold())

            // Location
            Text([team.city, team.stateProv, team.country].compactMap { $0 }.joined(separator: ", "))
                .font(.subheadline)
                .foregroundStyle(.secondary)

            // School / Organization
            if let school = team.schoolName {
                Text(school)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            // Rookie year
            Text("Est. \(team.rookieYear)")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}
```

### 3b. Prestige Badges Row

Show Hall of Fame, Impact counts, blue banners as horizontal badges:

```swift
struct PrestigeBadges: View {
    let awards: TeamAwardsSummary

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                if awards.hallOfFame, let year = awards.hofYear {
                    PrestigePill(icon: "star.fill", text: "Hall of Fame \(year)", color: .yellow)
                }
                if awards.blueBannerCount > 0 {
                    PrestigePill(icon: "flag.fill", text: "\(awards.blueBannerCount) Blue Banners", color: .blue)
                }
                if awards.impactCount > 0 {
                    PrestigePill(icon: "sparkles", text: "\(awards.impactCount)× Impact", color: .purple)
                }
                if awards.eiCount > 0 {
                    PrestigePill(icon: "lightbulb.fill", text: "\(awards.eiCount)× EI", color: .orange)
                }
            }
            .padding(.horizontal)
        }
    }
}

struct PrestigePill: View {
    let icon: String
    let text: String
    let color: Color

    var body: some View {
        Label(text, systemImage: icon)
            .font(.caption.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(color.gradient, in: Capsule())
    }
}
```

### 3c. Current Event Stats Card

Only shown when `current_event` is non-nil (team is at the loaded event):

```swift
struct CurrentEventCard: View {
    let stats: CurrentEventStats

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("This Event")
                .font(.headline)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()),
                                GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                MiniStatCard(label: "Rank", value: "#\(stats.rank)")
                MiniStatCard(label: "Record", value: stats.record)
                MiniStatCard(label: "OPR", value: String(format: "%.1f", stats.opr))
                MiniStatCard(label: "EPA", value: String(format: "%.1f", stats.epa))
                MiniStatCard(label: "Avg RP", value: String(format: "%.2f", stats.avgRP))
                MiniStatCard(label: "DPR", value: String(format: "%.1f", stats.dpr))
                MiniStatCard(label: "CCWM", value: String(format: "%.1f", stats.ccwm))
                MiniStatCard(label: "Played", value: "\(stats.matchesPlayed)")
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}
```

### 3d. Recent Awards List

Show the most recent awards (from `awards.recent_awards`):

```swift
struct RecentAwardsList: View {
    let awards: [RecentAward]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Recent Awards")
                .font(.headline)

            ForEach(awards, id: \.name) { award in
                HStack {
                    Image(systemName: awardIcon(award.name))
                        .foregroundStyle(awardColor(award.name))
                    VStack(alignment: .leading) {
                        Text(award.name)
                            .font(.subheadline)
                        Text("\(award.eventName) · \(award.year)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }

    func awardIcon(_ name: String) -> String {
        if name.contains("Winner") { return "trophy.fill" }
        if name.contains("Finalist") { return "medal.fill" }
        if name.contains("Impact") || name.contains("Chairman") { return "star.fill" }
        if name.contains("Inspiration") { return "lightbulb.fill" }
        return "rosette"
    }

    func awardColor(_ name: String) -> Color {
        if name.contains("Winner") { return .yellow }
        if name.contains("Finalist") { return .gray }
        if name.contains("Impact") { return .purple }
        return .blue
    }
}
```

---

## 4. Season-by-Season Achievements Table — THE PRIMARY FIX

**This is the section that's broken.** The `seasons` array in the API response contains year-grouped event entries with rank, record, OPR, playoff status, and awards. Here's exactly how to render it.

### 4a. Data Model

```swift
struct TeamSeason: Codable, Identifiable {
    var id: Int { year }
    let year: Int
    let events: [TeamSeasonEvent]
}

struct TeamSeasonEvent: Codable, Identifiable {
    var id: String { eventKey }
    let eventKey: String
    let eventName: String
    let rank: Int?
    let record: String?
    let opr: Double?
    let playoffStatus: String?     // "Winner", "Finalist", "Semifinalist", "Quarterfinalist", null
    let awards: [String]           // ["Event Winner", "Excellence in Engineering"]

    enum CodingKeys: String, CodingKey {
        case eventKey = "event_key"
        case eventName = "event_name"
        case rank, record, opr
        case playoffStatus = "playoff_status"
        case awards
    }
}
```

### 4b. The Table View

**Critical implementation detail**: Each season is a `DisclosureGroup` (expandable), with the year as the header. Inside, each event is a row. The **most recent season should be expanded by default**, all others collapsed.

```swift
struct SeasonAchievementsSection: View {
    let seasons: [TeamSeason]
    @State private var expandedYears: Set<Int> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Season History")
                .font(.headline)
                .padding(.bottom, 8)

            ForEach(seasons) { season in
                SeasonRow(
                    season: season,
                    isExpanded: expandedYears.contains(season.year),
                    toggle: {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            if expandedYears.contains(season.year) {
                                expandedYears.remove(season.year)
                            } else {
                                expandedYears.insert(season.year)
                            }
                        }
                    }
                )

                if season.id != seasons.last?.id {
                    Divider()
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .onAppear {
            // Auto-expand the most recent season
            if let first = seasons.first {
                expandedYears.insert(first.year)
            }
        }
    }
}
```

### 4c. Individual Season Row

```swift
struct SeasonRow: View {
    let season: TeamSeason
    let isExpanded: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // ── Season header (tappable) ──
            Button(action: toggle) {
                HStack {
                    Text("\(season.year)")
                        .font(.subheadline.bold().monospacedDigit())

                    Spacer()

                    // Summary badges for collapsed view
                    if !isExpanded {
                        seasonSummaryBadges
                    }

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.vertical, 10)

            // ── Expanded event list ──
            if isExpanded {
                VStack(spacing: 8) {
                    ForEach(season.events) { event in
                        SeasonEventCard(event: event)
                    }
                }
                .padding(.bottom, 8)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    /// Compact badges shown when the season row is collapsed
    @ViewBuilder var seasonSummaryBadges: some View {
        HStack(spacing: 4) {
            // Count events
            Text("\(season.events.count) event\(season.events.count == 1 ? "" : "s")")
                .font(.caption2)
                .foregroundStyle(.secondary)

            // Show trophies for any wins/finalists
            let wins = season.events.filter { $0.playoffStatus == "Winner" }.count
            let finalists = season.events.filter { $0.playoffStatus == "Finalist" }.count

            if wins > 0 {
                Label("\(wins)", systemImage: "trophy.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.yellow)
            }
            if finalists > 0 {
                Label("\(finalists)", systemImage: "medal.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.gray)
            }

            // Show impact/EI awards
            let impactEvents = season.events.filter { e in
                e.awards.contains { $0.contains("Impact") || $0.contains("Chairman") }
            }.count
            if impactEvents > 0 {
                Label("\(impactEvents)", systemImage: "star.fill")
                    .font(.caption2.bold())
                    .foregroundStyle(.purple)
            }
        }
    }
}
```

### 4d. Individual Event Card (Inside Expanded Season)

```swift
struct SeasonEventCard: View {
    let event: TeamSeasonEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Event name + playoff badge
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(event.eventName)
                        .font(.subheadline.bold())
                    // Stats row
                    HStack(spacing: 12) {
                        if let rank = event.rank {
                            Label("#\(rank)", systemImage: "number")
                                .font(.caption.monospacedDigit())
                        }
                        if let record = event.record {
                            Label(record, systemImage: "sportscourt")
                                .font(.caption.monospacedDigit())
                        }
                        if let opr = event.opr {
                            Label(String(format: "%.1f", opr), systemImage: "chart.bar")
                                .font(.caption.monospacedDigit())
                        }
                    }
                    .foregroundStyle(.secondary)
                }

                Spacer()

                // Playoff result badge
                if let status = event.playoffStatus {
                    PlayoffStatusBadge(status: status)
                }
            }

            // Awards chips
            if !event.awards.isEmpty {
                FlowLayout(spacing: 4) {
                    ForEach(event.awards, id: \.self) { award in
                        AwardChip(name: award)
                    }
                }
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct PlayoffStatusBadge: View {
    let status: String

    var body: some View {
        Text(status)
            .font(.caption2.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(statusColor, in: Capsule())
    }

    var statusColor: Color {
        switch status {
        case "Winner": .yellow.opacity(0.8)
        case "Finalist": .gray
        case "Semifinalist": .blue.opacity(0.6)
        default: .secondary
        }
    }
}

struct AwardChip: View {
    let name: String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: chipIcon)
                .font(.caption2)
            Text(name)
                .font(.caption2)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(chipColor.opacity(0.15), in: Capsule())
        .foregroundStyle(chipColor)
    }

    var chipIcon: String {
        if name.contains("Winner") { return "trophy.fill" }
        if name.contains("Impact") || name.contains("Chairman") { return "star.fill" }
        if name.contains("Inspiration") { return "lightbulb.fill" }
        if name.contains("Rookie") { return "sparkle" }
        return "rosette"
    }

    var chipColor: Color {
        if name.contains("Winner") { return .yellow }
        if name.contains("Impact") || name.contains("Chairman") { return .purple }
        if name.contains("Inspiration") { return .orange }
        if name.contains("Rookie") { return .green }
        return .blue
    }
}
```

### 4e. FlowLayout Helper

SwiftUI doesn't have a built-in flow/wrap layout. Use this:

```swift
struct FlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: ProposedViewSize(width: bounds.width, height: bounds.height), subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                                  proposal: ProposedViewSize(result.sizes[index]))
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint], sizes: [CGSize]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var sizes: [CGSize] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            sizes.append(size)
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalHeight = max(totalHeight, y + rowHeight)
        }

        return (CGSize(width: maxWidth, height: totalHeight), positions, sizes)
    }
}
```

---

## 5. Common Parsing Issues to Avoid

**Problem 1: `seasons` array might be empty or nil**
```swift
// WRONG — crashes on nil
let seasons = response.seasons

// RIGHT — default to empty
let seasons = response.seasons ?? []
```

**Problem 2: CodingKeys mismatch**
The API uses `snake_case`. Make sure ALL keys map correctly:
- `event_key` → `eventKey`
- `event_name` → `eventName`
- `playoff_status` → `playoffStatus`
- `rookie_year` → `rookieYear`
- `school_name` → `schoolName`
- `state_prov` → `stateProv`
- `blue_banner_count` → `blueBannerCount`

**Problem 3: Nested decoding**
The response has nested objects (`current_event`, `awards`, `seasons[].events[]`). Use nested Codable structs, not `AnyCodable` for structured data.

**Problem 4: The `record` field is a string like `"10-2-0"` (W-L-T)**
Do NOT try to decode it as separate integers. It's a pre-formatted string from the backend.

**Problem 5: `awards` inside each event is `[String]` — an array of award name strings, NOT the same shape as the top-level `awards` object.**

---

## 6. Full TeamStats Codable Model

```swift
struct TeamStats: Codable {
    let teamNumber: Int
    let nickname: String
    let schoolName: String?
    let city: String?
    let stateProv: String?
    let country: String?
    let rookieYear: Int
    let website: String?
    let motto: String?
    let robotName: String?
    let namePronounce: String?
    let sponsorRead: String?
    let currentEvent: CurrentEventStats?
    let awards: TeamAwardsSummary
    let seasons: [TeamSeason]?
    let socialMedia: [SocialLink]?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname
        case schoolName = "school_name"
        case city
        case stateProv = "state_prov"
        case country
        case rookieYear = "rookie_year"
        case website, motto
        case robotName = "robot_name"
        case namePronounce = "name_pronounce"
        case sponsorRead = "sponsor_read"
        case currentEvent = "current_event"
        case awards, seasons
        case socialMedia = "social_media"
    }
}

struct CurrentEventStats: Codable {
    let eventKey: String
    let rank: Int
    let record: String
    let opr: Double
    let epa: Double
    let avgRP: Double
    let qualAverage: Double?
    let dpr: Double?
    let ccwm: Double?
    let matchesPlayed: Int
    let nextMatch: String?
    let lastMatch: String?

    enum CodingKeys: String, CodingKey {
        case eventKey = "event_key"
        case rank, record, opr, epa
        case avgRP = "avg_rp"
        case qualAverage = "qual_average"
        case dpr, ccwm
        case matchesPlayed = "matches_played"
        case nextMatch = "next_match"
        case lastMatch = "last_match"
    }
}

struct TeamAwardsSummary: Codable {
    let blueBannerCount: Int
    let hallOfFame: Bool
    let hofYear: Int?
    let impactCount: Int
    let eiCount: Int
    let rasCount: Int
    let recentAwards: [RecentAward]?

    enum CodingKeys: String, CodingKey {
        case blueBannerCount = "blue_banner_count"
        case hallOfFame = "hall_of_fame"
        case hofYear = "hof_year"
        case impactCount = "impact_count"
        case eiCount = "ei_count"
        case rasCount = "ras_count"
        case recentAwards = "recent_awards"
    }
}

struct RecentAward: Codable {
    let name: String
    let year: Int
    let eventName: String

    enum CodingKeys: String, CodingKey {
        case name, year
        case eventName = "event_name"
    }
}

struct SocialLink: Codable {
    let type: String
    let foreignKey: String

    enum CodingKeys: String, CodingKey {
        case type
        case foreignKey = "foreign_key"
    }
}
```

---

## 7. APIService Addition

```swift
func fetchTeamStats(teamNumber: Int, eventKey: String) async throws -> TeamStats {
    return try await get(url: "\(base)/teams/\(teamNumber)/stats?event_key=\(eventKey)")
}
```

---

## 8. Complete View Assembly

```swift
struct TeamLookupView: View {
    @Environment(BroadcastStore.self) private var store
    let teamNumber: Int
    @State private var stats: TeamStats?
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            if isLoading {
                ProgressView("Loading team data…")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else if let error {
                ContentUnavailableView("Error", systemImage: "exclamationmark.triangle",
                    description: Text(error))
            } else if let stats {
                VStack(spacing: 16) {
                    TeamLookupHeader(team: stats, avatar: nil) // wire avatar from cache

                    PrestigeBadges(awards: stats.awards)

                    if let current = stats.currentEvent {
                        CurrentEventCard(stats: current)
                    }

                    if let recent = stats.awards.recentAwards, !recent.isEmpty {
                        RecentAwardsList(awards: recent)
                    }

                    if let seasons = stats.seasons, !seasons.isEmpty {
                        SeasonAchievementsSection(seasons: seasons)
                    }
                }
                .padding()
            }
        }
        .navigationTitle("Team \(teamNumber)")
        .task {
            await loadStats()
        }
    }

    func loadStats() async {
        guard let ek = store.selectedEvent else { return }
        isLoading = true
        error = nil
        do {
            stats = try await APIService.shared.fetchTeamStats(teamNumber: teamNumber, eventKey: ek)
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }
}
```
