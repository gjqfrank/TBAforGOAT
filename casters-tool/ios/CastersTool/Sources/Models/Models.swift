// Models.swift — SwiftData @Model types mirroring Supabase schema
// Pillar 3: Offline-first persistence with SwiftData

import Foundation
import SwiftData

// MARK: - CachedTeam (mirrors: event_teams + teams join)

@Model
final class CachedTeam {
    #Unique<CachedTeam>([\.eventKey, \.teamKey])

    var eventKey: String          // "2026tuak"
    var teamKey: String           // "frc254"
    var teamNumber: Int           // 254
    var nickname: String          // "The Cheesy Poofs"

    // Rankings (from event_teams.raw_data JSONB)
    var rank: Int?
    var wins: Int
    var losses: Int
    var ties: Int
    var matchesPlayed: Int
    var rankingPoints: Double?
    var avgRP: Double?
    var sortOrders: [Double]?

    // Performance stats (merged from OPR/EPA workers)
    var oprTotalPoints: Double?
    var oprAutoPoints: Double?
    var oprTeleopPoints: Double?
    var epaTotal: Double?
    var epaRecent: Double?

    // Team metadata
    var country: String?
    var stateProv: String?
    var city: String?
    var rookieYear: Int?
    var avatarBase64: String?

    // Sync tracking
    var updatedAt: Date

    init(
        eventKey: String,
        teamKey: String,
        teamNumber: Int,
        nickname: String,
        rank: Int? = nil,
        wins: Int = 0,
        losses: Int = 0,
        ties: Int = 0,
        matchesPlayed: Int = 0,
        updatedAt: Date = .now
    ) {
        self.eventKey = eventKey
        self.teamKey = teamKey
        self.teamNumber = teamNumber
        self.nickname = nickname
        self.rank = rank
        self.wins = wins
        self.losses = losses
        self.ties = ties
        self.matchesPlayed = matchesPlayed
        self.updatedAt = updatedAt
    }
}

// MARK: - CachedMatch (mirrors: matches table)

@Model
final class CachedMatch {
    #Unique<CachedMatch>([\.matchKey])

    var matchKey: String          // "2026tuak_qm15"
    var eventKey: String          // "2026tuak"
    var compLevel: String         // "qm", "sf", "f"
    var matchNumber: Int
    var setNumber: Int
    var status: String            // "upcoming", "in_progress", "completed"

    // Alliance scores (flattened from JSONB)
    var redScore: Int?
    var blueScore: Int?
    var redTeamKeys: [String]     // ["frc254", "frc1678", "frc971"]
    var blueTeamKeys: [String]

    // Winner
    var winningAlliance: String?  // "red", "blue", nil for tie

    // Full JSONB stored as Data for detail views
    var alliancesJSON: Data?
    var scoreBreakdownJSON: Data?

    // Scheduling
    var scheduledTime: Date?
    var updatedAt: Date

    init(
        matchKey: String,
        eventKey: String,
        compLevel: String,
        matchNumber: Int,
        setNumber: Int = 1,
        status: String = "upcoming",
        redTeamKeys: [String] = [],
        blueTeamKeys: [String] = [],
        scheduledTime: Date? = nil,
        updatedAt: Date = .now
    ) {
        self.matchKey = matchKey
        self.eventKey = eventKey
        self.compLevel = compLevel
        self.matchNumber = matchNumber
        self.setNumber = setNumber
        self.status = status
        self.redTeamKeys = redTeamKeys
        self.blueTeamKeys = blueTeamKeys
        self.scheduledTime = scheduledTime
        self.updatedAt = updatedAt
    }
}

// MARK: - CachedNote (mirrors: caster_notes table)

@Model
final class CachedNote {
    #Unique<CachedNote>([\.id])

    @Attribute(.unique) var id: UUID
    var eventKey: String
    var matchKey: String?
    var teamKey: String?
    var author: String
    var content: String
    var type: String              // "manual", "system"
    var createdAt: Date

    /// When true, this note was created locally and hasn't been pushed to Supabase yet.
    var pendingSync: Bool

    init(
        id: UUID = UUID(),
        eventKey: String,
        matchKey: String? = nil,
        teamKey: String? = nil,
        author: String,
        content: String,
        type: String = "manual",
        createdAt: Date = .now,
        pendingSync: Bool = false
    ) {
        self.id = id
        self.eventKey = eventKey
        self.matchKey = matchKey
        self.teamKey = teamKey
        self.author = author
        self.content = content
        self.type = type
        self.createdAt = createdAt
        self.pendingSync = pendingSync
    }
}

// MARK: - Codable DTOs for API ↔ SwiftData Mapping

/// Wire format for event_teams rows coming from the backend API or Realtime.
struct TeamDTO: Codable {
    let eventKey: String
    let teamKey: String
    let rawData: TeamRawData?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case eventKey = "event_key"
        case teamKey = "team_key"
        case rawData = "raw_data"
        case updatedAt = "updated_at"
    }
}

struct TeamRawData: Codable {
    let teamNumber: Int?
    let nickname: String?
    let rank: Int?
    let wins: Int?
    let losses: Int?
    let ties: Int?
    let matchesPlayed: Int?
    let oprTotalPoints: Double?
    let oprAutoPoints: Double?
    let epaTotal: Double?
    let epaRecent: Double?
    let country: String?
    let stateProv: String?
    let city: String?
    let rookieYear: Int?
    let avatarBase64: String?
    let sortOrders: [Double]?

    enum CodingKeys: String, CodingKey {
        case teamNumber = "team_number"
        case nickname
        case rank, wins, losses, ties
        case matchesPlayed = "matches_played"
        case oprTotalPoints = "opr_total_points"
        case oprAutoPoints = "opr_auto_points"
        case epaTotal = "epa_total"
        case epaRecent = "epa_recent"
        case country
        case stateProv = "state_prov"
        case city
        case rookieYear = "rookie_year"
        case avatarBase64 = "avatar_base64"
        case sortOrders = "sort_orders"
    }
}

/// Wire format for match rows.
struct MatchDTO: Codable {
    let matchKey: String
    let eventKey: String
    let compLevel: String
    let matchNumber: Int
    let setNumber: Int
    let status: String
    let alliances: AlliancesDTO?
    let scoreBreakdown: AnyCodable?
    let scheduledTime: String?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case matchKey = "match_key"
        case eventKey = "event_key"
        case compLevel = "comp_level"
        case matchNumber = "match_number"
        case setNumber = "set_number"
        case status, alliances
        case scoreBreakdown = "score_breakdown"
        case scheduledTime = "scheduled_time"
        case updatedAt = "updated_at"
    }
}

struct AlliancesDTO: Codable {
    let red: AllianceSideDTO?
    let blue: AllianceSideDTO?
}

struct AllianceSideDTO: Codable {
    let score: Int?
    let teamKeys: [String]?

    enum CodingKeys: String, CodingKey {
        case score
        case teamKeys = "team_keys"
    }
}

/// Wire format for caster_notes rows.
struct NoteDTO: Codable {
    let id: UUID?
    let eventKey: String
    let matchKey: String?
    let teamKey: String?
    let author: String?
    let content: String?
    let type: String?
    let createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case eventKey = "event_key"
        case matchKey = "match_key"
        case teamKey = "team_key"
        case author, content, type
        case createdAt = "created_at"
    }
}

// MARK: - Type-erased Codable wrapper for arbitrary JSONB

struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) { self.value = value }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else if let arr = try? container.decode([AnyCodable].self) {
            value = arr.map(\.value)
        } else if let str = try? container.decode(String.self) {
            value = str
        } else if let num = try? container.decode(Double.self) {
            value = num
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let str as String: try container.encode(str)
        case let num as Double: try container.encode(num)
        case let num as Int: try container.encode(num)
        case let bool as Bool: try container.encode(bool)
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        case let arr as [Any]:
            try container.encode(arr.map { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
