-- ═══════════════════════════════════════════════════════════════════════════
-- ProfilePage.profilePhotoUrl — the rep's face on the public /p/[slug]
-- page. Distinct from SpaceSetting.repPhotoUrl (used in the dashboard
-- chrome / intake form / booking page) so the rep can pick a
-- public-facing portrait without disturbing the photo their dashboard +
-- internal forms display.
--
-- Stored as a Wasabi object KEY (signed on read, same contract as
-- coverPhotoUrl). Nullable — when null, the public page falls back to
-- the existing chain: repPhotoUrl → User.avatar → Clerk imageUrl.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ProfilePage"
  ADD COLUMN IF NOT EXISTS "profilePhotoUrl" text;
