-- ══════════════════════════════════════════════════════════
-- 03_account_requests.sql — Request-based account flow
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.account_requests (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    role        TEXT NOT NULL DEFAULT 'volunteer'
                CHECK (role IN ('volunteer', 'third_party')),
    event_name  TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_account_requests_status ON public.account_requests (status);
CREATE INDEX IF NOT EXISTS idx_account_requests_email  ON public.account_requests (email);

-- ── Row-Level Security ────────────────────────────────────
ALTER TABLE public.account_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can INSERT a request
CREATE POLICY "anon_insert_account_requests"
    ON public.account_requests
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

-- Only authenticated users whose JWT contains the admin role can SELECT/UPDATE
-- (Supabase custom claim: user_metadata.role = 'admin')
CREATE POLICY "admin_select_account_requests"
    ON public.account_requests
    FOR SELECT
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

CREATE POLICY "admin_update_account_requests"
    ON public.account_requests
    FOR UPDATE
    TO authenticated
    USING (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    )
    WITH CHECK (
        (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

-- No DELETE policy — requests are kept for audit
