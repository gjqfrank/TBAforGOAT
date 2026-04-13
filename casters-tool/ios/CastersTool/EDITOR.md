# Editor Flow (TIMS Overrides) — Complete Wiring Guide

> **Purpose**: The Editor lets authenticated casters override team display data (nickname, sponsors, robot name, hardware tags, strategy tags, etc.). Overrides persist to Supabase and are visible to all connected clients. This document covers the full editor flow for the iOS app.

---

## 1. Architecture Overview

| Component | Role |
|-----------|------|
| `tims_overrides` table (Supabase) | Primary storage for all custom overrides |
| `tims_overrides_history` table (Supabase) | Audit trail (populated by DB trigger, not by client) |
| `PUT /api/teams/{team_key}/tims-overrides` | Upsert (create or update) |
| `GET /api/teams/{team_key}/tims-overrides` | Fetch current override |
| `DELETE /api/teams/{team_key}/tims-overrides` | Soft-delete (sets `is_deleted=true`, clears all fields) |
| `GET /api/teams/{team_key}/tims-overrides/history` | Audit trail |

**Auth requirement**: All TIMS write operations require an authenticated user. Check `Auth.isAuthenticated` before allowing editor access. Show a login prompt for guests.

---

## 2. How the Editor Opens

The editor opens from multiple entry points — always targeting a specific team:

- **Rankings row**: Long-press → Context menu → "Edit Identity" / "Edit Hardware" / "Edit Playstyle"
- **PbP team number**: Long-press → Context menu → "Edit…"
- **Team Lookup**: Edit button in header
- **Battle Station**: Context menu on team pill

```swift
// Pass the team number and optionally a default tab
func openEditor(teamNumber: Int, defaultTab: EditorTab = .identity) {
    guard !store.isGuest else {
        showLoginPrompt = true
        return
    }
    editorTeamNumber = teamNumber
    editorDefaultTab = defaultTab
    showEditorSheet = true
}
```

---

## 3. Editor Tabs

The editor has **3 tabs**: Identity, Hardware, Playstyle.

```swift
enum EditorTab: String, CaseIterable {
    case identity = "Identity"
    case hardware = "Hardware"
    case playstyle = "Playstyle"
}
```

---

## 4. API Data Shapes

### 4a. PUT Request Body

```json
{
  "custom_nickname": "string|null",
  "custom_sponsor_read": "string|null",
  "custom_robot_name": "string|null",
  "custom_motto": "string|null",
  "custom_organization": "string|null",
  "custom_location": "string|null",
  "custom_top_sponsors": "string|null",
  "custom_pronunciation": "string|null",
  "custom_hardware": "[\"swerve\",\"turret\"]|null",
  "custom_auto_strategy": "[\"center rush\",\"side\"]|null",
  "custom_teleop_strategy": "[\"mid take\",\"corner park\"]|null",
  "custom_number_display": "string|null",
  "author_device_id": "device-uuid",
  "author_name": "Caster Name",
  "author_event_key": "2026tuak|null"
}
```

**Critical**: `custom_hardware`, `custom_auto_strategy`, `custom_teleop_strategy` are stored as **JSON array strings** — use `JSONEncoder` to serialize the Swift `[String]` array, then send as a string value.

### 4b. GET Response

Same fields as PUT body plus metadata:
```json
{
  "team_key": "frc254",
  "custom_nickname": "The Cheesy Poofs",
  "custom_hardware": "[\"swerve\",\"turret\"]",
  "updated_at": "2026-04-13T10:00:00Z",
  "created_at": "2026-04-12T08:00:00Z",
  "is_deleted": false,
  "author_device_id": "...",
  "author_name": "John",
  "author_event_key": "2026tuak"
}
```

### 4c. History Response

```json
[
  {
    "team_key": "frc254",
    "custom_nickname": "The Cheesy Poofs",
    "author_name": "John",
    "author_event_key": "2026tuak",
    "updated_at": "2026-04-13T10:00:00Z",
    "created_at": "2026-04-13T10:00:00Z"
  }
]
```

---

## 5. Codable Models

```swift
struct TimsOverride: Codable {
    let teamKey: String?
    let customNickname: String?
    let customSponsorRead: String?
    let customRobotName: String?
    let customMotto: String?
    let customOrganization: String?
    let customLocation: String?
    let customTopSponsors: String?
    let customPronunciation: String?
    let customHardware: String?         // JSON-encoded [String]
    let customAutoStrategy: String?     // JSON-encoded [String]
    let customTeleopStrategy: String?   // JSON-encoded [String]
    let customNumberDisplay: String?
    let authorDeviceId: String?
    let authorName: String?
    let authorEventKey: String?
    let updatedAt: String?
    let createdAt: String?
    let isDeleted: Bool?

    enum CodingKeys: String, CodingKey {
        case teamKey = "team_key"
        case customNickname = "custom_nickname"
        case customSponsorRead = "custom_sponsor_read"
        case customRobotName = "custom_robot_name"
        case customMotto = "custom_motto"
        case customOrganization = "custom_organization"
        case customLocation = "custom_location"
        case customTopSponsors = "custom_top_sponsors"
        case customPronunciation = "custom_pronunciation"
        case customHardware = "custom_hardware"
        case customAutoStrategy = "custom_auto_strategy"
        case customTeleopStrategy = "custom_teleop_strategy"
        case customNumberDisplay = "custom_number_display"
        case authorDeviceId = "author_device_id"
        case authorName = "author_name"
        case authorEventKey = "author_event_key"
        case updatedAt = "updated_at"
        case createdAt = "created_at"
        case isDeleted = "is_deleted"
    }
}

struct TimsOverridePayload: Codable {
    var customNickname: String?
    var customSponsorRead: String?
    var customRobotName: String?
    var customMotto: String?
    var customOrganization: String?
    var customLocation: String?
    var customTopSponsors: String?
    var customPronunciation: String?
    var customHardware: String?
    var customAutoStrategy: String?
    var customTeleopStrategy: String?
    var customNumberDisplay: String?
    let authorDeviceId: String
    let authorName: String
    var authorEventKey: String?

    enum CodingKeys: String, CodingKey {
        case customNickname = "custom_nickname"
        case customSponsorRead = "custom_sponsor_read"
        case customRobotName = "custom_robot_name"
        case customMotto = "custom_motto"
        case customOrganization = "custom_organization"
        case customLocation = "custom_location"
        case customTopSponsors = "custom_top_sponsors"
        case customPronunciation = "custom_pronunciation"
        case customHardware = "custom_hardware"
        case customAutoStrategy = "custom_auto_strategy"
        case customTeleopStrategy = "custom_teleop_strategy"
        case customNumberDisplay = "custom_number_display"
        case authorDeviceId = "author_device_id"
        case authorName = "author_name"
        case authorEventKey = "author_event_key"
    }
}
```

---

## 6. Tag Array Serialization

Tags are stored as JSON-encoded string arrays. Parse and serialize carefully:

```swift
// Serialize: [String] → String for API
func serializeTags(_ tags: [String]) -> String? {
    guard !tags.isEmpty else { return nil }
    guard let data = try? JSONEncoder().encode(tags),
          let str = String(data: data, encoding: .utf8) else { return nil }
    return str
}

// Deserialize: String → [String] from API
func parseTags(_ raw: String?) -> [String] {
    guard let raw, !raw.isEmpty else { return [] }
    // Try JSON array first
    if let data = raw.data(using: .utf8),
       let arr = try? JSONDecoder().decode([String].self, from: data) {
        return arr
    }
    // Fallback: comma-separated
    return raw.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
}
```

---

## 7. Device ID

Generate a persistent device UUID on first launch:

```swift
var deviceId: String {
    if let stored = UserDefaults.standard.string(forKey: "casters_device_id") {
        return stored
    }
    let id = UUID().uuidString
    UserDefaults.standard.set(id, forKey: "casters_device_id")
    return id
}
```

---

## 8. Editor View Implementation

### 8a. Sheet Wrapper

```swift
struct EditorSheet: View {
    let teamNumber: Int
    let defaultTab: EditorTab
    @Environment(BroadcastStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var selectedTab: EditorTab = .identity
    @State private var existingOverride: TimsOverride?
    @State private var isLoading = true

    // Identity fields
    @State private var nickname = ""
    @State private var organization = ""
    @State private var location = ""
    @State private var robotName = ""
    @State private var numberDisplay = ""
    @State private var pronunciation = ""
    @State private var motto = ""
    @State private var sponsors = ""

    // Tag fields
    @State private var hardwareTags: [String] = []
    @State private var autoTags: [String] = []
    @State private var teleopTags: [String] = []

    @State private var isSaving = false
    @State private var showHistory = false

    var teamKey: String { "frc\(teamNumber)" }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Tab picker
                Picker("Tab", selection: $selectedTab) {
                    ForEach(EditorTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                if isLoading {
                    Spacer()
                    ProgressView()
                    Spacer()
                } else {
                    ScrollView {
                        switch selectedTab {
                        case .identity:
                            identityTab
                        case .hardware:
                            hardwareTab
                        case .playstyle:
                            playstyleTab
                        }
                    }
                }
            }
            .navigationTitle("Edit Team \(teamNumber)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .secondaryAction) {
                    Menu {
                        Button("View History") { showHistory = true }
                        Button("Reset to Defaults", role: .destructive) {
                            Task { await resetToDefaults() }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .sheet(isPresented: $showHistory) {
                EditorHistoryView(teamKey: teamKey)
            }
            .task {
                selectedTab = defaultTab
                await loadExisting()
            }
        }
    }
}
```

### 8b. Identity Tab

```swift
@ViewBuilder var identityTab: some View {
    VStack(spacing: 16) {
        EditorField(label: "Nickname", text: $nickname, placeholder: "Team display name")
        EditorField(label: "Organization", text: $organization, placeholder: "School or org name")
        EditorField(label: "Location", text: $location, placeholder: "City, State/Prov")
        EditorField(label: "Robot Name", text: $robotName, placeholder: "Robot name")
        EditorField(label: "Number Display", text: $numberDisplay, placeholder: "Custom number display")
        EditorField(label: "Pronunciation", text: $pronunciation, placeholder: "How to pronounce the name")
        EditorField(label: "Motto", text: $motto, placeholder: "Team motto")
        EditorField(label: "Sponsors", text: $sponsors, placeholder: "Key sponsors for broadcast read")
    }
    .padding()
}

struct EditorField: View {
    let label: String
    @Binding var text: String
    let placeholder: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(.secondary)
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
        }
    }
}
```

### 8c. Hardware Tab

```swift
@ViewBuilder var hardwareTab: some View {
    VStack(alignment: .leading, spacing: 16) {
        Text("Hardware Tags")
            .font(.headline)
        Text("Describe the robot's hardware (e.g., swerve drive, 6-wheel, climber, intake)")
            .font(.caption)
            .foregroundStyle(.secondary)

        TagEditor(tags: $hardwareTags, placeholder: "Add hardware tag…")
    }
    .padding()
}
```

### 8d. Playstyle Tab

```swift
@ViewBuilder var playstyleTab: some View {
    VStack(alignment: .leading, spacing: 16) {
        Text("Auto Strategy")
            .font(.headline)
        TagEditor(tags: $autoTags, placeholder: "Add auto strategy…")

        Divider()

        Text("Teleop Strategy")
            .font(.headline)
        TagEditor(tags: $teleopTags, placeholder: "Add teleop strategy…")
    }
    .padding()
}
```

### 8e. Tag Editor Component

```swift
struct TagEditor: View {
    @Binding var tags: [String]
    let placeholder: String
    @State private var input = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Existing tags (flow layout)
            FlowLayout(spacing: 6) {
                ForEach(Array(tags.enumerated()), id: \.offset) { index, tag in
                    HStack(spacing: 4) {
                        Text(tag)
                            .font(.subheadline)
                        Button {
                            withAnimation { tags.remove(at: index) }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.caption)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.blue.opacity(0.1), in: Capsule())
                }
            }

            // Input
            TextField(placeholder, text: $input)
                .textFieldStyle(.roundedBorder)
                .onSubmit { addTag() }
                .onChange(of: input) { _, newValue in
                    // Also trigger on comma
                    if newValue.hasSuffix(",") {
                        input = String(newValue.dropLast())
                        addTag()
                    }
                }
        }
    }

    func addTag() {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // Reject duplicates (case-insensitive)
        guard !tags.contains(where: { $0.lowercased() == trimmed.lowercased() }) else {
            input = ""
            return
        }
        withAnimation { tags.append(trimmed) }
        input = ""
    }
}
```

---

## 9. Data Loading & Saving

### 9a. Load Existing Overrides

```swift
func loadExisting() async {
    isLoading = true
    defer { isLoading = false }

    // 1. Find team in rankings for default values
    let team = store.rankings.first { $0.teamNumber == teamNumber }

    // 2. Fetch existing overrides
    do {
        let override = try await APIService.shared.fetchTimsOverride(teamKey: teamKey)
        if override.isDeleted != true {
            existingOverride = override
        }
    } catch {
        // 404 = no overrides yet, which is fine
    }

    // 3. Populate fields: override first, then team defaults
    let ov = existingOverride
    nickname = ov?.customNickname ?? team?.nickname ?? ""
    organization = ov?.customOrganization ?? team?.schoolName ?? ""
    location = ov?.customLocation ?? [team?.city, team?.stateProv].compactMap { $0 }.joined(separator: ", ")
    robotName = ov?.customRobotName ?? ""
    numberDisplay = ov?.customNumberDisplay ?? ""
    pronunciation = ov?.customPronunciation ?? ""
    motto = ov?.customMotto ?? ""
    sponsors = ov?.customTopSponsors ?? ov?.customSponsorRead ?? ""

    hardwareTags = parseTags(ov?.customHardware)
    autoTags = parseTags(ov?.customAutoStrategy)
    teleopTags = parseTags(ov?.customTeleopStrategy)
}
```

### 9b. Save

```swift
func save() async {
    isSaving = true
    defer { isSaving = false }

    let payload = TimsOverridePayload(
        customNickname: nickname.isEmpty ? nil : nickname,
        customSponsorRead: sponsors.isEmpty ? nil : sponsors,
        customRobotName: robotName.isEmpty ? nil : robotName,
        customMotto: motto.isEmpty ? nil : motto,
        customOrganization: organization.isEmpty ? nil : organization,
        customLocation: location.isEmpty ? nil : location,
        customTopSponsors: sponsors.isEmpty ? nil : sponsors,
        customPronunciation: pronunciation.isEmpty ? nil : pronunciation,
        customHardware: serializeTags(hardwareTags),
        customAutoStrategy: serializeTags(autoTags),
        customTeleopStrategy: serializeTags(teleopTags),
        customNumberDisplay: numberDisplay.isEmpty ? nil : numberDisplay,
        authorDeviceId: deviceId,
        authorName: store.currentUser?.name ?? store.currentUser?.email ?? "Caster",
        authorEventKey: store.selectedEvent
    )

    do {
        try await APIService.shared.putTimsOverride(teamKey: teamKey, payload: payload)
        dismiss()
    } catch {
        // Show error alert
    }
}
```

### 9c. Reset to Defaults

```swift
func resetToDefaults() async {
    do {
        try await APIService.shared.deleteTimsOverride(teamKey: teamKey)
        dismiss()
    } catch {
        // Show error
    }
}
```

---

## 10. History View

```swift
struct EditorHistoryView: View {
    let teamKey: String
    @State private var history: [TimsOverride] = []
    @State private var isLoading = true
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if isLoading {
                    ProgressView()
                } else if history.isEmpty {
                    Text("No edit history")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(history, id: \.createdAt) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(entry.authorName ?? "Unknown")
                                    .font(.subheadline.bold())
                                Spacer()
                                if let event = entry.authorEventKey {
                                    Text(event)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if let date = entry.updatedAt {
                                Text(date)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Edit History")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task {
                do {
                    history = try await APIService.shared.fetchTimsHistory(teamKey: teamKey)
                } catch {}
                isLoading = false
            }
        }
    }
}
```

---

## 11. APIService Additions

```swift
// TIMS Overrides
func fetchTimsOverride(teamKey: String) async throws -> TimsOverride {
    return try await get(url: "\(base)/teams/\(teamKey)/tims-overrides")
}

func putTimsOverride(teamKey: String, payload: TimsOverridePayload) async throws {
    try await put(url: "\(base)/teams/\(teamKey)/tims-overrides", body: payload)
}

func deleteTimsOverride(teamKey: String) async throws {
    try await delete(url: "\(base)/teams/\(teamKey)/tims-overrides")
}

func fetchTimsHistory(teamKey: String) async throws -> [TimsOverride] {
    return try await get(url: "\(base)/teams/\(teamKey)/tims-overrides/history")
}
```

---

## 12. Context Menu Integration

Add these context menu actions to any view showing a team number:

```swift
.contextMenu {
    Button {
        openEditor(teamNumber: team.teamNumber, defaultTab: .identity)
    } label: {
        Label("Edit Identity", systemImage: "pencil")
    }

    Button {
        openEditor(teamNumber: team.teamNumber, defaultTab: .hardware)
    } label: {
        Label("Edit Hardware", systemImage: "wrench.and.screwdriver")
    }

    Button {
        openEditor(teamNumber: team.teamNumber, defaultTab: .playstyle)
    } label: {
        Label("Edit Playstyle", systemImage: "gamecontroller")
    }
}
```

---

## 13. Gotchas

1. **Soft delete**: `DELETE` doesn't remove the row — it sets `is_deleted=true` and nulls all custom fields. When fetching, check `is_deleted` before using the data.
2. **History is automatic**: A Supabase DB trigger copies to `tims_overrides_history` on every update. You don't need to write history — just read it.
3. **Tag format**: Always serialize tags as JSON arrays (`["tag1","tag2"]`), never comma-separated. The backend stores them as-is.
4. **Override priority**: When rendering team data elsewhere (PbP, Rankings), TIMS overrides take priority over default TBA/FIRST data. Cache overrides locally and merge.
5. **Auth gate**: Never show the editor to guests. Check auth state before opening.
