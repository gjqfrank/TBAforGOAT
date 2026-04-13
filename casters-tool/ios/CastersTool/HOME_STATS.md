# Home Page Stat Boxes — Complete Wiring Guide

> **Purpose**: Three hero stat boxes at the top of the Home/Event page: **Highest Match Score**, **Highest EPA**, and **Most Wins**. All three use backend proxy endpoints.

---

## 1. Data Sources

| Hero Box | Source | Endpoint |
|----------|--------|----------|
| Highest Match Score | Backend (Statbotics proxy) | `GET /api/events/season-high-scores?year=2026` |
| Highest EPA | Same endpoint | Same — `top_epa` array |
| Most Wins | Backend (Statbotics proxy) | `GET /api/events/season-most-wins?year=2026&limit=10` |

---

## 2. API Response Shapes

### 2a. Season High Scores

```http
GET /api/events/season-high-scores?year=2026
```

```json
{
  "matches": [
    {
      "key": "2026caclv_sf1m1",
      "event_key": "2026caclv",
      "event_name": "Cloverdale Regional",
      "match_label": "SF1-1",
      "score": 285,
      "no_foul": 270,
      "teams": ["254", "1678", "846"],
      "color": "red"
    }
  ],
  "top_epa": [
    {
      "team": 2056,
      "name": "OP Robotics",
      "epa": 120.1
    }
  ],
  "team_names": {
    "254": "The Cheesy Poofs",
    "1678": "Citrus Circuits"
  }
}
```

- `matches`: Top 5 highest match scores (sorted by `no_foul` descending)
- `top_epa`: Top 5 EPA teams
- `team_names`: Name lookup for teams in top matches

### 2b. Most Wins (Backend Proxy)

```http
GET /api/events/season-most-wins?year=2026&limit=10
```

Returns a flat array (backend extracts the relevant fields from Statbotics):
```json
[
  {
    "team": 118,
    "name": "Robonauts",
    "country": "USA",
    "state": "TX",
    "wins": 110,
    "losses": 12,
    "ties": 0,
    "count": 122,
    "winrate": 0.9016,
    "epa": 104.8
  }
]
```

---

## 3. Data Models

```swift
struct SeasonHighScores: Codable {
    let matches: [HighScoreMatch]
    let topEpa: [TopEpaTeam]
    let teamNames: [String: String]

    enum CodingKeys: String, CodingKey {
        case matches
        case topEpa = "top_epa"
        case teamNames = "team_names"
    }
}

struct HighScoreMatch: Codable, Identifiable {
    var id: String { key }
    let key: String
    let eventKey: String
    let eventName: String?
    let matchLabel: String?
    let score: Int
    let noFoul: Int
    let teams: [String]
    let color: String

    enum CodingKeys: String, CodingKey {
        case key
        case eventKey = "event_key"
        case eventName = "event_name"
        case matchLabel = "match_label"
        case score
        case noFoul = "no_foul"
        case teams, color
    }
}

struct TopEpaTeam: Codable, Identifiable {
    var id: Int { team }
    let team: Int
    let name: String
    let epa: Double
}

// Most Wins team (from backend proxy)
struct MostWinsTeam: Codable, Identifiable {
    var id: Int { team }
    let team: Int
    let name: String
    let country: String?
    let state: String?
    let wins: Int
    let losses: Int
    let ties: Int
    let count: Int
    let winrate: Double
    let epa: Double
}
```

---

## 4. API Service

```swift
extension APIService {
    static func fetchSeasonHighScores(year: Int) async throws -> SeasonHighScores {
        let url = URL(string: "\(base)/events/season-high-scores?year=\(year)")!
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(SeasonHighScores.self, from: data)
    }

    static func fetchMostWins(year: Int, limit: Int = 10) async throws -> [MostWinsTeam] {
        return try await get(url: "\(base)/events/season-most-wins?year=\(year)&limit=\(limit)")
    }
}
```

---

## 5. Hero Box Views

### 5a. Container

```swift
struct HomeStatBoxes: View {
    let year: Int

    @State private var highScores: SeasonHighScores?
    @State private var mostWins: [MostWinsTeam] = []
    @State private var isLoading = true

    var body: some View {
        VStack(spacing: 12) {
            if isLoading {
                HStack(spacing: 12) {
                    ForEach(0..<3) { _ in
                        RoundedRectangle(cornerRadius: 16)
                            .fill(.quaternary)
                            .frame(height: 120)
                    }
                }
                .redacted(reason: .placeholder)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        // 1. Highest Match Score
                        if let top = highScores?.matches.first {
                            HeroBox(
                                title: "High Score",
                                icon: "flame.fill",
                                color: .orange,
                                mainValue: "\(top.noFoul)",
                                subtitle: top.teams.joined(separator: " · "),
                                detail: top.eventName ?? top.eventKey,
                                onTap: { /* optional drill-down */ }
                            )
                        }

                        // 2. Highest EPA
                        if let top = highScores?.topEpa.first {
                            HeroBox(
                                title: "Top EPA",
                                icon: "chart.bar.fill",
                                color: .blue,
                                mainValue: String(format: "%.1f", top.epa),
                                subtitle: "\(top.team) — \(top.name)",
                                detail: nil,
                                onTap: { /* optional drill-down */ }
                            )
                        }

                        // 3. Most Wins
                        if let top = mostWins.first {
                            HeroBox(
                                title: "Most Wins",
                                icon: "trophy.fill",
                                color: .yellow,
                                mainValue: "\(top.wins)",
                                subtitle: "\(top.team) — \(top.name)",
                                detail: "\(top.wins)-\(top.losses)-\(top.ties)",
                                onTap: { /* optional drill-down */ }
                            )
                        }
                    }
                    .padding(.horizontal)
                }
            }
        }
        .task { await loadData() }
    }

    func loadData() async {
        isLoading = true
        async let hs = try? APIService.fetchSeasonHighScores(year: year)
        async let mw = try? APIService.fetchMostWins(year: year)
        highScores = await hs
        mostWins = await mw ?? []
        isLoading = false
    }
}
```

### 5b. HeroBox Component

```swift
struct HeroBox: View {
    let title: String
    let icon: String
    let color: Color
    let mainValue: String
    let subtitle: String
    let detail: String?
    let onTap: (() -> Void)?

    var body: some View {
        Button(action: { onTap?() }) {
            VStack(alignment: .leading, spacing: 6) {
                // Header
                HStack(spacing: 6) {
                    Image(systemName: icon)
                        .font(.caption)
                        .foregroundStyle(color)
                    Text(title)
                        .font(.caption.bold())
                        .foregroundStyle(.secondary)
                }

                // Main value
                Text(mainValue)
                    .font(.system(size: 36, weight: .bold, design: .rounded))
                    .foregroundStyle(.primary)
                    .monospacedDigit()

                // Subtitle
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                // Detail
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .frame(width: 160, alignment: .leading)
            .padding()
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }
}
```

---

## 6. Drill-Down Lists (Optional)

Tapping a hero box can show a detail sheet:

### 6a. Top Matches Sheet

```swift
struct TopMatchesSheet: View {
    let matches: [HighScoreMatch]
    let teamNames: [String: String]

    var body: some View {
        NavigationStack {
            List(matches) { match in
                HStack {
                    VStack(alignment: .leading) {
                        Text(match.matchLabel ?? match.key)
                            .font(.subheadline.bold())
                        Text(match.eventName ?? match.eventKey)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("\(match.noFoul)")
                            .font(.title3.bold().monospacedDigit())
                        Text(match.teams.map { teamNames[$0] ?? $0 }.joined(separator: ", "))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Top Match Scores")
        }
    }
}
```

### 6b. Most Wins Sheet

```swift
struct MostWinsSheet: View {
    let teams: [MostWinsTeam]

    var body: some View {
        NavigationStack {
            List(teams) { team in
                HStack {
                    VStack(alignment: .leading) {
                        Text("\(team.team)")
                            .font(.subheadline.bold().monospacedDigit())
                        Text(team.name)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    VStack(alignment: .trailing) {
                        Text("\(team.wins)")
                            .font(.title3.bold().monospacedDigit())
                        Text("\(team.wins)-\(team.losses)-\(team.ties)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(.secondary)
                        Text(String(format: "%.0f%%", team.winrate * 100))
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
            }
            .navigationTitle("Most Wins")
        }
    }
}
```

---

## 7. Gotchas

1. **Most Wins is now proxied**: `GET /api/events/season-most-wins?year={year}&limit=10`. Backend caches for 10 minutes.
2. **`no_foul` vs `score`**: Display `no_foul` (score without opponent fouls) as the "true" high score, but keep `score` available for context.
3. **Backend caching**: Both stat endpoints are disk-cached for 10 minutes on the backend. Client-side caching is optional but recommended.
4. **Year detection**: The current season year can be derived from the selected event key (`Int(eventKey.prefix(4))`) or hardcoded for the season.
5. **Team names in matches**: The `team_names` dict in the high scores response provides names for teams in the top matches. Use this instead of making separate team lookups.
6. **Statbotics `record` shape**: The `record` object includes `wins`, `losses`, `ties`, `count`, and `winrate` (0.0–1.0 decimal, NOT percentage).
7. **Loading state**: Use `.redacted(reason: .placeholder)` for skeleton loading. The three API calls (high scores + most wins) should be parallelized.
