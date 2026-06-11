-- Intake trust signals: optional rep-supplied compliance slots that
-- render in the public intake chat footer. Koala provides the rendering
-- slot; the rep/team supplies the actual legal text — we never
-- inject legal copy on their behalf.
--
--   intakeLicenseNumber       — professional license or certification # (e.g. "TX-SALES-12345")
--   intakeFairHousingNotice   — team-supplied sales compliance statement, e.g. TCPA
--                               (plain text, multi-line supported via
--                               whitespace-pre-line on render).
--   intakeShowEqualHousingMark — when true, render the standard compliance
--                                logo SVG (repurposable per team's industry).

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "intakeLicenseNumber" text,
  ADD COLUMN IF NOT EXISTS "intakeFairHousingNotice" text,
  ADD COLUMN IF NOT EXISTS "intakeShowEqualHousingMark" boolean NOT NULL DEFAULT false;
