-- ═══════════════════════════════════════════════════════════════════════════
-- SpaceSetting.isVerified — a small blue checkmark next to the realtor's
-- name on the public /p/[slug] page. The realtor toggles this themselves
-- in the profile-page editor; default false so no app crash if the column
-- doesn't exist yet (the page render and the editor both treat null/false
-- the same way).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "isVerified" boolean NOT NULL DEFAULT false;
