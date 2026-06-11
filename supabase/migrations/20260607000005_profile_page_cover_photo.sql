-- ═══════════════════════════════════════════════════════════════════════════
-- ProfilePage.coverPhotoUrl — the realtor's hero image at the top of their
-- public /p/[slug] page. When set, it replaces the stretched profile photo
-- as the page's full-bleed header; the profile photo becomes a small round
-- avatar centered just below it. Nullable — when null, the page falls back
-- to the realtor's profile photo (the old behavior).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ProfilePage"
  ADD COLUMN IF NOT EXISTS "coverPhotoUrl" text;
