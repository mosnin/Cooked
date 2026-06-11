-- Support tickets — a realtor submits a help request from inside the app; it
-- lands in the admin dashboard where an admin triages it.
--
-- spaceId / userId link the ticket to the submitting realtor's workspace and
-- Clerk user. email + name are denormalized so the admin sees the submitter
-- without a join. RLS is enabled but no policies are added — every read/write
-- goes through the server with the service-role key (same posture as the
-- client-portal and affiliate tables), so the table is closed to anon/auth
-- roles by default.

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "spaceId"    TEXT,
  "userId"     TEXT        NOT NULL,
  "email"      TEXT        NOT NULL,
  "name"       TEXT,
  "subject"    TEXT        NOT NULL,
  "message"    TEXT        NOT NULL,
  "category"   TEXT        NOT NULL DEFAULT 'other'
    CHECK ("category" IN ('bug','question','billing','feature','other')),
  "status"     TEXT        NOT NULL DEFAULT 'open'
    CHECK ("status" IN ('open','in_progress','resolved','closed')),
  "priority"   TEXT        NOT NULL DEFAULT 'normal'
    CHECK ("priority" IN ('low','normal','high')),
  "adminNote"  TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportTicket_spaceId_fkey"
    FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE SET NULL
);

-- Admin triage view filters by status and reads newest-first.
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx"
  ON "SupportTicket" ("status");
CREATE INDEX IF NOT EXISTS "SupportTicket_createdAt_idx"
  ON "SupportTicket" ("createdAt" DESC);

-- Realtor "my tickets" view filters by the submitting user, newest-first.
CREATE INDEX IF NOT EXISTS "SupportTicket_userId_idx"
  ON "SupportTicket" ("userId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "SupportTicket_spaceId_idx"
  ON "SupportTicket" ("spaceId");

ALTER TABLE "SupportTicket" ENABLE ROW LEVEL SECURITY;
