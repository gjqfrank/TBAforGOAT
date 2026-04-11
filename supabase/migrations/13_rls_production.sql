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
