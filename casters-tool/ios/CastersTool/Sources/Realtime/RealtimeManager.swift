// RealtimeManager.swift — Native Supabase Realtime via supabase-swift
// Pillar 4: async/await + AsyncStream for live event channels

import Foundation
import Supabase

/// Manages Supabase Realtime WebSocket subscriptions for live event data.
/// Mirrors the web client's realtime.js: subscribes to event_teams, matches,
/// and caster_notes filtered by event_key.
actor RealtimeManager {

    private let store: BroadcastStore
    private let client: SupabaseClient
    private var channel: RealtimeChannelV2?
    private var currentEventKey: String?

    // Reconnection
    private var reconnectTask: Task<Void, Never>?
    private var reconnectAttempt: Int = 0
    private static let maxBackoff: TimeInterval = 30

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init(
        store: BroadcastStore,
        supabaseURL: String = "",
        supabaseAnonKey: String = ""
    ) {
        self.store = store
        self.client = SupabaseClient(
            supabaseURL: URL(string: supabaseURL)!,
            supabaseKey: supabaseAnonKey
        )
    }

    // MARK: - Subscribe to Event Channel

    /// Subscribe to Realtime changes for a specific event.
    /// Creates a single multiplexed channel with 3 table listeners,
    /// matching the web client's pattern: `event:{eventKey}`.
    func subscribe(eventKey: String) async {
        // Tear down existing subscription
        await unsubscribe()
        currentEventKey = eventKey
        reconnectAttempt = 0

        let ch = client.realtimeV2.channel("event:\(eventKey)")

        // 1. event_teams — team stat updates (rank, OPR, EPA changes)
        let teamChanges = ch.postgresChange(
            AnyAction.self,
            schema: "public",
            table: "event_teams",
            filter: "event_key=eq.\(eventKey)"
        )

        // 2. matches — score updates, status transitions
        let matchChanges = ch.postgresChange(
            AnyAction.self,
            schema: "public",
            table: "matches",
            filter: "event_key=eq.\(eventKey)"
        )

        // 3. caster_notes — new notes from other casters
        let noteInserts = ch.postgresChange(
            InsertAction.self,
            schema: "public",
            table: "caster_notes",
            filter: "event_key=eq.\(eventKey)"
        )

        // Start listening
        await ch.subscribe()
        self.channel = ch

        // Process team updates
        Task { [weak self] in
            for await change in teamChanges {
                guard let self else { return }
                await self.handleTeamChange(change)
            }
        }

        // Process match updates
        Task { [weak self] in
            for await change in matchChanges {
                guard let self else { return }
                await self.handleMatchChange(change)
            }
        }

        // Process note inserts
        Task { [weak self] in
            for await change in noteInserts {
                guard let self else { return }
                await self.handleNoteInsert(change)
            }
        }

        // Monitor channel status for reconnection
        Task { [weak self] in
            guard let self else { return }
            await self.monitorConnection(ch, eventKey: eventKey)
        }
    }

    /// Unsubscribe from the current event channel.
    func unsubscribe() async {
        reconnectTask?.cancel()
        reconnectTask = nil
        if let ch = channel {
            await ch.unsubscribe()
        }
        channel = nil
        currentEventKey = nil
    }

    // MARK: - Change Handlers

    private func handleTeamChange(_ change: AnyAction) async {
        guard let record = change.record else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: record)
            let dto = try decoder.decode(TeamDTO.self, from: data)

            // Map DTO → SwiftData model and update store
            let team = CachedTeam(
                eventKey: dto.eventKey,
                teamKey: dto.teamKey,
                teamNumber: dto.rawData?.teamNumber ?? 0,
                nickname: dto.rawData?.nickname ?? ""
            )
            team.rank = dto.rawData?.rank
            team.wins = dto.rawData?.wins ?? 0
            team.losses = dto.rawData?.losses ?? 0
            team.ties = dto.rawData?.ties ?? 0
            team.matchesPlayed = dto.rawData?.matchesPlayed ?? 0
            team.oprTotalPoints = dto.rawData?.oprTotalPoints
            team.epaTotal = dto.rawData?.epaTotal

            await store.didReceiveTeamUpdate(team)
        } catch {
            // Malformed payload — skip
        }
    }

    private func handleMatchChange(_ change: AnyAction) async {
        guard let record = change.record else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: record)
            let dto = try decoder.decode(MatchDTO.self, from: data)

            let match = CachedMatch(
                matchKey: dto.matchKey,
                eventKey: dto.eventKey,
                compLevel: dto.compLevel,
                matchNumber: dto.matchNumber,
                setNumber: dto.setNumber,
                status: dto.status,
                redTeamKeys: dto.alliances?.red?.teamKeys ?? [],
                blueTeamKeys: dto.alliances?.blue?.teamKeys ?? []
            )
            match.redScore = dto.alliances?.red?.score
            match.blueScore = dto.alliances?.blue?.score

            if let rs = match.redScore, let bs = match.blueScore, rs >= 0 && bs >= 0 {
                match.winningAlliance = rs > bs ? "red" : (bs > rs ? "blue" : nil)
            }
            match.alliancesJSON = try? JSONEncoder().encode(dto.alliances)
            match.scoreBreakdownJSON = try? JSONEncoder().encode(dto.scoreBreakdown)

            if let timeStr = dto.scheduledTime {
                match.scheduledTime = ISO8601DateFormatter().date(from: timeStr)
            }

            await store.didReceiveMatchUpdate(match)
        } catch {
            // Malformed payload — skip
        }
    }

    private func handleNoteInsert(_ change: InsertAction) async {
        guard let record = change.record else { return }
        do {
            let data = try JSONSerialization.data(withJSONObject: record)
            let dto = try decoder.decode(NoteDTO.self, from: data)

            let note = CachedNote(
                id: dto.id ?? UUID(),
                eventKey: dto.eventKey,
                matchKey: dto.matchKey,
                teamKey: dto.teamKey,
                author: dto.author ?? "Unknown",
                content: dto.content ?? "",
                type: dto.type ?? "manual",
                createdAt: ISO8601DateFormatter().date(from: dto.createdAt ?? "") ?? .now,
                pendingSync: false
            )

            await store.didReceiveNoteInsert(note)
        } catch {
            // Malformed payload — skip
        }
    }

    // MARK: - Connection Monitoring + Exponential Backoff Reconnect

    private func monitorConnection(
        _ channel: RealtimeChannelV2,
        eventKey: String
    ) async {
        // supabase-swift v2 exposes channel status as an AsyncStream.
        // If the channel closes unexpectedly, we reconnect with backoff.
        for await status in channel.statusChange {
            switch status {
            case .subscribed:
                reconnectAttempt = 0
                await MainActor.run {
                    Task { await store.reconcileAfterReconnect() }
                }

            case .closed, .unsubscribed:
                // Only reconnect if we still want this event
                guard currentEventKey == eventKey else { return }
                await scheduleReconnect(eventKey: eventKey)

            default:
                break
            }
        }
    }

    private func scheduleReconnect(eventKey: String) async {
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            guard let self else { return }

            let delay = min(
                pow(2.0, Double(reconnectAttempt)) * 0.5,
                Self.maxBackoff
            )
            reconnectAttempt += 1

            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }

            await self.subscribe(eventKey: eventKey)
        }
    }
}

// MARK: - Supabase Realtime Type Aliases
// These represent the supabase-swift SDK types used above.
// In a real project, these come from `import Supabase`.

/// Placeholder for any postgres_changes action (INSERT, UPDATE, DELETE).
struct AnyAction {
    let record: [String: Any]?
}

/// Placeholder for INSERT-only actions.
struct InsertAction {
    let record: [String: Any]?
}
