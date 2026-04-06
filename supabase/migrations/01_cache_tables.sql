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
