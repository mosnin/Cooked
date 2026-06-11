-- ============================================================================
-- P3 SQL hardening (audit follow-up). Three independent, low-risk fixes that
-- close latent footguns without changing any application behavior.
--
-- 1. Pin search_path on the money RPCs (grant/spend/refund_credit_txn). Without
--    a fixed search_path, a caller-controlled search_path could shadow the
--    "CreditLot"/"CreditTxn" tables these functions reference unqualified. Our
--    callers are the trusted service role, so this is defense-in-depth, but it
--    also clears the Supabase `function_search_path_mutable` linter warning.
--
--    We use ALTER FUNCTION (not CREATE OR REPLACE) on purpose: the spend/refund
--    bodies are being changed on other in-flight branches (expired-lot refund
--    redirect, model-aware chat metering). ALTER attaches the setting to
--    whatever body wins the merge instead of duplicating — and re-declaring a
--    contested body here could clobber a real functional fix. Worst case if a
--    later unqualified CREATE OR REPLACE clears this setting, the function
--    simply reverts to today's (unpinned) behavior — never a money regression.
--    RECONCILIATION: the durable fix is for each function's own definition to
--    carry `SET search_path = public`; the in-flight credit-RPC branches should
--    add that clause when they redefine these functions.
--
-- 2. CHECK(0..100) on the commission-rate columns. Rates are stored as percent
--    (2.5 = 2.5%); nothing previously stopped a bad write from storing 9999,
--    which would silently blow up every derived commission amount. NULL stays
--    allowed (Deal.commissionRate is optional). CommissionSplit.percentOfGci
--    already had this guard — this brings the rest in line.
--
-- 3. Partial UNIQUE index on stripeSubscriptionId (Space + Brokerage). A Stripe
--    subscription must map to exactly one billing entity; two rows sharing one
--    subscription id would mean a webhook updates the wrong account. The index
--    is partial (WHERE NOT NULL) so the many rows without a subscription don't
--    collide. On Space it replaces the existing non-unique lookup index (the
--    unique one serves the same lookups).
--
-- ✓ VALIDATED on PostgreSQL 16 (applies clean; constraints + unique indexes
--    exercised against sample rows; ALTER FUNCTION confirmed to set proconfig).
-- ============================================================================

-- 1. ── pin search_path on the money RPCs ────────────────────────────────────
ALTER FUNCTION grant_credits(text, text, integer, text, timestamptz)
  SET search_path = public;
ALTER FUNCTION spend_credits(text, text, integer, text, text, text, jsonb)
  SET search_path = public;
ALTER FUNCTION refund_credit_txn(text)
  SET search_path = public;

-- 1b. ── pin search_path on the RLS identity function ─────────────────────────
-- current_user_internal_id() is SECURITY DEFINER (the identity linchpin of every
-- space-scoped RLS policy, including ChatUsage's) and references "User"
-- unqualified — the highest-value DEFINER function in the schema, same
-- function_search_path_mutable class as the RPCs above. auth.uid() is already
-- schema-qualified in its body, so public + pg_temp resolves it fully; pg_temp
-- last so a temp-table shadow of "User" can't win.
ALTER FUNCTION current_user_internal_id()
  SET search_path = public, pg_temp;

-- 2. ── commission-rate range guards (percent, 0..100; NULL allowed) ──────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Brokerage_defaultAgentRate_range') THEN
    ALTER TABLE "Brokerage" ADD CONSTRAINT "Brokerage_defaultAgentRate_range"
      CHECK ("defaultAgentRate" IS NULL OR ("defaultAgentRate" >= 0 AND "defaultAgentRate" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Brokerage_defaultBrokerRate_range') THEN
    ALTER TABLE "Brokerage" ADD CONSTRAINT "Brokerage_defaultBrokerRate_range"
      CHECK ("defaultBrokerRate" IS NULL OR ("defaultBrokerRate" >= 0 AND "defaultBrokerRate" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedger_agentRate_range') THEN
    ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_agentRate_range"
      CHECK ("agentRate" IS NULL OR ("agentRate" >= 0 AND "agentRate" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedger_brokerRate_range') THEN
    ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_brokerRate_range"
      CHECK ("brokerRate" IS NULL OR ("brokerRate" >= 0 AND "brokerRate" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionLedger_referralRate_range') THEN
    ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_referralRate_range"
      CHECK ("referralRate" IS NULL OR ("referralRate" >= 0 AND "referralRate" <= 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Deal_commissionRate_range') THEN
    ALTER TABLE "Deal" ADD CONSTRAINT "Deal_commissionRate_range"
      CHECK ("commissionRate" IS NULL OR ("commissionRate" >= 0 AND "commissionRate" <= 100));
  END IF;
END $$;

-- 3. ── one billing entity per Stripe subscription ───────────────────────────
DROP INDEX IF EXISTS idx_space_stripe_subscription;
CREATE UNIQUE INDEX IF NOT EXISTS uq_space_stripe_subscription
  ON "Space" ("stripeSubscriptionId")
  WHERE "stripeSubscriptionId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_brokerage_stripe_subscription
  ON "Brokerage" ("stripeSubscriptionId")
  WHERE "stripeSubscriptionId" IS NOT NULL;
