-- Migration 16: H2H Connection Data
--
-- Prior playoff connection payloads now include head-to-head win records:
--   h2h_wins_a, h2h_wins_b  (totals on the top-level connection object)
--   team_a_wins, team_b_wins (per-event breakdown in opponents_at entries)
--
-- No schema changes are required since this data lives in the existing
-- JSONB payload stored in the `summaries` table.
--
-- However, existing cached connection rows were built without H2H data.
-- Delete them so they rebuild on next access with the new fields.

DELETE FROM summaries
WHERE key LIKE 'conn_%';
