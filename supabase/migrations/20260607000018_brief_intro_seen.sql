-- briefIntroSeenAt — the realtor's first-ever brief carries a one-line
-- introduction (gated on this column being null). Stamped server-side
-- the moment the brief's 'seen' PATCH fires for a space that has never
-- been seen before. Once stamped, the intro never reappears.
--
-- Nullable so existing realtors who got briefs before this column was
-- added skip the intro (they already know what the brief is).
-- Backfilling them to NOW() at migration time would be wrong — better
-- to leave NULL and let the next 'seen' PATCH stamp them, which means
-- they get one intro line on their next brief. Tradeoff: one cosmetic
-- intro line for ~existing realtors~ to avoid backfill complexity.

ALTER TABLE "SpaceSetting"
  ADD COLUMN IF NOT EXISTS "briefIntroSeenAt" timestamptz;
