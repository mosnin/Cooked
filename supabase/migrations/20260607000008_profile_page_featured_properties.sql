-- ═══════════════════════════════════════════════════════════════════════════
-- ProfilePage.featuredPropertyIds — realtor-curated set + order for the
-- featured listings carousel on the public /p/[slug] page.
--
-- Before this column, /p/[slug] auto-pulled the 6 most-recently-updated
-- active listings. The realtor had no say. Now they pick the exact set and
-- the order — array order = render order on the public page.
--
-- Empty array (= the default) preserves legacy behaviour: the public-page
-- query falls back to the auto-top-6 logic so existing spaces aren't
-- disturbed by the migration. The PATCH cap is 12; render order is the
-- array's own order (we reorder in JS — Postgres `IN (...)` doesn't
-- preserve list order).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ProfilePage"
  ADD COLUMN IF NOT EXISTS "featuredPropertyIds" text[] NOT NULL DEFAULT '{}';
