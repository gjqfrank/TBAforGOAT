-- ══════════════════════════════════════════════════════════
-- 20_add_scouter_role.sql — Introduce the 'scouter' role
-- ══════════════════════════════════════════════════════════
--
-- A 'scouter' can view and edit the GoatScout tab (frontend check),
-- but does NOT get the broader admin privileges gated by RLS
-- (account_requests, profiles read-all, etc.).
--
-- The handle_new_user() trigger already reads role from
-- raw_user_meta_data, so no trigger change is needed — just expand
-- the CHECK constraint on profiles.role.

-- Drop the old CHECK and recreate with 'scouter' included.
ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IN ('volunteer', 'third_party', 'admin', 'scouter'));

-- ── Backfill existing profiles that may already carry a scouter role
--    but were blocked by the old constraint (defensive; usually 0 rows).
UPDATE public.profiles
SET role = 'volunteer'
WHERE role IS NULL;

-- NOTE: account_requests RLS stays admin-only (no change here).
-- The scouter role is intentionally NOT granted SELECT/UPDATE on
-- account_requests or profiles read-all — that's the whole point of
-- separating it from admin.
