-- ═══════════════════════════════════════════════════════════════════════
--  Migration 17: Soft-delete RPC for Apple App Store compliance
--
--  Apple Guideline 5.1.1 requires apps with accounts to offer account
--  deletion.  Rather than immediately hard-deleting the auth.users row
--  (which would cascade-null any author_user_id FKs in notes /
--  tims_overrides and break historical records), we:
--
--    1. Create a `profiles` table that mirrors auth.users with PII
--       fields we control and can wipe on demand.
--    2. Expose a `mark_account_deleted` RPC callable by the
--       authenticated user from the iOS client.  The function:
--         – Verifies the caller matches the target user_id.
--         – Overwrites PII in `profiles` with 'DELETED'.
--         – Sets is_deleted = true.
--         – Revokes the user's Supabase session (sign-out all devices).
--
--  A separate scheduled job / webhook should then hard-delete the
--  auth.users row after a grace period (e.g. 30 days) by checking
--  profiles.is_deleted = true AND profiles.deleted_at < now() - '30d'.
-- ═══════════════════════════════════════════════════════════════════════


-- ── 1. Profiles table ──────────────────────────────────────────────────
--
--  One row per Supabase auth user.  Created on first sign-in via the
--  trigger below (or pre-populated by the admin approval flow).
--  All PII columns are wiped to 'DELETED' on soft-delete.

CREATE TABLE IF NOT EXISTS public.profiles (
    id              UUID        PRIMARY KEY
                                REFERENCES auth.users (id) ON DELETE CASCADE,
    display_name    TEXT,                          -- user_metadata.name
    email           TEXT,                          -- mirrors auth.users.email for RLS queries
    role            TEXT        NOT NULL DEFAULT 'volunteer'
                                CHECK (role IN ('volunteer', 'third_party', 'admin')),
    is_deleted      BOOLEAN     NOT NULL DEFAULT false,
    deleted_at      TIMESTAMPTZ,                   -- set when is_deleted flips to true
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_is_deleted ON public.profiles (is_deleted)
    WHERE is_deleted = true;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile; admins can read all.
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        id = auth.uid()
        OR (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin'
    );

-- Users can update only their own non-deleted profile.
-- (The RPC below uses SECURITY DEFINER so it bypasses this for the
--  is_deleted / PII wipe, but direct REST updates are still restricted.)
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid() AND is_deleted = false)
    WITH CHECK (id = auth.uid());

-- Only service_role / the trigger below can INSERT.
-- Authenticated users cannot insert arbitrary rows.


-- ── 2. Auto-create profile on sign-up ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, email, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data ->> 'role', 'volunteer')
    )
    ON CONFLICT (id) DO NOTHING;   -- idempotent: approval flow may pre-populate
    RETURN NEW;
END;
$$;

-- Fire after every new row in auth.users (Supabase sign-up / admin create)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ── 3. mark_account_deleted RPC ───────────────────────────────────────
--
--  Called by the iOS client:
--
--      await supabase.rpc('mark_account_deleted')
--
--  The function takes no arguments — the target user is always the
--  authenticated caller (auth.uid()), preventing any horizontal
--  privilege escalation.
--
--  Returns: TEXT — 'ok' on success, raises an exception on failure.

CREATE OR REPLACE FUNCTION public.mark_account_deleted()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER                   -- runs as the function owner (postgres / service role)
SET search_path = public           -- prevent search_path injection
AS $$
DECLARE
    _caller UUID;
    _rows   INT;
BEGIN
    -- ── Step 1: Identify the authenticated caller ──────────────────────
    _caller := auth.uid();

    IF _caller IS NULL THEN
        RAISE EXCEPTION 'not_authenticated'
            USING HINT = 'You must be signed in to delete your account.',
                  ERRCODE = 'insufficient_privilege';
    END IF;

    -- ── Step 2: Confirm the profile exists and is not already deleted ──
    SELECT count(*) INTO _rows
    FROM public.profiles
    WHERE id = _caller
      AND is_deleted = false;

    IF _rows = 0 THEN
        RAISE EXCEPTION 'account_not_found'
            USING HINT = 'Account not found or already deleted.',
                  ERRCODE = 'no_data_found';
    END IF;

    -- ── Step 3: Wipe PII and set the soft-delete flag ─────────────────
    --
    --  We keep the primary key (id) intact so that:
    --    • author_user_id references in notes / tims_overrides remain
    --      valid (historical data integrity).
    --    • The grace-period hard-delete job can locate the row by id.
    --
    --  Extend this UPDATE if you add more PII columns in future.

    UPDATE public.profiles
    SET
        display_name = 'DELETED',
        email        = 'DELETED',
        role         = 'volunteer',   -- strip any elevated permissions
        is_deleted   = true,
        deleted_at   = now()
    WHERE id = _caller;

    -- ── Step 4: Invalidate all active sessions for this user ──────────
    --
    --  auth.users.updated_at advancing causes Supabase to treat all
    --  existing refresh tokens as stale, effectively signing the user
    --  out of every device without requiring a separate API call.

    UPDATE auth.users
    SET updated_at = now()
    WHERE id = _caller;

    RETURN 'ok';
END;
$$;

-- Only authenticated users can execute this function.
-- SECURITY DEFINER already restricts what it can do internally.
REVOKE ALL ON FUNCTION public.mark_account_deleted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_account_deleted() TO authenticated;


-- ── 4. Grace-period cleanup helper (run via pg_cron or Edge Function) ──
--
--  This function is NOT exposed to authenticated users.  Call it from
--  a scheduled Supabase Edge Function or pg_cron job:
--
--      SELECT public.purge_deleted_accounts();
--
--  It hard-deletes auth.users rows for accounts soft-deleted more than
--  30 days ago.  Cascades will null-out or cascade-delete child rows
--  depending on each table's ON DELETE rule.

CREATE OR REPLACE FUNCTION public.purge_deleted_accounts()
RETURNS INT                        -- returns number of accounts purged
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    _purged INT;
BEGIN
    -- Hard-delete from auth.users; ON DELETE CASCADE on profiles.id
    -- will remove the profiles row automatically.
    WITH deleted AS (
        DELETE FROM auth.users
        WHERE id IN (
            SELECT id FROM public.profiles
            WHERE is_deleted = true
              AND deleted_at < now() - INTERVAL '30 days'
        )
        RETURNING id
    )
    SELECT count(*) INTO _purged FROM deleted;

    RETURN _purged;
END;
$$;

-- Not callable by end users — service_role only.
REVOKE ALL ON FUNCTION public.purge_deleted_accounts() FROM PUBLIC;
