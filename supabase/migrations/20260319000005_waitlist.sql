-- Waitlist for fully-booked demo slots
CREATE TABLE IF NOT EXISTS "DemoWaitlist" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "propertyProfileId" text REFERENCES "DemoPropertyProfile"(id) ON DELETE SET NULL,
  "guestName"     text NOT NULL,
  "guestEmail"    text NOT NULL,
  "guestPhone"    text,
  "preferredDate" date NOT NULL,
  notes           text,
  status          text NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'notified', 'booked', 'expired')),
  "notifiedAt"    timestamptz,
  "expiresAt"     timestamptz,
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_space_date ON "DemoWaitlist" ("spaceId", "preferredDate");
CREATE INDEX IF NOT EXISTS idx_waitlist_status     ON "DemoWaitlist" (status);

ALTER TABLE "DemoWaitlist" ENABLE ROW LEVEL SECURITY;
