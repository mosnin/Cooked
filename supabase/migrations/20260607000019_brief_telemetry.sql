-- Brief telemetry foundation (Phase B5).
--
-- Two JSONB columns on Brief + one timestamp on SpaceSetting. That's
-- the entire surface to answer the three questions that matter:
--
--   1. Does enabling the brief reduce churn?
--      → cohort by SpaceSetting.briefEnabled × briefEnabledAt window
--      → outcome by existing subscription state. No new infra.
--
--   2. Which signal sources actually move realtors?
--      → cardTaps[].source × cardMeta[].source
--      → tap rate per source, computable in one SQL query.
--
--   3. Are confidence calibrations honest?
--      → cardMeta[].confidence (stamped at compose) × tapped?
--      → if (pipeline, review) at 0.95 taps 78% and (leads, call) at 0.72
--        taps 6%, the floor for (leads, call) is too low.
--
-- cardMeta is stamped ONCE at compose time and never updated. It mirrors
-- the order of payload.cards but carries reasoning we deliberately keep
-- server-side (confidence shouldn't leak to the UI contract).
--
-- cardTaps grows append-only on every 'acted' PATCH. Idempotent — the
-- API drops duplicates so the realtor tapping the same card twice
-- doesn't double-count.
--
-- briefEnabledAt enables the retention cohort split. Stamped on insert
-- and on UPDATE when the value flips true. Existing rows stay null
-- (we don't have their first-enable moment); the 60-day analysis
-- accepts the null cohort as "always enabled."

ALTER TABLE "Brief"
  ADD COLUMN IF NOT EXISTS "cardMeta" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "Brief"
  ADD COLUMN IF NOT EXISTS "cardTaps" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "briefEnabledAt" timestamptz;

-- Stamp the moment briefEnabled becomes true. The cron and the GET
-- path don't need this column, but the analytics module reads it as
-- the cohort-start signal.
CREATE OR REPLACE FUNCTION stamp_brief_enabled_at() RETURNS trigger AS $$
BEGIN
  IF NEW."briefEnabled" = true
     AND (OLD."briefEnabled" IS DISTINCT FROM NEW."briefEnabled" OR NEW."briefEnabledAt" IS NULL)
  THEN
    NEW."briefEnabledAt" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stamp_brief_enabled_at ON "SpaceSetting";
CREATE TRIGGER trg_stamp_brief_enabled_at
  BEFORE INSERT OR UPDATE OF "briefEnabled" ON "SpaceSetting"
  FOR EACH ROW EXECUTE FUNCTION stamp_brief_enabled_at();
