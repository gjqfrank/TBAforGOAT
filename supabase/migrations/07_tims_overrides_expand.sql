-- ═══════════════════════════════════════════════════════════════════════
--  Migration 07: Expand TIMS overrides with organization, location,
--  top_sponsors, and pronunciation fields
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE tims_overrides
    ADD COLUMN IF NOT EXISTS custom_organization  TEXT,
    ADD COLUMN IF NOT EXISTS custom_location      TEXT,
    ADD COLUMN IF NOT EXISTS custom_top_sponsors  TEXT,
    ADD COLUMN IF NOT EXISTS custom_pronunciation TEXT;
