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
