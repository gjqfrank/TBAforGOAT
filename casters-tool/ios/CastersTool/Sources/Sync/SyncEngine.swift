// SyncEngine.swift — Offline-first sync between SwiftData and Supabase
// Pillar 3: Morning sync, write queue, network-gated uploads

import Foundation
import Network
import SwiftData

/// Manages bidirectional sync between local SwiftData and the Supabase backend.
/// Reads go through the BFF API (same FastAPI backend), writes go directly to Supabase.
actor SyncEngine {

    private let context: ModelContext
    private let monitor = NWPathMonitor()
    private let monitorQueue = DispatchQueue(label: "dev.casters.network-monitor")
    private var isOnline: Bool = true

    /// Base URL of the Caster's Tool backend (BFF).
    private let baseURL: URL

    /// Supabase config for direct writes (notes).
    private let supabaseURL: String
    private let supabaseAnonKey: String

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()

    init(
        context: ModelContext,
        baseURL: URL = URL(string: "https://your-backend.fly.dev")!,
        supabaseURL: String = "",
        supabaseAnonKey: String = ""
    ) {
        self.context = context
        self.baseURL = baseURL
        self.supabaseURL = supabaseURL
        self.supabaseAnonKey = supabaseAnonKey

        monitor.pathUpdateHandler = { [weak self] path in
            Task { await self?.setOnline(path.status == .satisfied) }
        }
        monitor.start(queue: monitorQueue)
    }

    private func setOnline(_ online: Bool) {
        let wasOffline = !isOnline
        isOnline = online
        if online && wasOffline {
            Task { await flushPendingNotes() }
        }
    }

    // MARK: - Full Event Sync (Pull)

    /// Fetch teams + matches for an event from the BFF and persist to SwiftData.
    func syncEvent(_ eventKey: String) async {
        await syncTeams(eventKey)
        await syncMatches(eventKey)
    }

    private func syncTeams(_ eventKey: String) async {
        guard let url = URL(string: "\(baseURL)/api/events/\(eventKey)/teams") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let dtos = try decoder.decode([TeamDTO].self, from: data)
            for dto in dtos {
                upsertTeam(dto, eventKey: eventKey)
            }
            try context.save()
        } catch {
            // Offline or API error — local cache remains valid
        }
    }

    private func syncMatches(_ eventKey: String) async {
        guard let url = URL(string: "\(baseURL)/api/matches/\(eventKey)/all") else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: url)
            let dtos = try decoder.decode([MatchDTO].self, from: data)
            for dto in dtos {
                upsertMatch(dto)
            }
            try context.save()
        } catch {
            // Offline — local cache remains
        }
    }

    // MARK: - Upsert Helpers

    private func upsertTeam(_ dto: TeamDTO, eventKey: String) {
        let raw = dto.rawData
        let predicate = #Predicate<CachedTeam> {
            $0.eventKey == eventKey && $0.teamKey == dto.teamKey
        }
        let existing = try? context.fetch(FetchDescriptor<CachedTeam>(predicate: predicate)).first

        let team = existing ?? CachedTeam(
            eventKey: eventKey,
            teamKey: dto.teamKey,
            teamNumber: raw?.teamNumber ?? 0,
            nickname: raw?.nickname ?? ""
        )

        // Update fields from DTO
        team.rank = raw?.rank
        team.wins = raw?.wins ?? team.wins
        team.losses = raw?.losses ?? team.losses
        team.ties = raw?.ties ?? team.ties
        team.matchesPlayed = raw?.matchesPlayed ?? team.matchesPlayed
        team.oprTotalPoints = raw?.oprTotalPoints
        team.oprAutoPoints = raw?.oprAutoPoints
        team.epaTotal = raw?.epaTotal
        team.epaRecent = raw?.epaRecent
        team.country = raw?.country ?? team.country
        team.stateProv = raw?.stateProv ?? team.stateProv
        team.city = raw?.city ?? team.city
        team.rookieYear = raw?.rookieYear ?? team.rookieYear
        team.sortOrders = raw?.sortOrders
        team.updatedAt = .now

        if existing == nil { context.insert(team) }
    }

    private func upsertMatch(_ dto: MatchDTO) {
        let predicate = #Predicate<CachedMatch> { $0.matchKey == dto.matchKey }
        let existing = try? context.fetch(FetchDescriptor<CachedMatch>(predicate: predicate)).first

        let match = existing ?? CachedMatch(
            matchKey: dto.matchKey,
            eventKey: dto.eventKey,
            compLevel: dto.compLevel,
            matchNumber: dto.matchNumber,
            setNumber: dto.setNumber
        )

        match.status = dto.status
        match.redScore = dto.alliances?.red?.score
        match.blueScore = dto.alliances?.blue?.score
        match.redTeamKeys = dto.alliances?.red?.teamKeys ?? match.redTeamKeys
        match.blueTeamKeys = dto.alliances?.blue?.teamKeys ?? match.blueTeamKeys

        // Determine winner
        if let rs = match.redScore, let bs = match.blueScore, rs >= 0 && bs >= 0 {
            match.winningAlliance = rs > bs ? "red" : (bs > rs ? "blue" : nil)
        }

        // Store full JSONB as Data for breakdown views
        match.alliancesJSON = try? JSONEncoder().encode(dto.alliances)
        match.scoreBreakdownJSON = try? JSONEncoder().encode(dto.scoreBreakdown)

        if let timeStr = dto.scheduledTime {
            match.scheduledTime = ISO8601DateFormatter().date(from: timeStr)
        }
        match.updatedAt = .now

        if existing == nil { context.insert(match) }
    }

    // MARK: - Note Push (Write Queue)

    /// Push a locally-created note to Supabase. Retries automatically when back online.
    func pushNote(_ note: CachedNote) async {
        guard isOnline else { return }  // stays pendingSync = true for later flush

        guard let url = URL(string: "\(supabaseURL)/rest/v1/caster_notes") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(supabaseAnonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(supabaseAnonKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any?] = [
            "id": note.id.uuidString,
            "event_key": note.eventKey,
            "match_key": note.matchKey,
            "team_key": note.teamKey,
            "author": note.author,
            "content": note.content,
            "type": note.type,
        ]

        request.httpBody = try? JSONSerialization.data(
            withJSONObject: body.compactMapValues { $0 }
        )

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) {
                note.pendingSync = false
                try? context.save()
            }
        } catch {
            // Will be retried on next flushPendingNotes()
        }
    }

    /// Flush all notes that were created offline.
    func flushPendingNotes() async {
        let predicate = #Predicate<CachedNote> { $0.pendingSync == true }
        guard let pending = try? context.fetch(
            FetchDescriptor<CachedNote>(predicate: predicate)
        ) else { return }

        for note in pending {
            await pushNote(note)
        }
    }

    // MARK: - Realtime → SwiftData Bridge

    /// Called by RealtimeManager when a team update arrives via WebSocket.
    func applyTeamUpdate(_ dto: TeamDTO) {
        upsertTeam(dto, eventKey: dto.eventKey)
        try? context.save()
    }

    /// Called by RealtimeManager when a match update arrives via WebSocket.
    func applyMatchUpdate(_ dto: MatchDTO) {
        upsertMatch(dto)
        try? context.save()
    }
}
