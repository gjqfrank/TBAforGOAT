-- ═══════════════════════════════════════════════════════════════════════
--  Migration 18: Fix Nexus cron job to read secret dynamically
--
--  Migration 15 hardcoded the literal string "<CRON_SECRET>" in the
--  pg_cron job's header. Since cron.job stores the SQL as a static
--  string, this value was sent verbatim on every invocation and never
--  matched the actual CRON_SECRET function secret, so every cron call
--  was silently rejected with 401 and no live_event_status rows were
--  ever written.
--
--  This migration reschedules the job so it reads the secret at
--  runtime via current_setting('app.settings.cron_secret', true),
--  which evaluates to whatever value was last set with:
--    ALTER DATABASE postgres SET app.settings.cron_secret TO '<secret>';
--
--  One-time setup (run once after applying this migration):
--
--    1. Generate a secret (or reuse the one already set as CRON_SECRET
--       function secret):
--         openssl rand -hex 32
--
--    2. Store it as a Supabase function secret (so the Edge Function
--       can read it via Deno.env.get("CRON_SECRET")):
--         supabase secrets set CRON_SECRET=<value>
--
--    3. Store the SAME value as a Postgres database setting (so
--       current_setting() in the cron job returns it):
--         supabase db query --linked \
--           "SELECT set_config('app.settings.cron_secret', '<value>', false);"
--
--       Or, to make it permanent across restarts:
--         ALTER DATABASE postgres SET app.settings.cron_secret TO '<value>';
-- ═══════════════════════════════════════════════════════════════════════

-- Remove the old (broken) job first.
SELECT cron.unschedule('sync-nexus-live')
WHERE  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-nexus-live');

-- Reschedule with dynamic secret resolution.
-- current_setting('app.settings.cron_secret', true) is evaluated at
-- job-execution time (not schedule time), so updating the DB setting
-- takes effect on the next cron tick without touching this SQL.
SELECT cron.schedule(
    'sync-nexus-live',
    '* * * * *',    -- every minute
    $job$
    SELECT net.http_post(
        url     := 'https://qytovurlcjrpvlbmkyip.supabase.co/functions/v1/sync-nexus-live',
        headers := jsonb_build_object(
                       'Content-Type',  'application/json',
                       'X-Cron-Secret', current_setting('app.settings.cron_secret', true)
                   ),
        body    := '{}'::jsonb
    );
    $job$
);
