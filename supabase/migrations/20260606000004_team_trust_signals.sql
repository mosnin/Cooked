-- Team-level trust signals: optional compliance slots set once by a
-- team admin and inherited by every linked space's /apply/b/[id] intake.
-- Per-space SpaceSetting values take a back seat to these when the intake
-- is served via the team variant — team policy beats per-agent
-- copy for legal text.
--
--   teamLicenseNumber       — team-level sales license #
--   teamComplianceNotice   — multi-line compliance statement
--   teamShowComplianceMark — render the compliance badge

ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "teamLicenseNumber" text,
  ADD COLUMN IF NOT EXISTS "teamComplianceNotice" text,
  ADD COLUMN IF NOT EXISTS "teamShowComplianceMark" boolean NOT NULL DEFAULT false;
