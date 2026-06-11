-- Brief tips engine (Phase C) — cool-down tracking.
--
-- A tip is a Signal subclass with kind='tip'. The composer picks at most
-- one per brief. Cool-downs prevent the same tip from firing every
-- morning until the realtor either acts on it or it falls out of
-- relevance.
--
-- BriefTipHistory captures every (category, subject) tip that fires,
-- with the outcome. Outcomes drive cool-down windows:
--
--   shown     — rendered to the realtor. Default cool-down: 7 days
--               (14 for trends, 30 for segments — per-category override).
--   acted     — realtor tapped the tip. Cool-down kills naturally — if
--               the trigger re-fires, the tip can show again.
--   dismissed — (future) explicit dismiss action. 60-day silence on
--               that subject+category pair.
--
-- Subjects can be null for trend tips (no named contact / deal).

CREATE TABLE IF NOT EXISTS "BriefTipHistory" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "spaceId"     text NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "tipCategory" text NOT NULL,
  "subjectId"   text,
  "firedAt"     timestamptz NOT NULL DEFAULT now(),
  outcome       text NOT NULL DEFAULT 'shown'
                  CHECK (outcome IN ('shown', 'acted', 'dismissed'))
);

-- Fast cool-down lookup: "did we fire this (category, subject) recently?"
CREATE INDEX IF NOT EXISTS idx_brieftip_space_cat_subject_fired
  ON "BriefTipHistory" ("spaceId", "tipCategory", "subjectId", "firedAt" DESC);
