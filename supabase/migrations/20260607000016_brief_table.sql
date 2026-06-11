-- Brief — the daily 7am snapshot Chippi generates per realtor.
--
-- One row per Space per UTC day. The cron at /api/cron/daily-briefing
-- compiles a Brief from the realtor's pipeline + leads + calendar
-- signal sources, picks the top 3-5 cards by (urgency, -confidence),
-- and persists the rendered Brief here so the workspace can read it
-- without recomputing.
--
-- Shape we write today:
--
--   { headline: string,                — one sentence, picks the loudest signal
--     subheadline: string | null,      — optional second sentence
--     cards: BriefCard[],              — 0-5 actionable cards
--     momentum: string | null,         — "Yesterday: 4 sends, 2 opens, 1 reply."
--     tomorrow: string | null,         — "Tomorrow: Riverside closes. 3 follow-ups due."
--     emptyState: { invitation: string } | null,  — when no signals beat the floor
--     sourcesUsed: string[]            — which signal sources contributed
--   }
--
-- BriefCard shape (mirrors lib/briefing/types.ts Signal):
--
--   { kind: 'reply' | 'call' | 'prep' | 'review' | 'sign' | 'celebrate',
--     subject: { id, name, href },
--     evidence: string,
--     draftedAction: { kind, payload } | null }
--
-- `status` lifecycle:
--   'pending'    — generated, not yet seen
--   'seen'       — realtor opened it; tracked for momentum-line analytics
--   'acted'      — at least one card got a tap-through
--   'failed'     — generation errored; the surface falls back to MorningSummary

CREATE TABLE IF NOT EXISTS "Brief" (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"    text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "forDate"    date NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  payload      jsonb NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now(),
  "seenAt"     timestamptz,
  "actedAt"    timestamptz
);

-- One Brief per Space per day. Re-running the cron is idempotent;
-- regenerating before the realtor sees it would UPSERT not INSERT.
CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_space_date
  ON "Brief" ("spaceId", "forDate");

-- The workspace GET reads "today's Brief for this space" — index covers it.
CREATE INDEX IF NOT EXISTS idx_brief_space_date_created
  ON "Brief" ("spaceId", "forDate" DESC, "createdAt" DESC);
