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
