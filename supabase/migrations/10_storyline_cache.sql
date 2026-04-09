-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Migration 10: Storyline cache table
--  Persists AI-generated broadcast storylines across restarts
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS storyline_cache (
    cache_key    TEXT        PRIMARY KEY,   -- "match:{match_key}" or "team:{event_key}:{team_number}"
    event_key    TEXT        NOT NULL,
    storyline    TEXT        NOT NULL,
    match_count  INTEGER,                   -- played-match count at generation time (for invalidation)
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_storyline_cache_event ON storyline_cache (event_key);

-- RLS: service role only (no client access needed)
ALTER TABLE storyline_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on storyline_cache"
    ON storyline_cache
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
