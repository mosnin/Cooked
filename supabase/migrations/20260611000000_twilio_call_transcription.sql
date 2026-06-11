-- Twilio calling + transcription — provider columns on the existing CallLog.
--
-- The call log (20260610000000_call_log.sql) was modeled around Telnyx Call
-- Control. Koala now places, records, and transcribes calls through Twilio, so
-- this migration extends CallLog with Twilio-native correlation + transcript
-- columns. The base table is reference material; we never edit it — we add here.
--
-- New columns:
--   twilioCallSid    — Twilio Call SID (CAxxxx…); the webhook correlates status,
--                      recording, and transcription callbacks back to the row.
--   recordingSid     — Twilio Recording SID (RExxxx…); lets us refetch/delete the
--                      recording later and de-dupe recording-status callbacks.
--   transcriptStatus — lifecycle of the transcript surfaced in the UI as a badge:
--                      'pending'   (recording landed, transcription in flight)
--                      'available' (transcript text present)
--                      'failed'    (transcription could not be produced)
--   (transcript text reuses the existing CallLog.transcript column.)
--
-- The legacy "telnyxCallId" column is retained (nullable, unused going forward)
-- so historical rows keep their correlation id; new Twilio rows populate
-- "twilioCallSid" instead. Both are indexed for webhook lookups.

ALTER TABLE "CallLog"
  ADD COLUMN IF NOT EXISTS "twilioCallSid"    TEXT,
  ADD COLUMN IF NOT EXISTS "recordingSid"     TEXT,
  ADD COLUMN IF NOT EXISTS "transcriptStatus" TEXT;

-- Constrain transcriptStatus to the known lifecycle states (NULL = no transcript
-- attempted yet). Added separately + guarded so re-running the migration is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CallLog_transcriptStatus_check'
  ) THEN
    ALTER TABLE "CallLog"
      ADD CONSTRAINT "CallLog_transcriptStatus_check"
      CHECK ("transcriptStatus" IN ('pending','available','failed'));
  END IF;
END $$;

-- The Twilio voice webhook correlates status/recording/transcription callbacks
-- back to the row by Call SID — index it the same way telnyxCallId was indexed.
CREATE INDEX IF NOT EXISTS "CallLog_twilioCallSid_idx"
  ON "CallLog" ("twilioCallSid");

-- Recording-status and transcription callbacks can arrive keyed by Recording
-- SID (e.g. a later transcription callback we attach to the recording); index
-- it so those lookups don't scan.
CREATE INDEX IF NOT EXISTS "CallLog_recordingSid_idx"
  ON "CallLog" ("recordingSid");
