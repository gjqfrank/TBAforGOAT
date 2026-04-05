-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Phase 1.1: Foundational Schema
--  Offline-First BFF with Delta Sync (Last Write Wins)
-- ═══════════════════════════════════════════════════════════════════════

-- ── Extensions ─────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ── Trigger function: auto-stamp updated_at on every UPDATE ────────────
-- Without this, DEFAULT now() only fires on INSERT.  The delta sync
-- engine relies on updated_at advancing on every mutation.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════════════════════
--  events — active & historical FRC / FTC events
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE events (
    event_key        TEXT        PRIMARY KEY,              -- "2026tuak" / "2025ftcTRTUQ1"
    name             TEXT        NOT NULL,
    start_date       DATE,
    end_date         DATE,
    competition_type TEXT        NOT NULL DEFAULT 'frc'
                                 CHECK (competition_type IN ('frc', 'ftc')),
    raw_data         JSONB       NOT NULL DEFAULT '{}',    -- full TBA / FTC API dump
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_updated_at       ON events (updated_at);
CREATE INDEX idx_events_competition_type ON events (competition_type);
CREATE INDEX idx_events_start_date       ON events (start_date);

CREATE TRIGGER trg_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  teams
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE teams (
    team_key         TEXT        PRIMARY KEY,              -- "frc254" / "ftc12345"
    team_number      INTEGER     NOT NULL,
    nickname         TEXT,
    competition_type TEXT        NOT NULL DEFAULT 'frc'
                                 CHECK (competition_type IN ('frc', 'ftc')),
    raw_tims_data    JSONB       NOT NULL DEFAULT '{}',    -- scouting / enrichment overlay
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_updated_at   ON teams (updated_at);
CREATE INDEX idx_teams_team_number  ON teams (team_number);

CREATE TRIGGER trg_teams_updated_at
    BEFORE UPDATE ON teams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  event_teams — junction: which teams attend which events
--  Needed so the sync engine can deliver only relevant teams per event.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE event_teams (
    event_key   TEXT NOT NULL REFERENCES events (event_key) ON DELETE CASCADE,
    team_key    TEXT NOT NULL REFERENCES teams  (team_key)  ON DELETE CASCADE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_key, team_key)
);

CREATE INDEX idx_event_teams_updated_at ON event_teams (updated_at);

CREATE TRIGGER trg_event_teams_updated_at
    BEFORE UPDATE ON event_teams
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  matches — high-frequency table (5-second polling loop)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE matches (
    match_key       TEXT        PRIMARY KEY,               -- "2026tuak_qm15"
    event_key       TEXT        NOT NULL
                                REFERENCES events (event_key) ON DELETE CASCADE,
    comp_level      TEXT        NOT NULL DEFAULT 'qm',     -- qm, sf, f
    match_number    INTEGER     NOT NULL DEFAULT 0,
    set_number      INTEGER     NOT NULL DEFAULT 1,
    status          TEXT        NOT NULL DEFAULT 'upcoming',
    alliances       JSONB       NOT NULL DEFAULT '{}',     -- {red:{teams,score}, blue:{…}}
    score_breakdown JSONB       NOT NULL DEFAULT '{}',     -- game-year specific
    scheduled_time  TIMESTAMPTZ,
    raw_data        JSONB       NOT NULL DEFAULT '{}',     -- full API payload
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_updated_at ON matches (updated_at);
CREATE INDEX idx_matches_event_key  ON matches (event_key);

CREATE TRIGGER trg_matches_updated_at
    BEFORE UPDATE ON matches
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  tims_overrides — caster-created custom sponsor reads
--  User-space: supports soft delete for offline mesh propagation.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE tims_overrides (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_key            TEXT        NOT NULL
                                    REFERENCES teams (team_key) ON DELETE CASCADE,
    custom_sponsor_read TEXT        NOT NULL,
    author_user_id      UUID,                                  -- Supabase auth.users ref (cloud auth)
    author_device_id    TEXT        NOT NULL,                   -- client-generated UUID (P2P mesh conflict key)
    is_deleted          BOOLEAN     NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),     -- immutable audit timestamp
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tims_overrides_updated_at ON tims_overrides (updated_at);
CREATE INDEX idx_tims_overrides_team_key   ON tims_overrides (team_key) WHERE NOT is_deleted;

CREATE TRIGGER trg_tims_overrides_updated_at
    BEFORE UPDATE ON tims_overrides
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  notes — floating scratchpad notes attached to any entity
--  User-space: supports soft delete for offline mesh propagation.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE notes (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    target_key       TEXT        NOT NULL,                     -- team_key, match_key, or event_key
    content          TEXT        NOT NULL,
    author_user_id   UUID,                                     -- Supabase auth.users ref (cloud auth)
    author_device_id TEXT        NOT NULL,                      -- client-generated UUID (P2P mesh conflict key)
    is_deleted       BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),        -- immutable audit timestamp
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notes_updated_at  ON notes (updated_at);
CREATE INDEX idx_notes_target_key  ON notes (target_key) WHERE NOT is_deleted;

CREATE TRIGGER trg_notes_updated_at
    BEFORE UPDATE ON notes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
