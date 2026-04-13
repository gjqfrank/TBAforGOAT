# Notes — Complete Wiring Guide (Team & Event Sections)

> **Purpose**: The Notes panel has two sections: **Team Notes** and **Event Notes**. Match notes have been moved to Battle Station. This document covers the notes system that uses the **backend API** (`notes` table), NOT the `caster_notes` table used by Battle Station.

---

## 1. Two Notes Tables — Critical Distinction

| Table | Used By | API |
|-------|---------|-----|
| `notes` | Notes panel (this doc) | Backend API: `POST /api/teams/notes`, `GET /api/teams/{key}/notes`, etc. |
| `caster_notes` | Battle Station (live match) | Direct Supabase PostgREST |

**These tables are NOT synchronized.** Notes panel uses the backend API. Battle Station uses PostgREST.

---

## 2. API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/teams/{team_key}/notes` | GET | All notes for a team |
| `GET /api/teams/{team_key}/notes?event_key=2026tuak` | GET | Team notes filtered to event |
| `GET /api/events/{event_key}/notes` | GET | All notes at an event |
| `GET /api/events/{event_key}/notes?team_key=frc254` | GET | Team notes at event (via event route) |
| `GET /api/events/{event_key}/notes?category=strategy` | GET | Category filter |
| `POST /api/teams/notes` | POST | Create a note |
| `PUT /api/teams/notes/{note_id}` | PUT | Update a note |
| `DELETE /api/teams/notes/{note_id}` | DELETE | Soft-delete a note |

---

## 3. Data Models

### 3a. Note Model

```swift
struct Note: Codable, Identifiable {
    let id: String                   // UUID
    let content: String
    let teamKey: String?             // "frc254"
    let matchKey: String?            // "2026tuak_qm42" (historical, may exist)
    let eventKey: String?            // "2026tuak"
    let category: String?            // "strategy", "hardware", "general"
    let authorDeviceId: String?
    let isDeleted: Bool?
    let createdAt: String            // ISO 8601
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, content
        case teamKey = "team_key"
        case matchKey = "match_key"
        case eventKey = "event_key"
        case category
        case authorDeviceId = "author_device_id"
        case isDeleted = "is_deleted"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}
```

### 3b. Create/Update Payloads

```swift
struct NoteCreatePayload: Codable {
    let content: String
    let teamKey: String?
    let matchKey: String?
    let eventKey: String?
    let category: String?
    let authorDeviceId: String

    enum CodingKeys: String, CodingKey {
        case content
        case teamKey = "team_key"
        case matchKey = "match_key"
        case eventKey = "event_key"
        case category
        case authorDeviceId = "author_device_id"
    }
}

struct NoteUpdatePayload: Codable {
    let content: String?
    let teamKey: String?
    let matchKey: String?
    let eventKey: String?
    let category: String?

    enum CodingKeys: String, CodingKey {
        case content
        case teamKey = "team_key"
        case matchKey = "match_key"
        case eventKey = "event_key"
        case category
    }
}
```

---

## 4. API Service

```swift
extension APIService {
    // ── Team Notes ──
    static func fetchTeamNotes(teamKey: String, eventKey: String? = nil) async throws -> [Note] {
        var url = "\(base)/teams/\(teamKey)/notes?sort=desc"
        if let ek = eventKey {
            url += "&event_key=\(ek)"
        }
        return try await get(url: url)
    }

    // ── Event Notes ──
    static func fetchEventNotes(eventKey: String, teamKey: String? = nil, category: String? = nil) async throws -> [Note] {
        var url = "\(base)/events/\(eventKey)/notes?sort=desc"
        if let tk = teamKey { url += "&team_key=\(tk)" }
        if let cat = category { url += "&category=\(cat)" }
        return try await get(url: url)
    }

    // ── Create Note ──
    static func createNote(_ payload: NoteCreatePayload) async throws -> Note {
        return try await post(url: "\(base)/teams/notes", body: payload)
    }

    // ── Update Note ──
    static func updateNote(noteId: String, _ payload: NoteUpdatePayload) async throws -> Note {
        return try await put(url: "\(base)/teams/notes/\(noteId)", body: payload)
    }

    // ── Delete Note ──
    static func deleteNote(noteId: String) async throws {
        let url = URL(string: "\(base)/teams/notes/\(noteId)")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        let (_, _) = try await URLSession.shared.data(for: request)
    }
}
```

---

## 5. Notes Panel View

### 5a. Panel Structure

The notes panel is a floating/modal view with two segments: **Team** and **Event**.

```swift
struct NotesPanel: View {
    @Environment(BroadcastStore.self) private var store
    @State private var selectedTab: NoteTab = .team
    @State private var teamNotes: [Note] = []
    @State private var eventNotes: [Note] = []
    @State private var isLoading = false
    @State private var newNoteText = ""
    @State private var selectedCategory: String = "general"
    @FocusState private var inputFocused: Bool

    enum NoteTab: String, CaseIterable {
        case team = "Team"
        case event = "Event"
    }

    /// The team currently focused (e.g., from lookup or selection)
    var focusedTeamKey: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Tab picker
                Picker("Notes", selection: $selectedTab) {
                    ForEach(NoteTab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding()

                // Note list
                noteList

                Divider()

                // Input area (auth-gated)
                if !store.isGuest {
                    noteInput
                }
            }
            .navigationTitle("Notes")
            .navigationBarTitleDisplayMode(.inline)
            .task { await loadNotes() }
            .onChange(of: selectedTab) { _, _ in
                Task { await loadNotes() }
            }
        }
    }
}
```

### 5b. Note List

```swift
@ViewBuilder var noteList: some View {
    let notes = selectedTab == .team ? teamNotes : eventNotes

    if isLoading {
        ProgressView()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if notes.isEmpty {
        ContentUnavailableView(
            "No Notes",
            systemImage: "note.text",
            description: Text(selectedTab == .team
                ? "No notes for this team yet."
                : "No event notes yet.")
        )
    } else {
        List {
            ForEach(notes) { note in
                NoteRow(note: note, onDelete: {
                    Task { await deleteNote(note) }
                })
            }
        }
        .listStyle(.plain)
    }
}
```

### 5c. Note Row

```swift
struct NoteRow: View {
    let note: Note
    var onDelete: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                // Category badge
                if let cat = note.category, !cat.isEmpty {
                    Text(cat.capitalized)
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(categoryColor(cat), in: Capsule())
                }

                // Team badge (in event tab)
                if let tk = note.teamKey {
                    Text(tk.replacingOccurrences(of: "frc", with: ""))
                        .font(.caption2.bold().monospacedDigit())
                        .foregroundStyle(.blue)
                }

                Spacer()

                // Timestamp
                Text(relativeTime(note.createdAt))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            Text(note.content)
                .font(.subheadline)
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing) {
            Button("Delete", role: .destructive) {
                onDelete?()
            }
        }
    }

    func categoryColor(_ cat: String) -> Color {
        switch cat.lowercased() {
        case "strategy": .green
        case "hardware": .purple
        case "general": .gray
        default: .secondary
        }
    }

    func relativeTime(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: .now)
    }
}
```

### 5d. Note Input

```swift
@ViewBuilder var noteInput: some View {
    VStack(spacing: 8) {
        // Category selector
        HStack(spacing: 8) {
            ForEach(["general", "strategy", "hardware"], id: \.self) { cat in
                Button {
                    selectedCategory = cat
                } label: {
                    Text(cat.capitalized)
                        .font(.caption2.bold())
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(selectedCategory == cat ? categoryColor(cat) : .clear,
                                    in: Capsule())
                        .foregroundStyle(selectedCategory == cat ? .white : .primary)
                        .overlay(Capsule().stroke(.quaternary, lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }

        HStack(spacing: 8) {
            TextField("Add a note…", text: $newNoteText, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...4)
                .focused($inputFocused)

            Button {
                Task { await submitNote() }
            } label: {
                Image(systemName: "paperplane.fill")
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(.blue.gradient, in: Circle())
            }
            .disabled(newNoteText.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }
    .padding()
    .background(.ultraThinMaterial)

    func categoryColor(_ cat: String) -> Color {
        switch cat {
        case "strategy": .green
        case "hardware": .purple
        default: .gray
        }
    }
}
```

---

## 6. CRUD Operations

### 6a. Load Notes

```swift
func loadNotes() async {
    isLoading = true
    do {
        switch selectedTab {
        case .team:
            guard let tk = focusedTeamKey else {
                teamNotes = []
                isLoading = false
                return
            }
            teamNotes = try await APIService.fetchTeamNotes(
                teamKey: tk,
                eventKey: store.selectedEvent
            )
        case .event:
            guard let ek = store.selectedEvent else {
                eventNotes = []
                isLoading = false
                return
            }
            eventNotes = try await APIService.fetchEventNotes(eventKey: ek)
        }
    } catch {
        print("Failed to load notes: \(error)")
    }
    isLoading = false
}
```

### 6b. Submit Note

```swift
func submitNote() async {
    let text = newNoteText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }

    let payload = NoteCreatePayload(
        content: text,
        teamKey: selectedTab == .team ? focusedTeamKey : nil,
        matchKey: nil,   // Match notes are in Battle Station
        eventKey: store.selectedEvent,
        category: selectedCategory,
        authorDeviceId: DeviceID.current  // Reuse from EDITOR.md
    )

    newNoteText = ""

    do {
        let created = try await APIService.createNote(payload)
        withAnimation(.spring(duration: 0.3)) {
            switch selectedTab {
            case .team: teamNotes.insert(created, at: 0)
            case .event: eventNotes.insert(created, at: 0)
            }
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    } catch {
        newNoteText = text  // Restore on failure
    }
}
```

### 6c. Delete Note

```swift
func deleteNote(_ note: Note) async {
    do {
        try await APIService.deleteNote(noteId: note.id)
        withAnimation {
            teamNotes.removeAll { $0.id == note.id }
            eventNotes.removeAll { $0.id == note.id }
        }
    } catch {
        print("Failed to delete note: \(error)")
    }
}
```

---

## 7. Entry Points

### 7a. From Team Lookup (Long-press or Menu)

```swift
.sheet(isPresented: $showNotes) {
    NotesPanel(focusedTeamKey: "frc\(selectedTeamNumber)")
}
```

### 7b. From Event Menu

```swift
.sheet(isPresented: $showEventNotes) {
    NotesPanel(focusedTeamKey: nil)  // Opens to Event tab by default
}
```

### 7c. From Toolbar

```swift
.toolbar {
    ToolbarItem(placement: .secondaryAction) {
        Button {
            showNotes = true
        } label: {
            Label("Notes", systemImage: "note.text")
        }
    }
}
```

---

## 8. Gotchas

1. **Two tables, two systems**: `notes` (this doc, backend API) vs `caster_notes` (Battle Station, PostgREST). They are completely separate.
2. **Auth gating**: Guests can READ notes but cannot CREATE/UPDATE/DELETE. Hide the input area for guests.
3. **Soft delete**: `DELETE` endpoint sets `is_deleted = true`. The backend filters these out on reads.
4. **No match tab**: Match notes have been moved to Battle Station. The Notes panel only has Team and Event tabs.
5. **`team_key` format**: Always `"frc{number}"` (e.g., `"frc254"`). For FTC: `"ftc{number}"`.
6. **Device ID**: Reuse the same `DeviceID.current` value from the Editor (see EDITOR.md §5c).
7. **Historical team notes**: When `event_key` is omitted from the team notes query, it returns ALL notes across all events — useful for pre-event prep.
8. **Category is optional**: Backend doesn't require `category`. Default to `"general"` on the client side.
9. **Note ordering**: Backend returns newest first (`sort=desc`). Maintain this in the UI.
