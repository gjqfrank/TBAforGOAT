# Battle Station — Complete Wiring Guide

> **Purpose**: Battle Station is the live match commentating timeline — a real-time note feed with system macros, team context pills, and match navigation. It must be **exceptionally smooth on mobile** using the best SwiftUI elements: fluid animations, haptic feedback, gesture-driven interactions, and a polished split-column timeline.

---

## 1. Architecture Overview

Battle Station is a **live match-scoped timeline** where casters add notes and system markers during a match. Notes flow into a split red/blue/center column layout. The system uses **direct Supabase PostgREST** for note CRUD (NOT the backend API).

| Component | Purpose |
|-----------|---------|
| `caster_notes` Supabase table | Primary storage |
| Supabase PostgREST | Direct CRUD (insert, select) |
| Supabase Realtime | Live note streaming |
| Match data from `store.matches` | Match context, team lists |

---

## 2. Data Model

### 2a. Note

```swift
struct CasterNote: Codable, Identifiable {
    let id: String                // UUID from Supabase, or "opt-{timestamp}" for optimistic
    let eventKey: String
    let matchKey: String?
    let teamKey: String?          // "frc254" or nil for general
    let author: String            // user name or "SYSTEM"
    let content: String           // free text or macro code ("AUTO_START")
    let type: String              // "manual" or "system"
    let createdAt: String         // ISO 8601

    enum CodingKeys: String, CodingKey {
        case id
        case eventKey = "event_key"
        case matchKey = "match_key"
        case teamKey = "team_key"
        case author, content, type
        case createdAt = "created_at"
    }
}
```

### 2b. System Macros (Lexicon)

```swift
enum SystemMacro: String, CaseIterable {
    case autoStart = "AUTO_START"
    case teleopStart = "TELEOP_START"
    case endgameStart = "ENDGAME_START"
    case matchOver = "MATCH_OVER"
    case fieldFault = "FIELD_FAULT"

    var label: String {
        switch self {
        case .autoStart: "Auto"
        case .teleopStart: "Teleop"
        case .endgameStart: "Endgame"
        case .matchOver: "Match Over"
        case .fieldFault: "Field Fault"
        }
    }

    var icon: String {
        switch self {
        case .autoStart: "gearshape.2"
        case .teleopStart: "gamecontroller"
        case .endgameStart: "flag.checkered"
        case .matchOver: "timer"
        case .fieldFault: "exclamationmark.triangle"
        }
    }

    var color: Color {
        switch self {
        case .autoStart: .green
        case .teleopStart: .blue
        case .endgameStart: .orange
        case .matchOver: .gray
        case .fieldFault: .red
        }
    }
}
```

---

## 3. Layout Structure

Top-to-bottom:

```
┌──────────────────────────────────────┐
│  Match Selector (dropdown)            │  ← Match bar
├──────────────────────────────────────┤
│  [R1] [R2] [R3]  [GEN]  [B1] [B2] [B3] │  ← Hot Row pills
├──────────────────────────────────────┤
│                                      │
│  ┌Red─┐   │spine│   ┌Blue┐          │
│  │note│   │     │   │note│          │  ← Timeline feed
│  └────┘   │     │   └────┘          │
│           │ SYS │                    │
│  ┌────┐   │badge│   ┌────┐          │
│  │note│   │     │   │note│          │
│  └────┘   │     │   └────┘          │
│                                      │
├──────────────────────────────────────┤
│  [Auto] [Teleop] [Endgame] [Over] [⚠]│  ← Macro deck
├──────────────────────────────────────┤
│  [  Add a note…           ] [Send]   │  ← Input dock
└──────────────────────────────────────┘
```

---

## 4. Complete View Implementation

### 4a. Main Battle Station View

```swift
struct BattleStationView: View {
    @Environment(BroadcastStore.self) private var store
    @State private var notes: [CasterNote] = []
    @State private var context: NoteContext = .match    // active pill context
    @State private var inputText = ""
    @State private var isSubmitting = false
    @FocusState private var inputFocused: Bool

    /// Which match we're looking at (index into store.matches)
    @State private var matchIndex = 0

    private var currentMatch: CachedMatch? {
        guard !store.matches.isEmpty, matchIndex < store.matches.count else { return nil }
        return store.matches[matchIndex]
    }

    var body: some View {
        if store.matches.isEmpty {
            ContentUnavailableView("No Match Data", systemImage: "play.slash",
                description: Text("Load an event to use Battle Station."))
        } else {
            VStack(spacing: 0) {
                matchBar
                hotRow
                timeline
                macroDeck
                inputDock
            }
            .onChange(of: matchIndex) { _, _ in
                Task { await loadNotes() }
            }
            .task { await loadNotes() }
            .task { await subscribeRealtime() }
        }
    }
}
```

### 4b. Match Bar

```swift
@ViewBuilder var matchBar: some View {
    HStack {
        Picker("Match", selection: $matchIndex) {
            ForEach(Array(store.matches.enumerated()), id: \.offset) { i, m in
                Text(matchLabel(m)).tag(i)
            }
        }
        .pickerStyle(.menu)
        .font(.subheadline.bold())
    }
    .padding(.horizontal)
    .padding(.vertical, 8)
    .background(.ultraThinMaterial)
}

func matchLabel(_ m: CachedMatch) -> String {
    switch m.compLevel {
    case "qm": "Qual \(m.matchNumber)"
    case "sf": "SF \(m.setNumber)-\(m.matchNumber)"
    case "f":  "Final \(m.matchNumber)"
    default:   "Match \(m.matchNumber)"
    }
}
```

### 4c. Hot Row (Team Context Pills)

```swift
enum NoteContext: Equatable {
    case match                     // General — no team filter
    case team(String)              // Team key, e.g. "frc254"
}

@ViewBuilder var hotRow: some View {
    let match = currentMatch
    let redTeams = match?.redTeamKeys ?? []
    let blueTeams = match?.blueTeamKeys ?? []

    ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 6) {
            // Red pills
            ForEach(redTeams, id: \.self) { key in
                teamPill(key: key, color: .red)
            }

            // General pill
            Button {
                withAnimation(.snappy(duration: 0.2)) { context = .match }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            } label: {
                Text("General")
                    .font(.caption.bold())
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(context == .match ? Color.primary.opacity(0.2) : .clear,
                                in: Capsule())
                    .overlay(Capsule().stroke(.primary.opacity(0.3), lineWidth: 1))
            }
            .buttonStyle(.plain)

            // Blue pills
            ForEach(blueTeams, id: \.self) { key in
                teamPill(key: key, color: .blue)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
    }
    .background(.ultraThinMaterial)
}

func teamPill(key: String, color: Color) -> some View {
    let num = key.replacingOccurrences(of: "frc", with: "")
    let isActive = context == .team(key)

    return Button {
        withAnimation(.snappy(duration: 0.2)) { context = .team(key) }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    } label: {
        Text(num)
            .font(.caption.bold().monospacedDigit())
            .foregroundStyle(isActive ? .white : color)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(isActive ? color : color.opacity(0.1), in: Capsule())
    }
    .buttonStyle(.plain)
    .sensoryFeedback(.selection, trigger: isActive)
}
```

### 4d. Timeline Feed

The timeline is the **core visual element**. Notes appear newest-at-top with a central spine. Red-alliance notes go left, blue-alliance notes go right, system/general notes are centered.

```swift
@ViewBuilder var timeline: some View {
    ScrollViewReader { proxy in
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(sortedNotes) { note in
                    timelineRow(note: note)
                        .id(note.id)
                        .opacity(isDimmed(note) ? 0.35 : 1.0)
                        .animation(.easeInOut(duration: 0.2), value: context)
                }
            }
            .padding()
        }
        .onChange(of: notes.count) { _, _ in
            // Scroll to newest note
            if let newest = sortedNotes.first {
                withAnimation(.easeOut(duration: 0.3)) {
                    proxy.scrollTo(newest.id, anchor: .top)
                }
            }
        }
    }
    .background {
        // Central spine line
        Rectangle()
            .fill(.tertiary.opacity(0.3))
            .frame(width: 2)
    }
}

/// Newest first
var sortedNotes: [CasterNote] {
    notes.sorted { ($0.createdAt) > ($1.createdAt) }
}

/// Dim notes that don't match the active context
func isDimmed(_ note: CasterNote) -> Bool {
    guard case .team(let key) = context else { return false }
    if note.type == "system" { return false }
    return note.teamKey != key
}
```

### 4e. Timeline Row Rendering

```swift
@ViewBuilder func timelineRow(note: CasterNote) -> some View {
    let side = noteSide(note)

    switch side {
    case .system:
        systemBadge(note: note)
    case .red:
        HStack(alignment: .top, spacing: 8) {
            noteBubble(note: note, color: .red)
            Spacer(minLength: 40)
        }
    case .blue:
        HStack(alignment: .top, spacing: 8) {
            Spacer(minLength: 40)
            noteBubble(note: note, color: .blue)
        }
    case .center:
        centerBubble(note: note)
    }
}

enum NoteSide { case red, blue, center, system }

func noteSide(_ note: CasterNote) -> NoteSide {
    if note.type == "system" { return .system }
    guard let match = currentMatch, let teamKey = note.teamKey else { return .center }

    let redKeys = Set(match.redTeamKeys)
    let blueKeys = Set(match.blueTeamKeys)

    if redKeys.contains(teamKey) { return .red }
    if blueKeys.contains(teamKey) { return .blue }
    return .center
}
```

### 4f. Note Bubble

```swift
@ViewBuilder func noteBubble(note: CasterNote, color: Color) -> some View {
    VStack(alignment: color == .red ? .leading : .trailing, spacing: 4) {
        // Header: time + team number
        HStack(spacing: 6) {
            if color == .red {
                Text(matchTime(note))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
                if let tk = note.teamKey {
                    teamBadge(tk, color: color)
                }
            } else {
                if let tk = note.teamKey {
                    teamBadge(tk, color: color)
                }
                Text(matchTime(note))
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }

        // Content
        Text(note.content)
            .font(.subheadline)
    }
    .padding(10)
    .background(color.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    .overlay(
        RoundedRectangle(cornerRadius: 12)
            .stroke(color.opacity(0.2), lineWidth: 1)
    )
    .frame(maxWidth: UIScreen.main.bounds.width * 0.55, alignment: color == .red ? .leading : .trailing)
    .transition(.asymmetric(
        insertion: .scale(scale: 0.8).combined(with: .opacity),
        removal: .opacity
    ))
}

func teamBadge(_ key: String, color: Color) -> some View {
    Text(key.replacingOccurrences(of: "frc", with: ""))
        .font(.caption2.bold().monospacedDigit())
        .foregroundStyle(.white)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(color, in: Capsule())
}
```

### 4g. System Badge

```swift
@ViewBuilder func systemBadge(note: CasterNote) -> some View {
    let macro = SystemMacro(rawValue: note.content)

    HStack(spacing: 6) {
        Image(systemName: macro?.icon ?? "info.circle")
            .font(.caption)
        Text(macro?.label ?? note.content)
            .font(.caption.bold())
        Text(matchTime(note))
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.secondary)
    }
    .foregroundStyle(.white)
    .padding(.horizontal, 14)
    .padding(.vertical, 6)
    .background((macro?.color ?? .gray).gradient, in: Capsule())
    .frame(maxWidth: .infinity)
    .transition(.scale(scale: 0.6).combined(with: .opacity))
}
```

### 4h. Center Bubble (General/Neutral Notes)

```swift
@ViewBuilder func centerBubble(note: CasterNote) -> some View {
    VStack(alignment: .leading, spacing: 4) {
        Text(note.author)
            .font(.caption2.bold())
            .foregroundStyle(.secondary)
        Text(note.content)
            .font(.subheadline)
        Text(matchTime(note))
            .font(.caption2.monospacedDigit())
            .foregroundStyle(.tertiary)
    }
    .padding(10)
    .frame(maxWidth: UIScreen.main.bounds.width * 0.6)
    .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
}
```

### 4i. Match Time Calculator

```swift
/// Formats elapsed time relative to the first AUTO_START note
func matchTime(_ note: CasterNote) -> String {
    let autoStart = notes.first { $0.type == "system" && $0.content == "AUTO_START" }
    guard let ref = autoStart,
          let refDate = ISO8601DateFormatter().date(from: ref.createdAt),
          let noteDate = ISO8601DateFormatter().date(from: note.createdAt) else {
        return formatRelativeTime(note.createdAt)
    }

    let seconds = Int(noteDate.timeIntervalSince(refDate))
    let sign = seconds >= 0 ? "+" : "−"
    let absSeconds = abs(seconds)
    let m = absSeconds / 60
    let s = absSeconds % 60
    return "T\(sign)\(m):\(String(format: "%02d", s))"
}
```

---

## 5. Macro Deck

```swift
@ViewBuilder var macroDeck: some View {
    ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 8) {
            ForEach(SystemMacro.allCases, id: \.self) { macro in
                Button {
                    Task { await insertMacro(macro) }
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: macro.icon)
                            .font(.body)
                        Text(macro.label)
                            .font(.caption2.bold())
                    }
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 44)
                    .background(macro.color.gradient, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
    .background(.ultraThinMaterial)
}
```

---

## 6. Input Dock

```swift
@ViewBuilder var inputDock: some View {
    HStack(spacing: 8) {
        // Context indicator
        if case .team(let key) = context {
            Text(key.replacingOccurrences(of: "frc", with: ""))
                .font(.caption2.bold().monospacedDigit())
                .foregroundStyle(.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(teamColor(key), in: Capsule())
        }

        TextField("Add a note…", text: $inputText)
            .textFieldStyle(.roundedBorder)
            .focused($inputFocused)
            .onSubmit { Task { await submitNote() } }

        Button {
            Task { await submitNote() }
        } label: {
            Image(systemName: "paperplane.fill")
                .font(.body)
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(.blue.gradient, in: Circle())
        }
        .disabled(inputText.trimmingCharacters(in: .whitespaces).isEmpty || isSubmitting)
    }
    .padding(.horizontal)
    .padding(.vertical, 8)
    .background(.ultraThinMaterial)
}

func teamColor(_ key: String) -> Color {
    guard let match = currentMatch else { return .gray }
    if match.redTeamKeys.contains(key) { return .red }
    if match.blueTeamKeys.contains(key) { return .blue }
    return .gray
}
```

---

## 7. Note CRUD via Supabase PostgREST

**Important**: Battle Station notes use **direct Supabase PostgREST**, NOT the backend `/api/` endpoints.

### 7a. Configuration

```swift
let supabaseURL = "https://qytovurlcjrpvlbmkyip.supabase.co"
let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5dG92dXJsY2pycHZsYm1reWlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDUzNDIsImV4cCI6MjA5MDk4MTM0Mn0.-nRiYhXoHtZ4kTZgarq8r-c4HUYj8gmbem5qMxVQ8Ss"
```

### 7b. Fetch Notes

```swift
func fetchNotes() async {
    guard let match = currentMatch, let ek = store.selectedEvent else { return }

    var urlString = "\(supabaseURL)/rest/v1/caster_notes?select=*&event_key=eq.\(ek)&match_key=eq.\(match.matchKey)&order=created_at.desc"

    var request = URLRequest(url: URL(string: urlString)!)
    request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
    request.setValue("application/json", forHTTPHeaderField: "Accept")

    // Add auth token if available
    if let token = store.accessToken {
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    do {
        let (data, _) = try await URLSession.shared.data(for: request)
        let decoded = try JSONDecoder().decode([CasterNote].self, from: data)
        await MainActor.run { notes = decoded }
    } catch {
        print("Failed to fetch notes: \(error)")
    }
}
```

### 7c. Insert Note

```swift
func insertNote(content: String, teamKey: String?, type: String = "manual") async throws -> CasterNote {
    guard let match = currentMatch, let ek = store.selectedEvent else {
        throw NSError(domain: "BattleStation", code: 0, userInfo: [NSLocalizedDescriptionKey: "No active match"])
    }

    let author = store.currentUser?.name ?? store.currentUser?.email ?? "Caster"

    let body: [String: Any?] = [
        "event_key": ek,
        "match_key": match.matchKey,
        "team_key": teamKey,
        "author": author,
        "content": content,
        "type": type
    ]

    let jsonData = try JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })

    var request = URLRequest(url: URL(string: "\(supabaseURL)/rest/v1/caster_notes")!)
    request.httpMethod = "POST"
    request.httpBody = jsonData
    request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("return=representation", forHTTPHeaderField: "Prefer")

    if let token = store.accessToken {
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    let (data, _) = try await URLSession.shared.data(for: request)
    let inserted = try JSONDecoder().decode([CasterNote].self, from: data)
    return inserted.first!
}
```

---

## 8. Submit & Macro Actions

### 8a. Submit Note

```swift
func submitNote() async {
    let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty, !store.isGuest else { return }

    let teamKey: String? = {
        if case .team(let key) = context { return key }
        return nil
    }()

    // Clear input immediately
    inputText = ""
    // Reset context to General after submission
    withAnimation(.snappy(duration: 0.2)) { context = .match }

    // Optimistic insert
    let optimisticNote = CasterNote(
        id: "opt-\(Int(Date().timeIntervalSince1970 * 1000))",
        eventKey: store.selectedEvent ?? "",
        matchKey: currentMatch?.matchKey,
        teamKey: teamKey,
        author: store.currentUser?.name ?? "Caster",
        content: text,
        type: "manual",
        createdAt: ISO8601DateFormatter().string(from: .now)
    )

    withAnimation(.spring(duration: 0.3)) {
        notes.append(optimisticNote)
    }

    // Fire haptic
    UIImpactFeedbackGenerator(style: .light).impactOccurred()

    // Submit to Supabase
    do {
        let real = try await insertNote(content: text, teamKey: teamKey)
        // Replace optimistic with real
        if let idx = notes.firstIndex(where: { $0.id == optimisticNote.id }) {
            notes[idx] = real
        }
    } catch {
        // Revert optimistic insert, restore text
        notes.removeAll { $0.id == optimisticNote.id }
        inputText = text
    }
}
```

### 8b. Insert Macro

```swift
func insertMacro(_ macro: SystemMacro) async {
    guard !store.isGuest else { return }

    let macroNote = CasterNote(
        id: "opt-\(Int(Date().timeIntervalSince1970 * 1000))",
        eventKey: store.selectedEvent ?? "",
        matchKey: currentMatch?.matchKey,
        teamKey: nil,
        author: "SYSTEM",
        content: macro.rawValue,
        type: "system",
        createdAt: ISO8601DateFormatter().string(from: .now)
    )

    withAnimation(.spring(duration: 0.3)) {
        notes.append(macroNote)
    }

    do {
        let real = try await insertNote(content: macro.rawValue, teamKey: nil, type: "system")
        if let idx = notes.firstIndex(where: { $0.id == macroNote.id }) {
            notes[idx] = real
        }
    } catch {
        notes.removeAll { $0.id == macroNote.id }
    }
}
```

---

## 9. Realtime Subscription

```swift
func subscribeRealtime() async {
    // Use the RealtimeManager from the existing codebase
    // Subscribe to caster_notes INSERT events
    // Filter: event_key matches current event

    // When a new note arrives via Realtime:
    // 1. Check it matches the current match (match_key)
    // 2. Deduplicate (check notes.contains(where: { $0.id == newNote.id }))
    // 3. Append with animation
    // 4. Scroll to top

    // On reconnect: re-fetch all notes to catch up
}
```

The Realtime channel should subscribe to:
```
channel: "caster_notes"
event: "INSERT"
filter: "event_key=eq.{eventKey}"
```

When a note arrives:
```swift
func handleRealtimeNote(_ note: CasterNote) {
    guard note.matchKey == currentMatch?.matchKey else { return }
    guard !notes.contains(where: { $0.id == note.id }) else { return }

    withAnimation(.spring(duration: 0.3)) {
        notes.append(note)
    }
}
```

---

## 10. UX Polish — Make It *Feel* Premium

### 10a. Haptic Feedback

Use haptics throughout:
- **Light**: Pill selection, note submission
- **Medium**: Macro tap
- **Success**: Note confirmed by server
- **Warning**: Field fault macro

```swift
// On system note arrival
UINotificationFeedbackGenerator().notificationOccurred(.success)

// On field fault
UINotificationFeedbackGenerator().notificationOccurred(.warning)
```

### 10b. Animations

- **Note entry**: `.spring(duration: 0.3)` scale + opacity
- **Context switch**: `.snappy(duration: 0.2)` for pill highlights
- **Dimming**: `.easeInOut(duration: 0.2)` on opacity
- **System badge**: `.scale(scale: 0.6).combined(with: .opacity)` transition

### 10c. Keyboard Handling

- Use `@FocusState` to manage input focus
- Auto-dismiss keyboard after note submission
- Support external keyboard shortcuts (Cmd+Enter to send)

```swift
.onKeyPress(.return, modifiers: .command) {
    Task { await submitNote() }
    return .handled
}
```

### 10d. Empty State

When no notes exist for the current match:

```swift
if notes.isEmpty {
    VStack(spacing: 12) {
        Image(systemName: "bubble.left.and.bubble.right")
            .font(.largeTitle)
            .foregroundStyle(.tertiary)
        Text("No notes yet")
            .font(.headline)
            .foregroundStyle(.secondary)
        Text("Use the macro buttons or type a note to get started.")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .multilineTextAlignment(.center)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
}
```

### 10e. Pull to Refresh

```swift
.refreshable {
    await loadNotes()
}
```

---

## 11. Match Navigation Integration

When the user changes match via the picker, or when PbP auto-advances:

```swift
func loadNotes() async {
    guard let match = currentMatch, let ek = store.selectedEvent else { return }

    var url = "\(supabaseURL)/rest/v1/caster_notes?select=*&event_key=eq.\(ek)&match_key=eq.\(match.matchKey)&order=created_at.desc"

    // ... fetch and decode
    // Replace notes array entirely on match change
    await MainActor.run { notes = decoded }
}
```

---

## 12. Gotchas

1. **Two note tables exist**: `caster_notes` (used by Battle Station via PostgREST) and `notes` (used by backend API + sync). Battle Station ONLY uses `caster_notes`.
2. **Auth for writes**: Guests can READ notes but cannot INSERT. Check `window.isGuest` / `store.isGuest`.
3. **Context auto-reset**: After every note submission, context resets to `.match` (General). This prevents accidentally tagging notes to the wrong team.
4. **Optimistic inserts**: Use a temporal `id` prefix (`"opt-"`) to distinguish optimistic notes. Replace with real ID when server confirms.
5. **Realtime deduplication**: Always check `notes.contains(where:)` before appending a Realtime note — the optimistic insert may already be there.
6. **Scroll behavior**: Always scroll to the newest note (top) after insertion.
7. **FTC prefix**: For FTC events, team keys use `ftc` prefix instead of `frc`. Use `isFTCMode ? "ftc" : "frc"`.
