-- ═══════════════════════════════════════════════════════════════════════════
-- ProfilePage.profilePhotoUrl — the realtor's face on the public /p/[slug]
-- page. Distinct from SpaceSetting.realtorPhotoUrl (used in the dashboard
-- chrome / intake form / booking page) so the realtor can pick a
-- public-facing portrait without disturbing the photo their dashboard +
-- internal forms display.
--
-- Stored as a Wasabi object KEY (signed on read, same contract as
-- coverPhotoUrl). Nullable — when null, the public page falls back to
-- the existing chain: realtorPhotoUrl → User.avatar → Clerk imageUrl.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ProfilePage"
  ADD COLUMN IF NOT EXISTS "profilePhotoUrl" text;
