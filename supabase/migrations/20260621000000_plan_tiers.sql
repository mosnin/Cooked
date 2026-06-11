-- ============================================================================
-- Pricing V2 Phase 0 — per-account plan tiers (docs/PRICING_V2_PLAN.md §4.2).
--
-- Adds the Space-level plan tier (free|solo|pro) and extends the Brokerage plan
-- enum with the new team tiers (team|team_plus) alongside the legacy values so
-- existing rows stay valid. Backfills existing paying solo spaces to 'solo'.
--
-- ✓ VALIDATED on PostgreSQL 16 (applies clean against Space/Brokerage; CHECK
--   swaps + backfill confirmed).
-- ============================================================================

-- ── Space: free|solo|pro ────────────────────────────────────────────────────
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free';
ALTER TABLE "Space" ADD COLUMN IF NOT EXISTS "planActivatedAt" timestamptz;

-- Backfill: a space with a live Stripe subscription is the current $97 Solo
-- plan → map it to the new Solo tier (clean 1:1; see migration decision §3).
UPDATE "Space"
   SET plan = 'solo',
       "planActivatedAt" = COALESCE("planActivatedAt", now())
 WHERE plan = 'free'
   AND "stripeSubscriptionStatus" IN ('active', 'trialing');

-- Constraint added AFTER the backfill so existing rows can't trip it.
ALTER TABLE "Space" DROP CONSTRAINT IF EXISTS "Space_plan_check";
ALTER TABLE "Space" ADD CONSTRAINT "Space_plan_check" CHECK (plan IN ('free', 'solo', 'pro'));

-- ── Brokerage: extend plan enum with team|team_plus ─────────────────────────
-- Drop whatever CHECK currently constrains Brokerage.plan (name may vary), then
-- re-add a superset so legacy (starter|team|enterprise) AND the new team_plus
-- are all valid. No data migration needed; mapping to the new tiers happens at
-- checkout time.
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c
    FROM pg_constraint
   WHERE conrelid = '"Brokerage"'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%plan%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "Brokerage" DROP CONSTRAINT %I', c);
  END IF;
END $$;

ALTER TABLE "Brokerage" ADD COLUMN IF NOT EXISTS "planActivatedAt" timestamptz;
ALTER TABLE "Brokerage"
  ADD CONSTRAINT "Brokerage_plan_check"
  CHECK (plan IN ('starter', 'team', 'team_plus', 'enterprise'));
