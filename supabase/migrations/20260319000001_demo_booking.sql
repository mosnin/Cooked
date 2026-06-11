-- Demo booking table for Calendly-style scheduling
CREATE TABLE IF NOT EXISTS "Demo" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "contactId"     text REFERENCES "Contact"(id) ON DELETE SET NULL,
  "guestName"     text NOT NULL,
  "guestEmail"    text NOT NULL,
  "guestPhone"    text,
  "propertyAddress" text,
  notes           text,
  "startsAt"      timestamptz NOT NULL,
  "endsAt"        timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show')),
  "googleEventId" text,
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demo_space_starts ON "Demo" ("spaceId", "startsAt" DESC);
CREATE INDEX IF NOT EXISTS idx_demo_contact      ON "Demo" ("contactId");
CREATE INDEX IF NOT EXISTS idx_demo_status       ON "Demo" (status);

-- Google Calendar OAuth tokens for the space owner
CREATE TABLE IF NOT EXISTS "GoogleCalendarToken" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"       text UNIQUE NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "accessToken"   text NOT NULL,
  "refreshToken"  text NOT NULL,
  "expiresAt"     timestamptz NOT NULL,
  "calendarId"    text NOT NULL DEFAULT 'primary',
  "createdAt"     timestamptz NOT NULL DEFAULT now(),
  "updatedAt"     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "Demo"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoogleCalendarToken"   ENABLE ROW LEVEL SECURITY;

-- Booking availability settings per space
ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "demoDuration"     integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "demoStartHour"    integer NOT NULL DEFAULT 9,
  ADD COLUMN IF NOT EXISTS "demoEndHour"      integer NOT NULL DEFAULT 17,
  ADD COLUMN IF NOT EXISTS "demoDaysAvailable" integer[] NOT NULL DEFAULT '{1,2,3,4,5}',
  ADD COLUMN IF NOT EXISTS "demoBookingPageTitle" text,
  ADD COLUMN IF NOT EXISTS "demoBookingPageIntro" text;
