# Blueprint: FTC Mode & Sport Switch (iOS)
### For XCode Claude — implement FTC support end-to-end in the Xcode project

---

## Overview

The backend already supports both FRC and FTC: `events`, `teams`, and `event_teams` all have
a `competition_type TEXT CHECK (competition_type IN ('frc', 'ftc'))` column. The iOS app
currently only surfaces FRC events. This blueprint adds:

1. **A persistent FTC mode toggle** — user-level preference stored in `AppStorage`.
2. **Filtering all queries by `competition_type`** — events list, rankings, matches, teams.
3. **UI adaptations for FTC** — alliance sizes (2 teams), scoring fields, match stage labels.
4. **A sport switch control** — visible in the event browser / settings sidebar.

---

## 1. The `CompetitionType` Enum

Add a shared enum that mirrors the database constraint. This is the single source of truth
for all mode checks in the app.

```swift
// CompetitionType.swift

enum CompetitionType: String, Codable, CaseIterable, Identifiable {
    case frc
    case ftc

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .frc: "FRC"
        case .ftc: "FTC"
        }
    }

    var fullName: String {
        switch self {
        case .frc: "FIRST Robotics Competition"
        case .ftc: "FIRST Tech Challenge"
        }
    }

    /// Number of robots per alliance
    var allianceSize: Int {
        switch self {
        case .frc: 3
        case .ftc: 2
        }
    }

    /// Key prefix used in team_key / event_key
    var keyPrefix: String {
        switch self {
        case .frc: "frc"
        case .ftc: "ftc"
        }
    }
}
```

---

## 2. Persist the Mode Preference

Store the selected mode in `AppStorage` so it survives app restarts.  
Add it to `BroadcastStore` as the single gating property:

```swift
// Inside BroadcastStore

@AppStorage("competitionType") var competitionType: String = CompetitionType.frc.rawValue

var activeMode: CompetitionType {
    get { CompetitionType(rawValue: competitionType) ?? .frc }
    set { competitionType = newValue.rawValue }
}
```

> `@AppStorage` on an `@Observable` class works correctly on iOS 17+.  
> The String backing type avoids `RawRepresentable` conformance issues with `AppStorage`.

---

## 3. Filter Supabase Queries by Competition Type

Every query that fetches events, teams, or matches must scope to the active mode.

### 3a. Event list query (in `SyncEngine` or equivalent)

```swift
// When fetching available events for the event browser:
let events = try await supabase
    .from("events")
    .select("event_key, name, start_date, end_date, competition_type")
    .eq("competition_type", value: store.activeMode.rawValue)
    .order("start_date", ascending: false)
    .execute()
    .value as [EventRow]
```

### 3b. Teams / rankings query

```swift
// event_teams join — competition_type is on the teams table
let teams = try await supabase
    .from("event_teams")
    .select("*, teams!inner(team_number, nickname, competition_type)")
    .eq("event_key", value: eventKey)
    .eq("teams.competition_type", value: store.activeMode.rawValue)
    .order("raw_data->rank")
    .execute()
    .value as [EventTeamRow]
```

### 3c. SwiftData local cache predicate

`CachedTeam` and `CachedMatch` already have an `eventKey`. Since `eventKey` encodes the
sport implicitly (FTC keys contain "ftc"), you can also filter by key prefix:

```swift
// Preferred: add a competitionType property to CachedTeam
// var competitionType: String = "frc"

// Then filter:
let predicate = #Predicate<CachedTeam> {
    $0.eventKey == eventKey && $0.competitionType == mode.rawValue
}
```

**Action required:** Add `var competitionType: String = "frc"` to both `CachedTeam` and
`CachedMatch` in `Models.swift`, and populate it during the sync upsert.

---

## 4. Update `BroadcastStore.selectEvent(_:)`

When a new event is selected, re-derive the active mode from the event key or pass it
explicitly. Add a mode-aware overload:

```swift
func selectEvent(_ eventKey: String, mode: CompetitionType? = nil) async {
    if let mode { self.activeMode = mode }
    // … rest of existing selectEvent logic unchanged …
}
```

When the user switches mode (FRC ↔ FTC) without changing event, clear and reload:

```swift
func switchMode(to mode: CompetitionType) async {
    activeMode = mode
    await deselectEvent()   // clears rankings, matches, notes
}
```

---

## 5. The Sport Switch Control

Add a segmented picker visible in the event browser sidebar or top toolbar.

```swift
// SportSwitchPicker.swift

struct SportSwitchPicker: View {
    @Environment(BroadcastStore.self) private var store

    var body: some View {
        @Bindable var store = store
        Picker("Sport", selection: Binding(
            get: { store.activeMode },
            set: { newMode in
                Task { await store.switchMode(to: newMode) }
            }
        )) {
            ForEach(CompetitionType.allCases) { mode in
                Text(mode.displayName).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 160)
    }
}
```

**Placement:** Add `SportSwitchPicker()` to the sidebar toolbar in `CockpitLayout`:

```swift
// Inside EventSidebarView toolbar or NavigationSplitView sidebar:
.toolbar {
    ToolbarItem(placement: .topBarTrailing) {
        SportSwitchPicker()
    }
}
```

For `CompactLayout` (iPhone), place it at the top of the event list view.

---

## 6. UI Adaptations for FTC Mode

FTC has 2-robot alliances and different scoring terminology. Gate all FTC-specific UI
behind `store.activeMode == .ftc`.

### 6a. Alliance display

```swift
// In RankingsView or match detail — show correct number of team slots:
let allianceSize = store.activeMode.allianceSize   // 2 for FTC, 3 for FRC

ForEach(match.redTeamKeys.prefix(allianceSize), id: \.self) { key in
    TeamChip(teamKey: key)
}
```

### 6b. Match stage labels

FTC uses different comp level terminology. Add a computed property to `CachedMatch`
(or a helper function):

```swift
extension CachedMatch {
    func stageLabel(for mode: CompetitionType) -> String {
        switch mode {
        case .frc:
            switch compLevel {
            case "qm": return "Qual \(matchNumber)"
            case "sf": return "Semifinal \(setNumber)-\(matchNumber)"
            case "f":  return "Final \(matchNumber)"
            default:   return "Match \(matchNumber)"
            }
        case .ftc:
            // FTC uses: qual, semi, final — same keys, different display
            switch compLevel {
            case "qm": return "Qualifier \(matchNumber)"
            case "sf": return "Semifinal \(matchNumber)"
            case "f":  return "Final \(matchNumber)"
            default:   return "Match \(matchNumber)"
            }
        }
    }
}
```

### 6c. Score breakdown

FTC scoring fields differ from FRC. The `scoreBreakdownJSON` blob in `CachedMatch` contains
the raw data from the API. In FTC mode, parse the relevant FTC fields rather than FRC ones:

```swift
if store.activeMode == .ftc {
    FTCScoreBreakdownView(jsonData: match.scoreBreakdownJSON)
} else {
    FRCScoreBreakdownView(jsonData: match.scoreBreakdownJSON)
}
```

Create `FTCScoreBreakdownView` when FTC event data is available to inspect.

---

## 7. Notes — Scope by Competition Type

The `notes` / `caster_notes` tables have an `event_key`. Since event keys are already
sport-scoped, notes filter automatically. No schema change needed. If you display
"all notes" across events, add a `competition_type` filter:

```swift
// In any cross-event notes query:
.eq("competition_type", value: store.activeMode.rawValue)
```

This requires adding `competition_type` to the `caster_notes` table (or deriving it via
a join on `events`). Defer this until cross-event notes are built.

---

## 8. App Icon / Branding (Optional)

FTC is a different brand. You can conditionally swap the tint color or a badge:

```swift
.tint(store.activeMode == .ftc ? .orange : .indigo)
```

Apply this at the root `ContentView` level so it cascades everywhere.

---

## 9. Implementation Order

Follow this sequence to avoid breaking existing FRC functionality:

1. **Add `CompetitionType` enum** (no side effects)
2. **Add `competitionType: String` to `CachedTeam` + `CachedMatch`** in Models.swift (requires SwiftData migration — increment schema version)
3. **Add `activeMode` + `switchMode()` to `BroadcastStore`**
4. **Add `SportSwitchPicker`** and wire into `CockpitLayout` / `CompactLayout`
5. **Gate Supabase queries** with `.eq("competition_type", value: ...)` 
6. **Add `stageLabel(for:)` extension** to `CachedMatch`
7. **Gate alliance size** in match/rankings views
8. **Test with a known FTC event key** (e.g. `"2025ftcTRTUQ1"`) — confirm data loads correctly

---

## 10. SwiftData Schema Migration Note

Adding `var competitionType: String = "frc"` to existing `@Model` classes is a schema
change. Increment the `ModelContainer` schema version:

```swift
// In your App @main or where ModelContainer is created:
let schema = Schema(
    [CachedTeam.self, CachedMatch.self, CachedNote.self],
    version: Schema.Version(2, 0, 0)   // bump from 1.0.0
)
let config = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
let container = try ModelContainer(for: schema, migrationPlan: AppMigrationPlan.self, configurations: config)
```

Define `AppMigrationPlan` with a `MigrationStage.lightweight` stage — adding a column with
a default value qualifies as a lightweight migration (no custom code needed).

---

## Backend Reference

| Column              | Table         | Values          | Notes                              |
|---------------------|---------------|-----------------|------------------------------------|
| `competition_type`  | `events`      | `'frc'`, `'ftc'`| Index exists: `idx_events_competition_type` |
| `competition_type`  | `teams`       | `'frc'`, `'ftc'`| —                                  |
| `team_key` prefix   | `teams`       | `frc254`, `ftc12345` | Use as fallback filter        |
| `event_key` prefix  | `events`      | `2026tuak`, `2025ftcTRTUQ1` | FTC keys contain "ftc" |
