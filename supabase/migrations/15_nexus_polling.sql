-- ═══════════════════════════════════════════════════════════════════════
--  Migration 15: Centralized Nexus polling via pg_cron + pg_net
--
--  Architecture:
--    pg_cron fires every 60 s → net.http_post → sync-nexus-live Edge Fn
--    Edge Fn auto-discovers active FRC events from the events table,
--    calls the Nexus REST API for each, and upserts live_event_status.
--    iOS clients subscribe to live_event_status via Supabase Realtime.
--
--  One-time setup (run after applying this migration, DO NOT commit):
--
--    1. Generate a random cron secret and push it to Supabase secrets:
--         supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
--
--    2. Copy the printed secret value, then store it as a DB setting
--       so pg_cron can pass it in the request header:
--         supabase db query --linked \
--           "ALTER DATABASE postgres SET app.settings.cron_secret TO '<secret>';"
--
--    3. Store your Nexus API key as a Supabase secret:
--         supabase secrets set NEXUS_API_KEY=<your-nexus-api-key>
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Extensions ─────────────────────────────────────────────────────
--
--  pg_cron  — runs scheduled SQL jobs inside Postgres.
--  pg_net   — sends async HTTP requests from inside Postgres.
--
--  Both are available on Supabase Pro and above. Enable them via the
--  Dashboard → Database → Extensions if the commands below fail.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- pg_cron requires the postgres role to have USAGE on the cron schema.
GRANT USAGE ON SCHEMA cron TO postgres;

-- pg_net stores pending requests; grant SELECT so the cron user can read
-- response status if needed.
GRANT SELECT ON net._http_response TO postgres;
GRANT SELECT ON net.http_request_queue TO postgres;

-- ── 2. Cron job: poll Nexus every 60 seconds ──────────────────────────
--
--  The Edge Function auto-discovers currently-active FRC events by
--  querying the `events` table (start_date <= today <= end_date).
--  No event key needs to be hardcoded here — the cron job is event-agnostic.
--
--  To poll a specific event (e.g. during testing), change the body to:
--    '{"eventKeys": ["2026tuis"]}'::jsonb
--
--  The `X-Cron-Secret` header is a shared secret that the Edge Function
--  verifies so only pg_cron can trigger it. The secret is stored here in
--  the cron.job command string (protected by Postgres access control;
--  only database-level admins can read cron.job) and also set as the
--  CRON_SECRET Supabase function secret via `supabase secrets set`.
--
--  IMPORTANT: Replace <CRON_SECRET> with the output of:
--    openssl rand -hex 32
--  Then set the same value as a Supabase function secret:
--    supabase secrets set CRON_SECRET=<value>
--  And set the Nexus API key:
--    supabase secrets set NEXUS_API_KEY=<your-nexus-api-key>
--
--  Unschedule first so this migration is safe to re-run.

SELECT cron.unschedule('sync-nexus-live')
WHERE  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-nexus-live');

SELECT cron.schedule(
    'sync-nexus-live',
    '* * * * *',    -- every minute
    $job$
    SELECT net.http_post(
        url     := 'https://qytovurlcjrpvlbmkyip.supabase.co/functions/v1/sync-nexus-live',
        headers := '{"Content-Type": "application/json", "X-Cron-Secret": "<CRON_SECRET>"}'::jsonb,
        body    := '{}'::jsonb
    );
    $job$
);
