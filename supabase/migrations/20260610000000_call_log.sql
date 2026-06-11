-- Call log — a realtor clicks "Call" on a contact; Chippi places the call via
-- Telnyx Voice (Call Control), records it, transcribes it, and summarizes it.
-- Each placed call gets one CallLog row that the webhook progressively fills in
-- as the call moves through its lifecycle (initiated → answered → completed) and
-- the recording lands (recordingUrl + transcript + summary).
--
-- spaceId links the call to the realtor's workspace; contactId is nullable so a
-- realtor can dial a raw number that isn't yet a contact. telnyxCallId is the
-- Telnyx call_control_id used to correlate inbound webhook events back to the
-- row. RLS is enabled but no policies are added — every read/write goes through
-- the server with the service-role key (same posture as SupportTicket and the
-- client-portal tables), so the table is closed to anon/auth roles by default.

CREATE TABLE IF NOT EXISTS "CallLog" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"      TEXT        NOT NULL,
  "contactId"    TEXT,
  "direction"    TEXT        NOT NULL DEFAULT 'outbound'
    CHECK ("direction" IN ('outbound','inbound')),
  "fromNumber"   TEXT        NOT NULL,
  "toNumber"     TEXT        NOT NULL,
  "telnyxCallId" TEXT,
  "status"       TEXT        NOT NULL DEFAULT 'initiated'
    CHECK ("status" IN ('initiated','ringing','answered','completed','failed','no_answer')),
  "recordingUrl" TEXT,
  "transcript"   TEXT,
  "summary"      TEXT,
  "durationSec"  INTEGER,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CallLog_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE
);

-- Calls-log surface lists a space's calls newest-first.
CREATE INDEX IF NOT EXISTS "CallLog_spaceId_createdAt_idx"
  ON "CallLog" ("spaceId", "createdAt" DESC);

-- Contact timeline reads a single contact's calls newest-first.
CREATE INDEX IF NOT EXISTS "CallLog_contactId_createdAt_idx"
  ON "CallLog" ("contactId", "createdAt" DESC);

-- The webhook correlates Telnyx events back to the row by call_control_id.
CREATE INDEX IF NOT EXISTS "CallLog_telnyxCallId_idx"
  ON "CallLog" ("telnyxCallId");

ALTER TABLE "CallLog" ENABLE ROW LEVEL SECURITY;
