-- Brief settings — per-space preference for the daily 7am brief.
--
-- Lives on SpaceSetting (one-to-one with Space) rather than its own
-- table because the brief is configured the same way notifications are:
-- one toggle, one schedule, one row per realtor.
--
-- briefEnabled   — opt out of the brief entirely. Defaults TRUE so
--                  existing realtors start receiving briefs when the
--                  feature ships; turn off to silence.
-- briefHour      — hour-of-day (0-23) in the space's timezone (existing
--                  SpaceSetting.timezone column) at which the brief
--                  should be generated. Defaults 7 — the canonical
--                  morning slot the design ships with.
--
-- B4 will layer briefEmail / briefSms toggles for delivery channels.

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "briefEnabled" boolean NOT NULL DEFAULT true;

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "briefHour" integer NOT NULL DEFAULT 7
    CHECK ("briefHour" >= 0 AND "briefHour" <= 23);

-- The cron at /api/cron/daily-briefing runs hourly and filters by
-- briefEnabled = true. No index — the filter is over the SpaceSetting
-- row which is already joined per-space.
