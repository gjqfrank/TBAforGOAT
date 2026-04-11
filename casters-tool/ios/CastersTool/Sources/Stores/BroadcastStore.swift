// BroadcastStore.swift — Central state container for Caster's Tool
// Pillar 2: @Observable macro (iOS 17+), single source of truth

import SwiftUI
import SwiftData

@Observable
final class BroadcastStore {

    // MARK: - Navigation State

    var selectedEvent: String?          // e.g. "2026tuak"
    var selectedTeam: CachedTeam?
    var selectedMatch: CachedMatch?
    var columnVisibility: NavigationSplitViewVisibility = .all

    // MARK: - Live Data

    var rankings: [CachedTeam] = []
    var matches: [CachedMatch] = []
    var notes: [CachedNote] = []

    // MARK: - Connection State

    private(set) var isConnected: Bool = false
    private(set) var lastSyncDate: Date?
    private(set) var syncError: String?

    // MARK: - Managers (injected at bootstrap)

    private var realtime: RealtimeManager?
    private var syncEngine: SyncEngine?
    private var modelContext: ModelContext?

    // MARK: - Bootstrap

    /// Called once from ContentView.task — wires up persistence + realtime.
    func bootstrap() async {
        // SwiftData container is set up by the App @main entry point
        // and injected via .modelContainer(). We access it here.
        guard let container = try? ModelContainer(
            for: CachedTeam.self, CachedMatch.self, CachedNote.self
        ) else { return }

        let context = ModelContext(container)
        context.autosaveEnabled = true
        self.modelContext = context

        self.syncEngine = SyncEngine(context: context)
        self.realtime = RealtimeManager(store: self)

        // Load cached data from SwiftData first (offline-first)
        await loadCachedData()
    }

    // MARK: - Event Selection

    func selectEvent(_ eventKey: String) async {
        guard eventKey != selectedEvent else { return }
        selectedEvent = eventKey
        selectedTeam = nil
        selectedMatch = nil

        // 1. Load from local SwiftData cache immediately
        await loadCachedData()

        // 2. Subscribe to Realtime channel for this event
        await realtime?.subscribe(eventKey: eventKey)
        isConnected = true

        // 3. Trigger a background sync to refresh from API
        await syncEngine?.syncEvent(eventKey)
        lastSyncDate = .now
    }

    func deselectEvent() async {
        await realtime?.unsubscribe()
        isConnected = false
        selectedEvent = nil
        rankings = []
        matches = []
        notes = []
    }

    // MARK: - Data Loading (SwiftData → Store)

    @MainActor
    private func loadCachedData() async {
        guard let ctx = modelContext, let eventKey = selectedEvent else { return }

        // Fetch teams for current event
        let teamPredicate = #Predicate<CachedTeam> { $0.eventKey == eventKey }
        let teamDescriptor = FetchDescriptor<CachedTeam>(
            predicate: teamPredicate,
            sortBy: [SortDescriptor(\.rank)]
        )
        rankings = (try? ctx.fetch(teamDescriptor)) ?? []

        // Fetch matches for current event
        let matchPredicate = #Predicate<CachedMatch> { $0.eventKey == eventKey }
        let matchDescriptor = FetchDescriptor<CachedMatch>(
            predicate: matchPredicate,
            sortBy: [SortDescriptor(\.scheduledTime)]
        )
        matches = (try? ctx.fetch(matchDescriptor)) ?? []

        // Fetch notes for current event
        let notePredicate = #Predicate<CachedNote> { $0.eventKey == eventKey }
        let noteDescriptor = FetchDescriptor<CachedNote>(
            predicate: notePredicate,
            sortBy: [SortDescriptor(\.createdAt, order: .reverse)]
        )
        notes = (try? ctx.fetch(noteDescriptor)) ?? []
    }

    // MARK: - Realtime Callbacks

    /// Called by RealtimeManager when a team row is updated.
    @MainActor
    func didReceiveTeamUpdate(_ team: CachedTeam) {
        if let idx = rankings.firstIndex(where: { $0.teamKey == team.teamKey }) {
            rankings[idx] = team
        } else {
            rankings.append(team)
        }
        rankings.sort { ($0.rank ?? .max) < ($1.rank ?? .max) }

        // Persist to SwiftData
        modelContext?.insert(team)
    }

    /// Called by RealtimeManager when a match row is updated.
    @MainActor
    func didReceiveMatchUpdate(_ match: CachedMatch) {
        if let idx = matches.firstIndex(where: { $0.matchKey == match.matchKey }) {
            matches[idx] = match
        } else {
            matches.append(match)
        }
        matches.sort { ($0.scheduledTime ?? .distantPast) < ($1.scheduledTime ?? .distantPast) }

        modelContext?.insert(match)
    }

    /// Called by RealtimeManager when a caster note is inserted.
    @MainActor
    func didReceiveNoteInsert(_ note: CachedNote) {
        notes.insert(note, at: 0)
        modelContext?.insert(note)
    }

    // MARK: - Note Authoring (Offline-Queued)

    /// Create a caster note locally and queue for sync.
    @MainActor
    func createNote(content: String, teamKey: String? = nil, matchKey: String? = nil) {
        guard let eventKey = selectedEvent else { return }

        let note = CachedNote(
            id: UUID(),
            eventKey: eventKey,
            matchKey: matchKey,
            teamKey: teamKey,
            author: UserDefaults.standard.string(forKey: "authorName") ?? "Caster",
            content: content,
            type: "manual",
            createdAt: .now,
            pendingSync: true
        )

        notes.insert(note, at: 0)
        modelContext?.insert(note)

        // Queue for upload (SyncEngine handles offline retry)
        Task { await syncEngine?.pushNote(note) }
    }

    // MARK: - Reconnection

    /// Full reconciliation after a Realtime disconnect/reconnect.
    @MainActor
    func reconcileAfterReconnect() async {
        guard let eventKey = selectedEvent else { return }
        isConnected = true
        await syncEngine?.syncEvent(eventKey)
        await loadCachedData()
        lastSyncDate = .now
    }
}
