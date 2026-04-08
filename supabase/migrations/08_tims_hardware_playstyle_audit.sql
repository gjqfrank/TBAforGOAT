-- ═══════════════════════════════════════════════════════════════════════
--  Migration 08: Add hardware / playstyle columns, audit columns,
--  and edit-history table to tims_overrides.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. New override columns (stored as JSON array strings) ─────────
ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS custom_hardware       TEXT,   -- JSON array of hardware tags
    ADD COLUMN IF NOT EXISTS custom_auto_strategy   TEXT,   -- JSON array of auto strategy tags
    ADD COLUMN IF NOT EXISTS custom_teleop_strategy TEXT;   -- JSON array of teleop strategy tags

-- ── 2. Audit columns on the current row ────────────────────────────
ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS author_name      TEXT,         -- display name from account_requests
    ADD COLUMN IF NOT EXISTS author_event_key TEXT;         -- event being viewed when edit was made

-- ── 3. Full edit-history log ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tims_overrides_history (
    id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
    team_key        TEXT        NOT NULL,
    author_name     TEXT        NOT NULL,
    author_event_key TEXT,
    snapshot        JSONB       NOT NULL,   -- full override payload at save time
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tims_history_team
    ON public.tims_overrides_history (team_key, created_at DESC);

-- ── 4. RLS — same policy pattern as tims_overrides ─────────────────
ALTER TABLE public.tims_overrides_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_tims_history"
    ON public.tims_overrides_history FOR INSERT
    TO anon WITH CHECK (true);

CREATE POLICY "anon_select_tims_history"
    ON public.tims_overrides_history FOR SELECT
    TO anon USING (true);

CREATE POLICY "auth_insert_tims_history"
    ON public.tims_overrides_history FOR INSERT
    TO authenticated WITH CHECK (true);

CREATE POLICY "auth_select_tims_history"
    ON public.tims_overrides_history FOR SELECT
    TO authenticated USING (true);
