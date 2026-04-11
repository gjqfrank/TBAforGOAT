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
