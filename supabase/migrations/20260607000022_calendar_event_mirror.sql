-- CalendarEventMirror — backup record of events Chippi writes to the
-- realtor's connected external calendar (Google Calendar first, more
-- providers later).
--
-- Why a new table instead of extending the legacy CalendarEvent:
--   • Legacy `CalendarEvent` (date/time/color/description) still backs
--     check-availability, block-time, and propose-tour-times as a
--     busy-time signal. Those tools are not the Chippi calendar
--     surface (which is being deleted) — they're internal plumbing
--     for the on-demand agent. Keeping the legacy table avoids
--     breaking them and keeps the two concerns separate.
--   • This table is a write-side backup, not a queryable view. The
--     source of truth for events is the realtor's external calendar
--     (read on demand from Composio); this row is forensics — if the
--     realtor swaps providers later we know what we put there.
--
-- One row per event Chippi writes through to an external calendar.
-- Tour rows still live in Tour; a tour booking will land here AND on
-- Google Calendar AND in Tour. Three places, same event, by design:
-- Tour is the booking primitive (manage tokens, conflict checks),
-- external calendar is the realtor's truth, this row is the audit.

CREATE TABLE IF NOT EXISTS "CalendarEventMirror" (
  "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"          TEXT NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "externalProvider" TEXT NOT NULL,                  -- 'googlecalendar' | 'outlook_calendar' (future)
  "externalEventId"  TEXT,                           -- provider event id; nullable when write failed
  "title"            TEXT NOT NULL,
  "start"            TIMESTAMPTZ NOT NULL,
  "end"              TIMESTAMPTZ NOT NULL,
  "attendees"        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sourceTourId"     TEXT REFERENCES "Tour"(id) ON DELETE SET NULL,
                                                    -- when this row mirrors a tour booking
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"        TEXT NOT NULL DEFAULT 'agent'
                       CHECK ("createdBy" IN ('agent', 'realtor'))
);

-- Hot index — the on-demand calendar surface filters by (space, start window).
CREATE INDEX IF NOT EXISTS "CalendarEventMirror_space_start_idx"
  ON "CalendarEventMirror" ("spaceId", "start");

-- Lookup by external id when we need to dedupe a retry or cross-reference
-- a Composio webhook ("attendee responded to event X"). Partial — null
-- external ids would otherwise share an index page for failed writes.
CREATE INDEX IF NOT EXISTS "CalendarEventMirror_external_idx"
  ON "CalendarEventMirror" ("externalProvider", "externalEventId")
  WHERE "externalEventId" IS NOT NULL;

ALTER TABLE "CalendarEventMirror" ENABLE ROW LEVEL SECURITY;
