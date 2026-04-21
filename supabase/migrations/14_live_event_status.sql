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
