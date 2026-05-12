-- ═══════════════════════════════════════════════════════════════════════
--  Caster's Tool — Passkey (WebAuthn) credentials
--  Stores one or more registered authenticator credentials per user.
--  All writes go through the service-role backend; users can only read
--  their own rows via RLS.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS passkey_credentials (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- WebAuthn credential ID, base64url-encoded (variable length, typically ≤64 bytes)
    credential_id   TEXT        NOT NULL,
    -- COSE-encoded public key, base64url-encoded
    public_key      TEXT        NOT NULL,
    -- Monotonically increasing counter supplied by the authenticator
    sign_count      BIGINT      NOT NULL DEFAULT 0,
    -- Human-readable label the user may assign (e.g. "iPhone 15")
    device_name     TEXT,
    -- AAGUID identifies the authenticator model (optional metadata)
    aaguid          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at    TIMESTAMPTZ,

    UNIQUE (credential_id)
);

CREATE INDEX IF NOT EXISTS idx_passkey_user ON passkey_credentials (user_id);

-- ── Row-Level Security ──────────────────────────────────────────────────
ALTER TABLE passkey_credentials ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read their own credentials (e.g. for a
-- "Manage Passkeys" settings page in a future iteration).
CREATE POLICY "passkey_select_own"
    ON passkey_credentials
    FOR SELECT
    USING (auth.uid() = user_id);

-- All insert / update / delete MUST come from the service-role key only.
-- The policy below is intentionally restrictive; the service role bypasses
-- RLS entirely, so this acts as a safety net against direct client writes.
CREATE POLICY "passkey_no_direct_write"
    ON passkey_credentials
    FOR ALL
    USING (false);
