-- Brief delivery (Phase B6) — opt-in email + SMS for the daily brief.
--
-- Two SpaceSetting toggles + dedup state on the Brief row. The cron
-- generates the brief, then fans out to enabled channels with an
-- atomic UPDATE-WHERE-NULL lock so concurrent ticks can't double-send.
--
-- briefEmail / briefSms       per-feature opt-ins, default OFF. The
--                              realtor turns them on themselves. Master
--                              `notifications` / `smsNotifications`
--                              toggles still gate — if master is off,
--                              the feature can't fire.
-- emailSentAt / smsSentAt     dedup locks. Set via atomic UPDATE
--                              ... WHERE ... IS NULL RETURNING — the
--                              row that gets the return value wins
--                              the race and sends.
-- emailMessageId / smsMessageId  Resend / Telnyx IDs for ops + audit.
-- briefDeliveryErrorCode      permanent-failure code (e.g.,
--                              'email_bounced', 'sms_no_phone',
--                              'sms_opt_out'). Tomorrow's brief reads
--                              this and surfaces a quiet "We couldn't
--                              reach your email yesterday" line.
-- unsubscribeToken            per-space opaque token for RFC 8058
--                              one-click unsubscribe links — no Clerk
--                              session required to flip briefEmail off.

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "briefEmail" boolean NOT NULL DEFAULT false;

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "briefSms" boolean NOT NULL DEFAULT false;

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "unsubscribeToken" text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex');

ALTER TABLE "Brief"
  ADD COLUMN IF NOT EXISTS "emailSentAt"            timestamptz,
  ADD COLUMN IF NOT EXISTS "smsSentAt"              timestamptz,
  ADD COLUMN IF NOT EXISTS "emailMessageId"         text,
  ADD COLUMN IF NOT EXISTS "smsMessageId"           text,
  ADD COLUMN IF NOT EXISTS "briefDeliveryErrorCode" text;

-- Backfill unsubscribeToken for existing SpaceSetting rows — the
-- DEFAULT only fires on new inserts. Without this, existing realtors
-- have a null token until they next update settings, which means
-- their first email's unsubscribe link would 404.
UPDATE "SpaceSetting"
SET "unsubscribeToken" = encode(gen_random_bytes(16), 'hex')
WHERE "unsubscribeToken" IS NULL;
