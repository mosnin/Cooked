-- Team-level trust signals: optional compliance slots set once by a
-- team admin and inherited by every linked space's /apply/b/[id] intake.
-- Per-space SpaceSetting values take a back seat to these when the intake
-- is served via the team variant — team policy beats per-agent
-- copy for legal text.
--
--   teamLicenseNumber       — team-level sales license #
--   teamFairHousingNotice   — multi-line Fair Housing statement
--   teamShowEqualHousingMark — render the Equal Housing Opportunity logo

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "teamLicenseNumber" text,
  ADD COLUMN IF NOT EXISTS "teamFairHousingNotice" text,
  ADD COLUMN IF NOT EXISTS "teamShowEqualHousingMark" boolean NOT NULL DEFAULT false;
