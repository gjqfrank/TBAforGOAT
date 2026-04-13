# Storylines — Complete Wiring Guide (TypewriterText + SSE Streaming)

> **Purpose**: Storylines are AI-generated broadcast narratives produced by Claude via SSE streaming. Two entry points: **Match Storyline** (from match context menu) and **Team Storyline** (from team long-press). The iOS app must use a **TypewriterText** effect — a character-by-character "ghostwriter" reveal.

---

## 1. Architecture Overview

- **Backend**: `POST /api/storylines/generate/stream` returns SSE events
- **LLM**: Anthropic `claude-sonnet-4-20250514`, max 500 tokens
- **Cache**: 3-tier (in-memory → Supabase `storyline_cache` table → fresh generation). Cached results skip streaming.
- **Web frontend**: Has ZERO implementation — this is **iOS-exclusive**
- **Two modes**: `"match"` (needs `match_key`) and `"team"` (needs `team_number`)

---

## 2. API Contract

### Request

```http
POST /api/storylines/generate/stream
Content-Type: application/json

{
  "mode": "match",              // "match" or "team"
  "event_key": "2026tuak",
  "match_key": "2026tuak_qm15", // required when mode = "match"
  "team_number": null            // required when mode = "team"
}
```

### SSE Events

The server emits these event types in order:

| Event | Data Shape | When |
|-------|-----------|------|
| `start` | `{"cache_key": "match:2026tuak_qm15", "cached": true/false}` | Always first |
| `token` | `{"text": "The "}` | Only when NOT cached — each LLM token |
| `done` | Full response (see below) | Always last on success |
| `error` | `{"detail": "..."}` | On failure |

### `done` Event Payload

```json
{
  "content": { "storyline": "Full text of the storyline..." },
  "meta": {
    "cached": false,
    "generated_at": "2026-01-15T10:30:00Z",
    "input_tokens": 1500,
    "output_tokens": 280,
    "match_count": 45,
    "model": "claude-sonnet-4-20250514"
  },
  "storyline": "Full text of the storyline...",
  "cached": false
}
```

---

## 3. Status Check

Before requesting, check availability:

```http
GET /api/storylines/status
→ { "available": true }
```

If `available` is `false`, disable the Storyline buttons and show a tooltip.

---

## 4. Data Models

```swift
struct StorylineRequest: Codable {
    let mode: String
    let eventKey: String
    let matchKey: String?
    let teamNumber: Int?

    enum CodingKeys: String, CodingKey {
        case mode
        case eventKey = "event_key"
        case matchKey = "match_key"
        case teamNumber = "team_number"
    }
}

struct StorylineResponse: Codable {
    let content: StorylineContent
    let meta: StorylineMeta
    let storyline: String       // top-level for convenience
    let cached: Bool
}

struct StorylineContent: Codable {
    let storyline: String
}

struct StorylineMeta: Codable {
    let cached: Bool
    let generatedAt: String?
    let inputTokens: Int?
    let outputTokens: Int?
    let matchCount: Int?
    let model: String?

    enum CodingKeys: String, CodingKey {
        case cached
        case generatedAt = "generated_at"
        case inputTokens = "input_tokens"
        case outputTokens = "output_tokens"
        case matchCount = "match_count"
        case model
    }
}
```

---

## 5. SSE Client Implementation

### 5a. Streaming Parser

```swift
@Observable
class StorylineViewModel {
    var displayedText = ""       // Text currently shown (for typewriter)
    var fullText = ""            // Complete text received so far
    var isStreaming = false
    var isCached = false
    var error: String?
    var meta: StorylineMeta?

    private var streamTask: Task<Void, Never>?

    func generate(mode: String, eventKey: String, matchKey: String? = nil, teamNumber: Int? = nil) {
        reset()
        isStreaming = true

        streamTask = Task {
            do {
                let body = StorylineRequest(
                    mode: mode,
                    eventKey: eventKey,
                    matchKey: matchKey,
                    teamNumber: teamNumber
                )
                let jsonData = try JSONEncoder().encode(body)

                var request = URLRequest(url: URL(string: "\(APIService.base)/storylines/generate/stream")!)
                request.httpMethod = "POST"
                request.httpBody = jsonData
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")

                let (bytes, response) = try await URLSession.shared.bytes(for: request)

                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    await MainActor.run { error = "Server returned an error." }
                    return
                }

                // Parse SSE line-by-line
                var eventType = ""
                var dataBuffer = ""

                for try await line in bytes.lines {
                    guard !Task.isCancelled else { break }

                    if line.hasPrefix("event: ") {
                        eventType = String(line.dropFirst(7))
                    } else if line.hasPrefix("data: ") {
                        dataBuffer = String(line.dropFirst(6))
                    } else if line.isEmpty {
                        // End of event — process
                        await processEvent(type: eventType, data: dataBuffer)
                        eventType = ""
                        dataBuffer = ""
                    }
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    self.isStreaming = false
                }
            }
        }
    }

    @MainActor
    private func processEvent(type: String, data: String) {
        guard let jsonData = data.data(using: .utf8) else { return }

        switch type {
        case "start":
            if let obj = try? JSONDecoder().decode(StartEvent.self, from: jsonData) {
                isCached = obj.cached
            }

        case "token":
            if let obj = try? JSONDecoder().decode(TokenEvent.self, from: jsonData) {
                fullText += obj.text
                // Typewriter will animate displayedText separately
            }

        case "done":
            if let obj = try? JSONDecoder().decode(StorylineResponse.self, from: jsonData) {
                fullText = obj.storyline
                meta = obj.meta
                if isCached {
                    // Cached — still typewrite it, but from the full text
                    startTypewriter()
                }
            }
            isStreaming = false

        case "error":
            if let obj = try? JSONDecoder().decode(ErrorEvent.self, from: jsonData) {
                error = obj.detail
            }
            isStreaming = false

        default:
            break
        }
    }

    func cancel() {
        streamTask?.cancel()
        isStreaming = false
    }

    func reset() {
        cancel()
        displayedText = ""
        fullText = ""
        isCached = false
        error = nil
        meta = nil
    }

    // Helper DTOs
    struct StartEvent: Codable { let cached: Bool }
    struct TokenEvent: Codable { let text: String }
    struct ErrorEvent: Codable { let detail: String }
}
```

---

## 6. TypewriterText Effect

The core UX feature. Text reveals character by character with a ghostwriter effect.

### 6a. TypewriterText View

```swift
struct TypewriterText: View {
    let fullText: String
    var speed: TimeInterval = 0.02    // seconds per character
    var onComplete: (() -> Void)?

    @State private var visibleCount = 0
    @State private var timer: Timer?

    private var displayedText: String {
        String(fullText.prefix(visibleCount))
    }

    private var cursorVisible: Bool {
        visibleCount < fullText.count
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            Text(displayedText)
                .font(.body)
                .lineSpacing(4)

            // Blinking cursor
            if cursorVisible {
                Rectangle()
                    .fill(.primary)
                    .frame(width: 2, height: 16)
                    .opacity(cursorOpacity)
            }
        }
        .onAppear { startTyping() }
        .onDisappear { stopTyping() }
        .onChange(of: fullText) { _, _ in
            // Text grew (new tokens arrived) — continue typing
            if visibleCount >= fullText.count {
                // Already done, reset for new text
            }
            // Timer will catch up naturally
        }
    }

    @State private var cursorOpacity: Double = 1.0

    func startTyping() {
        visibleCount = 0
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: speed, repeats: true) { t in
            if visibleCount < fullText.count {
                visibleCount += 1
            } else {
                t.invalidate()
                onComplete?()
            }
        }

        // Cursor blink animation
        withAnimation(.easeInOut(duration: 0.5).repeatForever()) {
            cursorOpacity = 0.2
        }
    }

    func stopTyping() {
        timer?.invalidate()
    }
}
```

### 6b. Streaming-Aware TypewriterText

For non-cached responses, tokens arrive progressively. The typewriter chases the growing `fullText`:

```swift
struct StreamingTypewriterText: View {
    @Bindable var viewModel: StorylineViewModel

    @State private var revealIndex = 0
    @State private var displayTimer: Timer?

    private var revealed: String {
        String(viewModel.fullText.prefix(revealIndex))
    }

    var body: some View {
        ScrollView {
            Text(revealed)
                .font(.body)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
        }
        .onAppear { startChasing() }
        .onDisappear { displayTimer?.invalidate() }
    }

    func startChasing() {
        displayTimer?.invalidate()
        displayTimer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
            if revealIndex < viewModel.fullText.count {
                revealIndex += 1
            } else if !viewModel.isStreaming {
                displayTimer?.invalidate()
            }
        }
    }
}
```

---

## 7. Storyline Sheet View

### 7a. Match Storyline (from match context)

Trigger: button in match detail view or match toolbar.

```swift
struct StorylineSheet: View {
    let mode: String
    let eventKey: String
    let matchKey: String?
    let teamNumber: Int?
    let title: String

    @State private var viewModel = StorylineViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let error = viewModel.error {
                    // Error state
                    ContentUnavailableView {
                        Label("Storyline Failed", systemImage: "exclamationmark.bubble")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Try Again") {
                            viewModel.generate(
                                mode: mode, eventKey: eventKey,
                                matchKey: matchKey, teamNumber: teamNumber
                            )
                        }
                    }

                } else if viewModel.fullText.isEmpty && viewModel.isStreaming {
                    // Loading state
                    VStack(spacing: 16) {
                        ProgressView()
                            .scaleEffect(1.2)
                        Text("Generating storyline…")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                } else {
                    // Content — typewriter
                    StreamingTypewriterText(viewModel: viewModel)

                    // Meta footer
                    if let meta = viewModel.meta {
                        metaFooter(meta)
                    }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    if viewModel.isStreaming {
                        Button("Stop") { viewModel.cancel() }
                    }
                }
            }
        }
        .onAppear {
            viewModel.generate(
                mode: mode, eventKey: eventKey,
                matchKey: matchKey, teamNumber: teamNumber
            )
        }
    }

    @ViewBuilder func metaFooter(_ meta: StorylineMeta) -> some View {
        HStack(spacing: 12) {
            if meta.cached {
                Label("Cached", systemImage: "bolt.fill")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let model = meta.model {
                Text(model)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            Spacer()
            if let tokens = meta.outputTokens {
                Text("\(tokens) tokens")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }
}
```

### 7b. Entry Points

**Match Storyline** — from match toolbar or context menu:
```swift
.sheet(isPresented: $showMatchStoryline) {
    StorylineSheet(
        mode: "match",
        eventKey: store.selectedEvent ?? "",
        matchKey: currentMatch?.matchKey,
        teamNumber: nil,
        title: "Match Storyline"
    )
}
```

**Team Storyline** — from team long-press context menu:
```swift
.contextMenu {
    Button {
        showTeamStoryline = true
    } label: {
        Label("Team Storyline", systemImage: "text.bubble")
    }
}
.sheet(isPresented: $showTeamStoryline) {
    StorylineSheet(
        mode: "team",
        eventKey: store.selectedEvent ?? "",
        matchKey: nil,
        teamNumber: selectedTeamNumber,
        title: "Team \(selectedTeamNumber ?? 0) Storyline"
    )
}
```

---

## 8. Availability Check

```swift
extension APIService {
    static func storylineAvailable() async -> Bool {
        guard let url = URL(string: "\(base)/storylines/status") else { return false }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let obj = try JSONDecoder().decode([String: Bool].self, from: data)
            return obj["available"] ?? false
        } catch {
            return false
        }
    }
}
```

Disable storyline buttons when unavailable:
```swift
@State private var storylinesAvailable = false

.task {
    storylinesAvailable = await APIService.storylineAvailable()
}
```

---

## 9. Gotchas

1. **Cache behavior**: When cached, server emits `start(cached=true)` then `done` immediately — no `token` events. Still typewrite the result from the `done` payload.
2. **SSE parsing**: Lines use `\n\n` as event delimiter. Some lines may be empty. Parse by `event:` and `data:` prefixes.
3. **Task cancellation**: On sheet dismiss or mode change, cancel the streaming task via `viewModel.cancel()`.
4. **Token speed**: 0.02s per character works well for ~500-token responses. Adjust if text is very short (cached).
5. **Cursor**: The blinking cursor at the end of revealed text is optional but adds significant polish. Remove after typing completes.
6. **503 error**: If Anthropic key is not configured, server returns 503. Handle this gracefully — show "AI Storylines unavailable" rather than a generic error.
7. **Event freshness**: The backend uses `match_count` to invalidate cached storylines. If new matches have been played since the cache was made, it regenerates. This is automatic.
