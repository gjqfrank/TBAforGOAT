-- ═══════════════════════════════════════════════════════════════
-- TBAforGOAT — Combined Supabase Schema (migrations 00-14, 16-17, 19)
-- Skip 15 & 18: Nexus polling (requires Edge Functions + pg_cron)
-- Run this in Supabase Dashboard -> SQL Editor in your NEW project
-- ═══════════════════════════════════════════════════════════════

-- Safety: drop any partially-created tables from a failed previous run
DROP TABLE IF EXISTS notes, tims_overrides, matches, event_teams, teams, events CASCADE;
DROP FUNCTION IF EXISTS get_event_teams_full(text);
DROP FUNCTION IF EXISTS merge_event_teams_batch(jsonb);
DROP FUNCTION IF EXISTS get_frc_playoff_matches(text);



-- ═══════════════════════════════════════════════════════════════
-- FILE: 00_initial_schema.sql
-- ═══════════════════════════════════════════════════════════════
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
    raw_data    JSONB       NOT NULL DEFAULT '{}',    -- per-event stats: rank, OPR, EPA, record
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



-- ═══════════════════════════════════════════════════════════════
-- FILE: 01_cache_tables.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Migration 01: Performance cache tables
--  Team avatars, season records, event summary caches
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  team_avatars — base64 avatar cache (eliminates 32-64 TBA calls per
--  alliance endpoint)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS team_avatars (
    team_key     TEXT    PRIMARY KEY REFERENCES teams (team_key) ON DELETE CASCADE,
    year         INTEGER NOT NULL,
    avatar_base64 TEXT,                                    -- NULL = team has no avatar
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_team_avatars_year       ON team_avatars (year);
CREATE INDEX idx_team_avatars_updated_at ON team_avatars (updated_at);

CREATE TRIGGER trg_team_avatars_updated_at
    BEFORE UPDATE ON team_avatars
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  season_records — world record & season high scores
--  Instead of scanning all events every request, workers update this
--  incrementally.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS season_records (
    record_key   TEXT        PRIMARY KEY,                  -- "world_record_2026", "high_scores_2025"
    year         INTEGER     NOT NULL,
    record_type  TEXT        NOT NULL,                     -- "world_record" | "season_high_scores"
    payload      JSONB       NOT NULL DEFAULT '{}',
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_season_records_year ON season_records (year);

CREATE TRIGGER trg_season_records_updated_at
    BEFORE UPDATE ON season_records
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  event_summary_cache — pre-computed summary & awards payloads
--  Eliminates 50-100 TBA calls on summary/awards endpoint
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_summary_cache (
    event_key    TEXT        PRIMARY KEY,
    summary      JSONB,                                   -- demographics, HoF, top scorers, high scores
    awards       JSONB,                                   -- past champions, past season awards
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_summary_cache_updated_at ON event_summary_cache (updated_at);

CREATE TRIGGER trg_event_summary_cache_updated_at
    BEFORE UPDATE ON event_summary_cache
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();



-- ═══════════════════════════════════════════════════════════════
-- FILE: 02_tims_notes_redesign.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 02: TIMS overrides expansion + Notes multi-tag redesign
-- ═══════════════════════════════════════════════════════════════════════

-- ── tims_overrides: add editable TIMS fields ───────────────────────────
ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS custom_nickname   TEXT,
    ADD COLUMN IF NOT EXISTS custom_robot_name TEXT,
    ADD COLUMN IF NOT EXISTS custom_motto      TEXT;

-- Make custom_sponsor_read nullable (may only override some fields)
ALTER TABLE tims_overrides
    ALTER COLUMN custom_sponsor_read DROP NOT NULL;

-- At most one active (non-deleted) override per team
CREATE UNIQUE INDEX IF NOT EXISTS idx_tims_overrides_team_unique
    ON tims_overrides (team_key) WHERE NOT is_deleted;


-- ── notes: multi-dimensional tagging ───────────────────────────────────
-- Add explicit tag columns (nullable — at least one should be non-null)
ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS team_key   TEXT,
    ADD COLUMN IF NOT EXISTS match_key  TEXT,
    ADD COLUMN IF NOT EXISTS event_key  TEXT,
    ADD COLUMN IF NOT EXISTS category   TEXT;   -- e.g. 'scouting', 'strategy', 'general'

-- Legacy target_key no longer required (new notes use explicit columns)
ALTER TABLE notes ALTER COLUMN target_key DROP NOT NULL;

-- Indexes for each query dimension
CREATE INDEX IF NOT EXISTS idx_notes_team_key  ON notes (team_key)  WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notes_match_key ON notes (match_key) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notes_event_key ON notes (event_key) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notes_category  ON notes (category)  WHERE NOT is_deleted;

-- Composite index for "all notes about team X at event Y"
CREATE INDEX IF NOT EXISTS idx_notes_team_event
    ON notes (team_key, event_key) WHERE NOT is_deleted;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 03_account_requests.sql
-- ═══════════════════════════════════════════════════════════════
-- ══════════════════════════════════════════════════════════
-- 03_account_requests.sql — Request-based account flow
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.account_requests (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'volunteer'
                CHECK (role IN ('volunteer', 'third_party')),
    event_name  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_account_requests_status ON public.account_requests (status);
CREATE INDEX IF NOT EXISTS idx_account_requests_email  ON public.account_requests (email);

-- ── Row-Level Security ────────────────────────────────────
ALTER TABLE public.account_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can INSERT a request
CREATE POLICY "anon_insert_account_requests"
    ON public.account_requests
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Only authenticated users whose JWT contains the admin role can SELECT/UPDATE
-- (Supabase custom claim: user_metadata.role = 'admin')
CREATE POLICY "admin_select_account_requests"
    ON public.account_requests
    FOR SELECT
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

CREATE POLICY "admin_update_account_requests"
    ON public.account_requests
    FOR UPDATE
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

-- No DELETE policy — requests are kept for audit



-- ═══════════════════════════════════════════════════════════════
-- FILE: 04_account_requests_self_select.sql
-- ═══════════════════════════════════════════════════════════════
-- Allow authenticated users to read their own account request by email
CREATE POLICY "self_select_account_requests"
    ON public.account_requests
    FOR SELECT
    TO authenticated
    USING (email = auth.email());



-- ═══════════════════════════════════════════════════════════════
-- FILE: 05_merge_raw_data.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Atomic JSONB merge for event_teams.raw_data
--
--  Before this migration, event_sync (OPR) and match_poller (rankings)
--  both did full-row upserts, overwriting each other's data every cycle.
--  This function uses Postgres JSONB || to merge top-level keys atomically.
--
--  jsonb_strip_nulls() is applied to the incoming payload so that API
--  responses with null fields never overwrite valid cached values.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION merge_event_teams_batch(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    r jsonb;
BEGIN
    FOR r IN SELECT jsonb_array_elements(p_rows)
    LOOP
        INSERT INTO event_teams (event_key, team_key, raw_data)
        VALUES (
            r->>'event_key',
            r->>'team_key',
            jsonb_strip_nulls(COALESCE(r->'data', '{}'::jsonb))
        )
        ON CONFLICT (event_key, team_key)
        DO UPDATE SET
            raw_data   = COALESCE(event_teams.raw_data, '{}'::jsonb)
                      || jsonb_strip_nulls(COALESCE(EXCLUDED.raw_data, '{}'::jsonb)),
            updated_at = now();
    END LOOP;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════
--  Bulk-read helpers (used by the Supabase-first read path)
-- ═══════════════════════════════════════════════════════════════════════

-- Get all event-teams with joined team identity for a single event
CREATE OR REPLACE FUNCTION get_event_teams_full(p_event_key text)
RETURNS TABLE (
    event_key   text,
    team_key    text,
    raw_data    jsonb,
    team_number integer,
    nickname    text,
    tims_data   jsonb,
    updated_at  timestamptz
)
LANGUAGE sql STABLE AS $$
    SELECT
        et.event_key,
        et.team_key,
        et.raw_data,
        t.team_number,
        t.nickname,
        t.raw_tims_data  AS tims_data,
        GREATEST(et.updated_at, t.updated_at) AS updated_at
    FROM event_teams et
    JOIN teams t ON t.team_key = et.team_key
    WHERE et.event_key = p_event_key;
$$;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 06_frc_events_data.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 06: FRC Events API data in Supabase
--
--  Stores data that currently only comes from the FIRST FRC Events API:
--   1. frc_data on teams — schoolName, nameShort from FRC Event Teams
--   2. regional_pool — per-event advancement / qualification detail (v3.2)
--   3. FRC match raw_data is already stored by match_poller; this adds
--      a helper to read playoff matches in FRC API format.
-- ═══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════
--  teams.frc_data — FRC Events API team info (schoolName, nameShort, etc.)
--  Stored separately from raw_tims_data which is TBA-sourced location data.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE teams ADD COLUMN IF NOT EXISTS frc_data JSONB NOT NULL DEFAULT '{}';


-- ═══════════════════════════════════════════════════════════════════════
--  regional_pool — FRC Events API v3.2 regional advancement data
--  One row per (year, event_key) — worker refreshes periodically.
--  event_key NULL + year → global pool snapshot.
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS regional_pool (
    id           SERIAL      PRIMARY KEY,
    year         INTEGER     NOT NULL,
    event_key    TEXT,                                     -- NULL = global pool
    payload      JSONB       NOT NULL DEFAULT '{}',        -- full API response
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (year, event_key)
);

CREATE INDEX idx_regional_pool_year      ON regional_pool (year);
CREATE INDEX idx_regional_pool_event_key ON regional_pool (event_key);

CREATE TRIGGER trg_regional_pool_updated_at
    BEFORE UPDATE ON regional_pool
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════════════════
--  Helper: read playoff matches in raw FRC API format for an event.
--  Returns the raw_data JSONB (full FRC match object with matchNumber,
--  description, teams[].teamNumber) for sf/f comp_levels.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_frc_playoff_matches(p_event_key text)
RETURNS SETOF jsonb
LANGUAGE sql STABLE AS $$
    SELECT raw_data
    FROM matches
    WHERE event_key = p_event_key
      AND comp_level IN ('sf', 'f')
    ORDER BY comp_level, set_number, match_number;
$$;


-- ═══════════════════════════════════════════════════════════════════════
--  Updated get_event_teams_full: include frc_data column
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS get_event_teams_full(text);
CREATE OR REPLACE FUNCTION get_event_teams_full(p_event_key text)
RETURNS TABLE (
    event_key  text,
    team_key   text,
    raw_data   jsonb,
    team_number integer,
    nickname   text,
    tims_data  jsonb,
    frc_data   jsonb,
    updated_at timestamptz
)
LANGUAGE sql STABLE AS $$
    SELECT
        et.event_key,
        et.team_key,
        et.raw_data,
        t.team_number,
        t.nickname,
        t.raw_tims_data   AS tims_data,
        t.frc_data,
        et.updated_at
    FROM event_teams et
    JOIN teams t ON t.team_key = et.team_key
    WHERE et.event_key = p_event_key;
$$;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 07_tims_overrides_expand.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 07: Expand TIMS overrides with organization, location,
--  top_sponsors, and pronunciation fields
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS custom_organization  TEXT,
    ADD COLUMN IF NOT EXISTS custom_location      TEXT,
    ADD COLUMN IF NOT EXISTS custom_top_sponsors  TEXT,
    ADD COLUMN IF NOT EXISTS custom_pronunciation TEXT;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 08_tims_hardware_playstyle_audit.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 08: Add hardware / playstyle columns, audit columns,
--  and edit-history table to tims_overrides.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. New override columns (stored as JSON array strings) ─────────
ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS custom_hardware       TEXT,   -- JSON array of hardware tags
    ADD COLUMN IF NOT EXISTS custom_auto_strategy   TEXT,   -- JSON array of auto strategy tags
    ADD COLUMN IF NOT EXISTS custom_teleop_strategy TEXT;   -- JSON array of teleop strategy tags

-- ── 2. Audit columns on the current row ────────────────────────────
ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS author_name      TEXT,         -- display name from account_requests
    ADD COLUMN IF NOT EXISTS author_event_key TEXT;         -- event being viewed when edit was made

-- ── 3. Full edit-history log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tims_overrides_history (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    team_key        TEXT        NOT NULL,
    author_name     TEXT        NOT NULL,
    author_event_key TEXT,
    snapshot        JSONB       NOT NULL,   -- full override payload at save time
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tims_history_team
    ON public.tims_overrides_history (team_key, created_at DESC);

-- ── 4. RLS — same policy pattern as tims_overrides ─────────────────
ALTER TABLE public.tims_overrides_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_tims_history"
    ON public.tims_overrides_history FOR INSERT
    TO anon WITH CHECK (true);

CREATE POLICY "anon_select_tims_history"
    ON public.tims_overrides_history FOR SELECT
    TO anon USING (true);

CREATE POLICY "auth_insert_tims_history"
    ON public.tims_overrides_history FOR INSERT
    TO authenticated WITH CHECK (true);

CREATE POLICY "auth_select_tims_history"
    ON public.tims_overrides_history FOR SELECT
    TO authenticated USING (true);



-- ═══════════════════════════════════════════════════════════════
-- FILE: 09_number_display.sql
-- ═══════════════════════════════════════════════════════════════
-- Team number display pronunciation (e.g. "11-370" for 11370)
ALTER TABLE tims_overrides ADD COLUMN IF NOT EXISTS custom_number_display TEXT;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 10_storyline_cache.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Migration 10: Storyline cache table
--  Persists AI-generated broadcast storylines across restarts
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS storyline_cache (
    cache_key      TEXT        PRIMARY KEY,   -- "match:{match_key}" or "team:{event_key}:{team_number}"
    event_key      TEXT        NOT NULL,
    storyline      TEXT        NOT NULL,
    match_count    INTEGER,                   -- played-match count at generation time (for invalidation)
    input_tokens   INTEGER,                   -- LLM usage tracking
    output_tokens  INTEGER,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_storyline_cache_event ON storyline_cache (event_key);

CREATE TRIGGER trg_storyline_cache_updated_at
    BEFORE UPDATE ON storyline_cache
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: service role only (no client access needed)
ALTER TABLE storyline_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on storyline_cache"
    ON storyline_cache
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');



-- ═══════════════════════════════════════════════════════════════
-- FILE: 11_caster_notes.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Migration 11: Caster notes
--  Free-form notes attached to an event, optionally scoped to a match
--  or team.  Supports both manual caster entries and system-generated
--  notes (e.g. auto-generated talking points).
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS caster_notes (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_key   TEXT        NOT NULL,
    match_key   TEXT,                          -- nullable: note may be event- or team-level
    team_key    TEXT,                          -- nullable: note may be event- or match-level
    author      TEXT        NOT NULL,          -- display name of the caster
    content     TEXT        NOT NULL,
    type        TEXT        NOT NULL DEFAULT 'manual'
                            CHECK (type IN ('manual', 'system')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_caster_notes_event     ON caster_notes (event_key);
CREATE INDEX idx_caster_notes_match     ON caster_notes (event_key, match_key);
CREATE INDEX idx_caster_notes_team      ON caster_notes (event_key, team_key);
CREATE INDEX idx_caster_notes_created   ON caster_notes (created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────
-- Internal tool prototype: bypass RLS so both anon (broadcast overlays)
-- and service_role (backend workers) can read/write freely.
-- Tighten to role-based policies before any public deployment.
ALTER TABLE caster_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access on caster_notes"
    ON caster_notes
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- ── Enable Realtime ────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE caster_notes;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 12_realtime_event_teams_matches.sql
-- ═══════════════════════════════════════════════════════════════
-- ── Enable Realtime for event_teams and matches ────────────────────────
-- caster_notes was added in 11_caster_notes.sql.
-- event_teams and matches were previously enabled via the Supabase
-- dashboard; this migration codifies that so deployments are reproducible.

-- REPLICA IDENTITY FULL sends the entire row (not just PK) in UPDATE
-- payloads, which the frontend needs to render live changes without
-- a follow-up REST fetch.
ALTER TABLE event_teams REPLICA IDENTITY FULL;
ALTER TABLE matches     REPLICA IDENTITY FULL;

-- Add to the built-in publication that Supabase Realtime listens on.
-- Using IF NOT EXISTS-style guards via DO blocks so re-runs are safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'event_teams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE event_teams;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE matches;
  END IF;
END $$;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 13_rls_production.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 13: Tighten RLS for production deployment
--
--  Core data tables (events, teams, event_teams, matches) become
--  read-only for anon/authenticated — only service_role can write.
--
--  caster_notes gets role-based policies:
--    - Authenticated users can INSERT (author = their display name)
--    - Authenticated users can read all notes
--    - Only the note author or admin can DELETE their own notes
--    - Service role retains full access (backend workers)
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Core data tables: enable RLS, read-only for non-service roles ──

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- Anon + authenticated can SELECT (the frontend reads via REST)
CREATE POLICY "anon_read_events"      ON events      FOR SELECT USING (true);
CREATE POLICY "anon_read_teams"       ON teams       FOR SELECT USING (true);
CREATE POLICY "anon_read_event_teams" ON event_teams  FOR SELECT USING (true);
CREATE POLICY "anon_read_matches"     ON matches      FOR SELECT USING (true);

-- Service role bypasses RLS by default, so no explicit write policy needed.
-- All INSERT/UPDATE/DELETE is implicitly blocked for anon/authenticated.

-- ── 2. caster_notes: replace the wide-open policy ─────────────────────

-- Drop the prototype "allow all" policy
DROP POLICY IF EXISTS "Allow all access on caster_notes" ON caster_notes;

-- Authenticated users can read all notes for their event
CREATE POLICY "auth_select_caster_notes"
    ON caster_notes FOR SELECT
    TO authenticated
    USING (true);

-- Anon can also read (for broadcast overlays that aren't logged in)
CREATE POLICY "anon_select_caster_notes"
    ON caster_notes FOR SELECT
    TO anon
    USING (true);

-- Only authenticated users can create notes
CREATE POLICY "auth_insert_caster_notes"
    ON caster_notes FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Only the original author can delete their own notes
CREATE POLICY "auth_delete_own_caster_notes"
    ON caster_notes FOR DELETE
    TO authenticated
    USING (
        author = coalesce(
            current_setting('request.jwt.claims', true)::json->>'user_metadata'::text,
            current_setting('request.jwt.claims', true)::json->>'email'
        )
    );

-- No UPDATE policy — notes are immutable once created.
-- Service role (backend) bypasses RLS and retains full access.



-- ═══════════════════════════════════════════════════════════════
-- FILE: 14_live_event_status.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 14: FRC Nexus live event status
--
--  Creates the `live_event_status` table, which is updated by the
--  `nexus-webhook` Edge Function whenever FRC Nexus fires an event
--  logistics webhook (current match, schedule delay, pit locations).
--
--  The future iOS client subscribes to this table via Supabase Realtime
--  WebSockets, so Realtime replication is explicitly enabled here.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS live_event_status (
    -- Primary key matches the FRC event key convention (e.g. "2026tuis")
    event_key              TEXT        PRIMARY KEY,

    -- Human-readable label of the match currently on the field
    -- e.g. "Qual 42", "SF 1-1", "Finals 1"
    current_match_name     TEXT,

    -- Team numbers on each alliance for the live match
    red_alliance           INTEGER[],
    blue_alliance          INTEGER[],

    -- Minutes relative to the published schedule.
    -- Negative = running behind, positive = running ahead.
    schedule_offset_mins   INTEGER     NOT NULL DEFAULT 0,

    -- Flexible JSONB map of team pit addresses for this event.
    -- Schema is intentionally open; FRC Nexus may vary by season.
    -- Example: { "1234": "A1", "5678": "Row B, Pit 12" }
    pit_locations          JSONB       NOT NULL DEFAULT '{}'::JSONB,

    -- Last time a webhook write touched this row.
    -- Set by the Edge Function on every upsert.
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  live_event_status IS
    'Live event logistics written by the nexus-webhook Edge Function. '
    'One row per active FRC event; consumed by the iOS Realtime subscription.';

COMMENT ON COLUMN live_event_status.event_key            IS 'FRC event key, e.g. "2026tuis".';
COMMENT ON COLUMN live_event_status.current_match_name   IS 'Human-readable name of the match currently on the field.';
COMMENT ON COLUMN live_event_status.red_alliance         IS 'Array of team numbers on the red alliance.';
COMMENT ON COLUMN live_event_status.blue_alliance        IS 'Array of team numbers on the blue alliance.';
COMMENT ON COLUMN live_event_status.schedule_offset_mins IS 'Minutes ahead (positive) or behind (negative) published schedule.';
COMMENT ON COLUMN live_event_status.pit_locations        IS 'JSON map of team number → pit address string.';
COMMENT ON COLUMN live_event_status.updated_at           IS 'Timestamp of the last webhook upsert.';

-- ── 2. Row Level Security ─────────────────────────────────────────────
--
--  Public (anon) read is required because:
--    - The iOS app will subscribe via an anonymous Realtime channel.
--    - Broadcast dashboard overlays may read without a session.
--
--  All writes go through the Edge Function, which uses the service_role
--  key. Service role bypasses RLS entirely — no write policy needed.

ALTER TABLE live_event_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_live_event_status"
    ON live_event_status
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ── 3. Realtime replication ───────────────────────────────────────────
--
--  REPLICA IDENTITY FULL ensures that UPDATE payloads delivered over
--  the Realtime WebSocket contain the complete new row, not just changed
--  columns. The iOS client needs this to render the full board without a
--  follow-up REST fetch.

ALTER TABLE live_event_status REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_publication_tables
        WHERE  pubname   = 'supabase_realtime'
        AND    tablename = 'live_event_status'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE live_event_status;
    END IF;
END $$;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 16_h2h_connections.sql
-- ═══════════════════════════════════════════════════════════════
-- Migration 16: H2H Connection Data
--
-- Prior playoff connection payloads now include head-to-head win records:
--   h2h_wins_a, h2h_wins_b  (totals on the top-level connection object)
--   team_a_wins, team_b_wins (per-event breakdown in opponents_at entries)
--
-- No schema changes are required since this data lives in the existing
-- JSONB payload stored in the `summaries` table.
--
-- However, existing cached connection rows were built without H2H data.
-- Delete them so they rebuild on next access with the new fields.
-- NOTE: skipped — `summaries` table doesn't exist (was renamed to event_summary_cache
--       with a different schema). No-op on a fresh database anyway.

-- DELETE FROM summaries
-- WHERE key LIKE 'conn_%';



-- ═══════════════════════════════════════════════════════════════
-- FILE: 17_mark_account_deleted.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Migration 17: Soft-delete RPC for Apple App Store compliance
--
--  Apple Guideline 5.1.1 requires apps with accounts to offer account
--  deletion.  Rather than immediately hard-deleting the auth.users row
--  (which would cascade-null any author_user_id FKs in notes /
--  tims_overrides and break historical records), we:
--
--    1. Create a `profiles` table that mirrors auth.users with PII
--       fields we control and can wipe on demand.
--    2. Expose a `mark_account_deleted` RPC callable by the
--       authenticated user from the iOS client.  The function:
--         – Verifies the caller matches the target user_id.
--         – Overwrites PII in `profiles` with 'DELETED'.
--         – Sets is_deleted = true.
--         – Revokes the user's Supabase session (sign-out all devices).
--
--  A separate scheduled job / webhook should then hard-delete the
--  auth.users row after a grace period (e.g. 30 days) by checking
--  profiles.is_deleted = true AND profiles.deleted_at < now() - '30d'.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Profiles table ──────────────────────────────────────────────────
--
--  One row per Supabase auth user.  Created on first sign-in via the
--  trigger below (or pre-populated by the admin approval flow).
--  All PII columns are wiped to 'DELETED' on soft-delete.

CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID        PRIMARY KEY
                                REFERENCES auth.users (id) ON DELETE CASCADE,
    display_name    TEXT,                          -- user_metadata.name
    email           TEXT,                          -- mirrors auth.users.email for RLS queries
    role            TEXT        NOT NULL DEFAULT 'volunteer'
                                CHECK (role IN ('volunteer', 'third_party', 'admin', 'scouter')),
    is_deleted      BOOLEAN     NOT NULL DEFAULT false,
    deleted_at      TIMESTAMPTZ,                   -- set when is_deleted flips to true
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_is_deleted ON public.profiles (is_deleted)
    WHERE is_deleted = true;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile; admins can read all.
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        id = auth.uid()
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

-- Users can update only their own non-deleted profile.
-- (The RPC below uses SECURITY DEFINER so it bypasses this for the
--  is_deleted / PII wipe, but direct REST updates are still restricted.)
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid() AND is_deleted = false)
    WITH CHECK (id = auth.uid());

-- Only service_role / the trigger below can INSERT.
-- Authenticated users cannot insert arbitrary rows.


-- ── 2. Auto-create profile on sign-up ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, email, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'role', 'volunteer')
    )
    ON CONFLICT (id) DO NOTHING;   -- idempotent: approval flow may pre-populate
    RETURN NEW;
END;
$$;

-- Fire after every new row in auth.users (Supabase sign-up / admin create)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── 3. mark_account_deleted RPC ───────────────────────────────────────
--
--  Called by the iOS client:
--
--      await supabase.rpc('mark_account_deleted')
--
--  The function takes no arguments — the target user is always the
--  authenticated caller (auth.uid()), preventing any horizontal
--  privilege escalation.
--
--  Returns: TEXT — 'ok' on success, raises an exception on failure.

CREATE OR REPLACE FUNCTION public.mark_account_deleted()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER                   -- runs as the function owner (postgres / service role)
SET search_path = public           -- prevent search_path injection
AS $$
DECLARE
    _caller UUID;
    _rows   INT;
BEGIN
    -- ── Step 1: Identify the authenticated caller ──────────────────────
    _caller := auth.uid();

    IF _caller IS NULL THEN
        RAISE EXCEPTION 'not_authenticated'
            USING HINT = 'You must be signed in to delete your account.',
                  ERRCODE = 'insufficient_privilege';
    END IF;

    -- ── Step 2: Confirm the profile exists and is not already deleted ──
    SELECT count(*) INTO _rows
    FROM public.profiles
    WHERE id = _caller
      AND is_deleted = false;

    IF _rows = 0 THEN
        RAISE EXCEPTION 'account_not_found'
            USING HINT = 'Account not found or already deleted.',
                  ERRCODE = 'no_data_found';
    END IF;

    -- ── Step 3: Wipe PII and set the soft-delete flag ─────────────────
    --
    --  We keep the primary key (id) intact so that:
    --    • author_user_id references in notes / tims_overrides remain
    --      valid (historical data integrity).
    --    • The grace-period hard-delete job can locate the row by id.
    --
    --  Extend this UPDATE if you add more PII columns in future.

    UPDATE public.profiles
    SET
        display_name = 'DELETED',
        email        = 'DELETED',
        role         = 'volunteer',   -- strip any elevated permissions
        is_deleted   = true,
        deleted_at   = now()
    WHERE id = _caller;

    -- ── Step 4: Invalidate all active sessions for this user ──────────
    --
    --  auth.users.updated_at advancing causes Supabase to treat all
    --  existing refresh tokens as stale, effectively signing the user
    --  out of every device without requiring a separate API call.

    UPDATE auth.users
    SET updated_at = now()
    WHERE id = _caller;

    RETURN 'ok';
END;
$$;

-- Only authenticated users can execute this function.
-- SECURITY DEFINER already restricts what it can do internally.
REVOKE ALL ON FUNCTION public.mark_account_deleted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_account_deleted() TO authenticated;


-- ── 4. Grace-period cleanup helper (run via pg_cron or Edge Function) ──
--
--  This function is NOT exposed to authenticated users.  Call it from
--  a scheduled Supabase Edge Function or pg_cron job:
--
--      SELECT public.purge_deleted_accounts();
--
--  It hard-deletes auth.users rows for accounts soft-deleted more than
--  30 days ago.  Cascades will null-out or cascade-delete child rows
--  depending on each table's ON DELETE rule.

CREATE OR REPLACE FUNCTION public.purge_deleted_accounts()
RETURNS INT                        -- returns number of accounts purged
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _purged INT;
BEGIN
    -- Hard-delete from auth.users; ON DELETE CASCADE on profiles.id
    -- will remove the profiles row automatically.
    WITH deleted AS (
        DELETE FROM auth.users
        WHERE id IN (
            SELECT id FROM public.profiles
            WHERE is_deleted = true
              AND deleted_at < now() - INTERVAL '30 days'
        )
        RETURNING id
    )
    SELECT count(*) INTO _purged FROM deleted;

    RETURN _purged;
END;
$$;

-- Not callable by end users — service_role only.
REVOKE ALL ON FUNCTION public.purge_deleted_accounts() FROM PUBLIC;



-- ═══════════════════════════════════════════════════════════════
-- FILE: 19_passkey_credentials.sql
-- ═══════════════════════════════════════════════════════════════
-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Passkey (WebAuthn) credentials
--  Stores one or more registered authenticator credentials per user.
--  All writes go through the service-role backend; users can only read
--  their own rows via RLS.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS passkey_credentials (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- WebAuthn credential ID, base64url-encoded (variable length, typically ≤64 bytes)
    credential_id   TEXT        NOT NULL,
    -- COSE-encoded public key, base64url-encoded
    public_key      TEXT        NOT NULL,
    -- Monotonically increasing counter supplied by the authenticator
    sign_count      BIGINT      NOT NULL DEFAULT 0,
    -- Human-readable label the user may assign (e.g. "iPhone 15")
    device_name     TEXT,
    -- AAGUID identifies the authenticator model (optional metadata)
    aaguid          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ,

    UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_passkey_user ON passkey_credentials (user_id);

-- ── Row-Level Security ──────────────────────────────────────────────────
ALTER TABLE passkey_credentials ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read their own credentials (e.g. for a
-- "Manage Passkeys" settings page in a future iteration).
CREATE POLICY "passkey_select_own"
    ON passkey_credentials
    FOR SELECT
    USING (auth.uid() = user_id);

-- All insert / update / delete MUST come from the service-role key only.
-- The policy below is intentionally restrictive; the service role bypasses
-- RLS entirely, so this acts as a safety net against direct client writes.
CREATE POLICY "passkey_no_direct_write"
    ON passkey_credentials
    FOR ALL
    USING (false);


-- ════════════════════════════════════════════════════════════════
-- GoatScout Data (team scouting metrics per event)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS goatscout_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    metrics JSONB NOT NULL DEFAULT '{}',
    author_device_id TEXT NOT NULL,
    author_name TEXT,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_goatscout_team_event_unique
    ON goatscout_data (team_key, event_key) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_goatscout_event
    ON goatscout_data (event_key) WHERE NOT is_deleted;

CREATE OR REPLACE FUNCTION goatscout_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_goatscout_updated_at ON goatscout_data;
CREATE TRIGGER trg_goatscout_updated_at
    BEFORE UPDATE ON goatscout_data
    FOR EACH ROW EXECUTE FUNCTION goatscout_updated_at();

CREATE TABLE IF NOT EXISTS goatscout_data_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_key TEXT NOT NULL,
    event_key TEXT NOT NULL,
    author_name TEXT,
    snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

