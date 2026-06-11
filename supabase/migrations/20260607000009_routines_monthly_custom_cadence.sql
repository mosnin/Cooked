-- ═══════════════════════════════════════════════════════════════════════════
-- Routine — add 'monthly' + 'custom' cadences.
--
-- Monthly fires once a month on a chosen day-of-month (1-28; capped at 28 so
-- the run never has to skip Feb 29/30/31). Custom fires on a multi-select
-- list of weekdays — "Mondays and Thursdays", "every Tue/Thu/Sat", etc.
--
-- Two new columns. Both nullable because they're cadence-specific: a routine
-- only ever populates one of them (matching its cadence) and the others stay
-- null. The CHECK on "cadence" widens to include the new values.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "Routine"
  ADD COLUMN IF NOT EXISTS "dayOfMonth" integer
    CHECK ("dayOfMonth" IS NULL OR ("dayOfMonth" BETWEEN 1 AND 28));

ALTER TABLE "Routine"
  ADD COLUMN IF NOT EXISTS "daysOfWeek" text[]
    CHECK (
      "daysOfWeek" IS NULL
      OR (
        array_length("daysOfWeek", 1) > 0
        AND "daysOfWeek" <@ ARRAY['mon','tue','wed','thu','fri','sat','sun']::text[]
      )
    );

-- Widen the cadence check to include 'monthly' and 'custom'.
ALTER TABLE "Routine" DROP CONSTRAINT IF EXISTS "Routine_cadence_check";
ALTER TABLE "Routine"
  ADD CONSTRAINT "Routine_cadence_check"
  CHECK ("cadence" IN ('hourly', 'daily', 'weekdays', 'monthly', 'custom'));

-- Cadence ↔ field consistency:
--   monthly  → dayOfMonth NOT NULL, daysOfWeek NULL
--   custom   → daysOfWeek NOT NULL, dayOfMonth NULL
--   other    → both NULL
ALTER TABLE "Routine" DROP CONSTRAINT IF EXISTS "Routine_cadence_fields_check";
ALTER TABLE "Routine"
  ADD CONSTRAINT "Routine_cadence_fields_check"
  CHECK (
    ("cadence" = 'monthly' AND "dayOfMonth" IS NOT NULL AND "daysOfWeek" IS NULL)
    OR ("cadence" = 'custom' AND "daysOfWeek" IS NOT NULL AND "dayOfMonth" IS NULL)
    OR (
      "cadence" IN ('hourly', 'daily', 'weekdays')
      AND "dayOfMonth" IS NULL
      AND "daysOfWeek" IS NULL
    )
  );

-- Update the scheduling math. Pure deterministic function — given inputs, the
-- next time the routine should fire strictly after p_from.
CREATE OR REPLACE FUNCTION routine_next_run_at(
  p_cadence      text,
  p_hour         integer,
  p_from         timestamptz,
  p_day_of_month integer DEFAULT NULL,
  p_days_of_week text[] DEFAULT NULL
) RETURNS timestamptz AS $$
DECLARE
  candidate timestamptz;
  target_dow integer;
  i integer;
  -- JS-style: Sun=0, Mon=1, …, Sat=6. Postgres extract(dow) returns the same.
  dow_map jsonb := '{"sun":0,"mon":1,"tue":2,"wed":3,"thu":4,"fri":5,"sat":6}'::jsonb;
BEGIN
  -- hourly: the next top of the hour.
  IF p_cadence = 'hourly' THEN
    RETURN date_trunc('hour', p_from) + interval '1 hour';
  END IF;

  -- daily / weekdays / monthly / custom — they all want the next p_hour:00 UTC
  -- strictly after p_from, then optionally roll forward to land on a valid day.
  candidate := date_trunc('day', p_from) + make_interval(hours => p_hour);
  IF candidate <= p_from THEN
    candidate := candidate + interval '1 day';
  END IF;

  IF p_cadence = 'weekdays' THEN
    WHILE extract(dow FROM candidate) IN (0, 6) LOOP
      candidate := candidate + interval '1 day';
    END LOOP;
    RETURN candidate;
  END IF;

  IF p_cadence = 'monthly' THEN
    -- Walk forward day-by-day until we hit the chosen day-of-month. At most
    -- 31 iterations; cheap and correct across month boundaries.
    FOR i IN 1..62 LOOP
      EXIT WHEN extract(day FROM candidate) = p_day_of_month;
      candidate := candidate + interval '1 day';
    END LOOP;
    RETURN candidate;
  END IF;

  IF p_cadence = 'custom' THEN
    -- Walk forward day-by-day until the candidate's dow matches one of the
    -- selected days. At most 7 iterations.
    FOR i IN 1..7 LOOP
      target_dow := extract(dow FROM candidate)::integer;
      EXIT WHEN EXISTS (
        SELECT 1
        FROM unnest(p_days_of_week) AS d
        WHERE (dow_map ->> d)::integer = target_dow
      );
      candidate := candidate + interval '1 day';
    END LOOP;
    RETURN candidate;
  END IF;

  -- daily (default)
  RETURN candidate;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- The trigger reads the row's new fields.
CREATE OR REPLACE FUNCTION routine_set_next_run() RETURNS trigger AS $$
BEGIN
  NEW."nextRunAt" := routine_next_run_at(
    NEW."cadence",
    NEW."hour",
    now(),
    NEW."dayOfMonth",
    NEW."daysOfWeek"
  );
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger itself doesn't need to be re-created — DROP TRIGGER + CREATE
-- TRIGGER was already idempotent in the original migration and the trigger
-- binding to routine_set_next_run() picks up the new function body.
