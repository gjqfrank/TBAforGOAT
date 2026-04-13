# Attribute Tags & Sponsors — Complete Wiring Guide

> **Purpose**: Fix two known issues: (1) Strategy/Hardware tags from TIMS overrides not displaying properly in the iOS app, and (2) Sponsors data from GATool not wiring correctly. This document covers the exact data paths, parsing logic, and rendering for both.

---

## 1. Two Data Sources for Tags

| Source | Where Tags Live | Format |
|--------|----------------|--------|
| TIMS Overrides | `custom_hardware`, `custom_auto_strategy`, `custom_teleop_strategy` | JSON array string: `'["swerve","high shooter"]'` |
| Team Stats | Basic team data from TBA | No tags — only robot name, sponsors |

### TIMS Override Tag Fields

From `PUT /api/teams/{team_key}/tims-overrides`:
```json
{
  "custom_hardware": "[\"swerve\",\"shooter\",\"climber\"]",
  "custom_auto_strategy": "[\"4-piece auto\",\"center start\"]",
  "custom_teleop_strategy": "[\"cycle bot\",\"defense capable\"]"
}
```

**Critical**: These are **JSON-encoded string arrays**, NOT plain arrays. The backend stores them as text columns. You must `JSON.parse()` / `JSONDecoder` the string value.

---

## 2. Parsing Tags Safely

Tags may arrive as:
- Valid JSON array string: `'["swerve","shooter"]'`
- Comma-separated fallback: `"swerve, shooter"` (if hand-edited in Supabase)
- null/empty: no tags set

```swift
func parseTags(_ raw: String?) -> [String] {
    guard let raw, !raw.isEmpty else { return [] }

    // Try JSON array first
    if raw.hasPrefix("["),
       let data = raw.data(using: .utf8),
       let arr = try? JSONDecoder().decode([String].self, from: data) {
        return arr.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    // Fallback: comma-separated
    return raw.split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
}
```

---

## 3. Tag Display Components

### 3a. Tag Chip

```swift
struct TagChip: View {
    let text: String
    let category: TagCategory

    enum TagCategory {
        case hardware, autoStrategy, teleopStrategy

        var color: Color {
            switch self {
            case .hardware: .purple
            case .autoStrategy: .green
            case .teleopStrategy: .blue
            }
        }

        var icon: String {
            switch self {
            case .hardware: "wrench.and.screwdriver"
            case .autoStrategy: "gearshape.2"
            case .teleopStrategy: "gamecontroller"
            }
        }

        var label: String {
            switch self {
            case .hardware: "Hardware"
            case .autoStrategy: "Auto"
            case .teleopStrategy: "Teleop"
            }
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: category.icon)
                .font(.caption2)
            Text(text)
                .font(.caption)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .foregroundStyle(category.color)
        .background(category.color.opacity(0.1), in: Capsule())
        .overlay(Capsule().stroke(category.color.opacity(0.2), lineWidth: 1))
    }
}
```

### 3b. Tag Section

```swift
struct TagSection: View {
    let hardware: [String]
    let autoStrategy: [String]
    let teleopStrategy: [String]

    var body: some View {
        if hardware.isEmpty && autoStrategy.isEmpty && teleopStrategy.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if !hardware.isEmpty {
                    tagRow(label: "Hardware", tags: hardware, category: .hardware)
                }
                if !autoStrategy.isEmpty {
                    tagRow(label: "Auto Strategy", tags: autoStrategy, category: .autoStrategy)
                }
                if !teleopStrategy.isEmpty {
                    tagRow(label: "Teleop Strategy", tags: teleopStrategy, category: .teleopStrategy)
                }
            }
        }
    }

    @ViewBuilder func tagRow(label: String, tags: [String], category: TagChip.TagCategory) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2.bold())
                .foregroundStyle(.secondary)

            FlowLayout(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    TagChip(text: tag, category: category)
                }
            }
        }
    }
}
```

### 3c. FlowLayout (Reusable)

```swift
struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y),
                                  proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var origins: [CGPoint] = []
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
            origins.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        totalHeight = y + rowHeight
        return (CGSize(width: maxWidth, height: totalHeight), origins)
    }
}
```

---

## 4. Loading TIMS Overrides with Tags

When viewing a team (Lookup panel, PbP card, etc.), fetch overrides:

```swift
func loadTimsOverrides(teamKey: String) async -> TimsOverride? {
    guard let url = URL(string: "\(APIService.base)/teams/\(teamKey)/tims-overrides") else { return nil }

    do {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
        return try JSONDecoder().decode(TimsOverride.self, from: data)
    } catch {
        return nil
    }
}
```

Then parse tags from the override:
```swift
if let ov = timsOverride {
    let hw = parseTags(ov.customHardware)
    let auto = parseTags(ov.customAutoStrategy)
    let teleop = parseTags(ov.customTeleopStrategy)

    TagSection(hardware: hw, autoStrategy: auto, teleopStrategy: teleop)
}
```

---

## 5. Sponsors — Two Data Sources

### 5a. Source 1: TIMS Override Custom Sponsors

From `custom_top_sponsors` field (simple string, not JSON array):
```json
{
  "custom_top_sponsors": "NASA, Google, Boeing"
}
```

This is a caster-entered override for "most important sponsors to mention on air."

### 5b. Source 2: GATool Community Updates

```http
GET /api/events/{event_key}/gatool-updates
```

Returns a dict keyed by team number:
```json
{
  "254": {
    "topSponsor": "NASA",
    "secondSponsor": "Google LLC",
    "thirdSponsor": "Apple",
    "otherSponsors": "Boeing, Lockheed Martin",
    "displayNumber": "254",
    "notes": "Community note about this team"
  },
  "1678": {
    "topSponsor": "Qualcomm",
    ...
  }
}
```

**Hierarchy**: TIMS override `custom_top_sponsors` takes priority over GATool data.

### 5c. Model

```swift
struct GAToolUpdate: Codable {
    let topSponsor: String?
    let secondSponsor: String?
    let thirdSponsor: String?
    let otherSponsors: String?
    let displayNumber: String?
    let notes: String?

    /// Flatten into a display-ready list
    var sponsorList: [String] {
        [topSponsor, secondSponsor, thirdSponsor]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
    }

    /// All sponsors including "other"
    var allSponsors: [String] {
        var list = sponsorList
        if let other = otherSponsors, !other.isEmpty {
            list += other.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        }
        return list
    }
}
```

### 5d. Loading GATool Data

```swift
func loadGATool(eventKey: String) async -> [Int: GAToolUpdate] {
    guard let url = URL(string: "\(APIService.base)/events/\(eventKey)/gatool-updates") else { return [:] }

    do {
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode([String: GAToolUpdate].self, from: data)
            .reduce(into: [:]) { result, pair in
                if let num = Int(pair.key) { result[num] = pair.value }
            }
    } catch {
        return [:]
    }
}
```

### 5e. Sponsor Display

```swift
struct SponsorBadges: View {
    let timsSponsors: String?     // From TIMS override
    let gatoolUpdate: GAToolUpdate?

    private var sponsors: [String] {
        // TIMS override takes priority
        if let tims = timsSponsors, !tims.isEmpty {
            return tims.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
        }
        return gatoolUpdate?.sponsorList ?? []
    }

    var body: some View {
        if !sponsors.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sponsors")
                    .font(.caption2.bold())
                    .foregroundStyle(.secondary)

                FlowLayout(spacing: 6) {
                    ForEach(sponsors, id: \.self) { sponsor in
                        Text(sponsor)
                            .font(.caption)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.orange.opacity(0.1), in: Capsule())
                            .overlay(Capsule().stroke(.orange.opacity(0.2), lineWidth: 1))
                    }
                }
            }
        }
    }
}
```

---

## 6. Integration Points

### 6a. Team Lookup Panel

In the team lookup view, add tags and sponsors after the stats section:

```swift
// After existing stats cards...

if let ov = timsOverride {
    // Tags
    TagSection(
        hardware: parseTags(ov.customHardware),
        autoStrategy: parseTags(ov.customAutoStrategy),
        teleopStrategy: parseTags(ov.customTeleopStrategy)
    )

    // Sponsors
    SponsorBadges(
        timsSponsors: ov.customTopSponsors,
        gatoolUpdate: gatoolUpdates[teamNumber]
    )
}
```

### 6b. PbP Match Card

In match cards (Battle Station or PbP), show compact tag pills:

```swift
// Inline in team row
HStack(spacing: 4) {
    ForEach(parseTags(timsOverride?.customHardware).prefix(3), id: \.self) { tag in
        Text(tag)
            .font(.caption2)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(.purple.opacity(0.1), in: Capsule())
    }
}
```

### 6c. GATool Notes in Team Lookup

GATool also includes community notes — display if present:

```swift
if let gatool = gatoolUpdates[teamNumber], let notes = gatool.notes, !notes.isEmpty {
    VStack(alignment: .leading, spacing: 4) {
        Label("Community Note", systemImage: "person.2")
            .font(.caption2.bold())
            .foregroundStyle(.secondary)
        Text(notes)
            .font(.caption)
            .foregroundStyle(.secondary)
    }
    .padding(8)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
}
```

---

## 7. Gotchas

1. **JSON string vs array**: Tags in TIMS are stored as JSON-encoded **strings** (e.g. `"[\"swerve\"]"`), NOT as actual JSON arrays in the database. Always parse with `parseTags()`.
2. **Comma fallback**: Some tags may be hand-edited in Supabase as comma-separated strings. The parser must handle both.
3. **Empty arrays**: `"[]"` is a valid tag value meaning "no tags." Parse it correctly as an empty array.
4. **GATool key types**: The gatool-updates endpoint returns team numbers as **string keys** (e.g. `"254"`). Convert to Int for lookup.
5. **TIMS sponsor priority**: Always prefer `custom_top_sponsors` over GATool data. GATool is the fallback.
6. **GATool availability**: GATool data may not be available for all events. Handle 404/empty gracefully.
7. **FTC events**: For FTC, the GATool endpoint strips the "ftc" prefix from the event code. The backend handles this automatically.
8. **custom_sponsor_read**: This is a separate field for the "sponsor read" script — a curated text the announcer reads aloud. Display it separately from sponsor badges if present.
