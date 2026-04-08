-- Team number display pronunciation (e.g. "11-370" for 11370)
ALTER TABLE tims_overrides ADD COLUMN IF NOT EXISTS custom_number_display TEXT;
