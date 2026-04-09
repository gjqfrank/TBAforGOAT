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
