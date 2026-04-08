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
