-- ============================================================================
-- Pricing V2 — credit ledger (docs/PRICING_V2_PLAN.md §4.3).
--
-- CreditLot: an append-only grant/top-up that can expire; `remaining` is
--   decremented FIFO as credits are spent.
-- CreditTxn: every debit/refund, for audit + refund reversal.
-- Balance = Σ remaining over non-expired lots.
--
-- The spend/grant/refund run inside atomic functions with row locking so
-- concurrent debits can't double-spend a lot (same pattern as
-- book_tour_atomic / reorder_deal). The TS mirror of the FIFO rule
-- (lib/billing/credits.ts) is unit-tested so the algorithm stays in lockstep.
--
-- ✓ VALIDATED on PostgreSQL 16 (applies clean; grant/spend/refund exercised):
--    FIFO oldest-expiring-first debit, fail-closed on insufficient balance,
--    refund restores balance, refund is idempotent, expired lots excluded — all
--    confirmed against a real cluster. The FOR UPDATE row-locking serializes
--    concurrent spends; re-confirm under real staging load as a final check.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "CreditLot" (
  id            text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountType" text NOT NULL CHECK ("accountType" IN ('space', 'brokerage')),
  "accountId"   text NOT NULL,
  amount        integer NOT NULL CHECK (amount > 0),
  remaining     integer NOT NULL CHECK (remaining >= 0),
  reason        text NOT NULL,  -- monthly_grant | topup | free_signup | addon_user | migration
  "expiresAt"   timestamptz,    -- null = never expires (Free tier one-time grant)
  "createdAt"   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_creditlot_account ON "CreditLot" ("accountType", "accountId") WHERE remaining > 0;
CREATE INDEX IF NOT EXISTS idx_creditlot_expiry ON "CreditLot" ("expiresAt");

CREATE TABLE IF NOT EXISTS "CreditTxn" (
  id              text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "accountType"   text NOT NULL CHECK ("accountType" IN ('space', 'brokerage')),
  "accountId"     text NOT NULL,
  delta           integer NOT NULL,           -- negative = spend, positive = refund
  workflow        text NOT NULL,
  "spaceId"       text,                        -- which space actually spent (team breakdown)
  "userId"        text,
  reason          text,                        -- 'spend' | 'refund'
  "refundedTxnId" text,                        -- on a refund row, the debit it reverses
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { debits: [{ lotId, take }] }
  "createdAt"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credittxn_account ON "CreditTxn" ("accountType", "accountId", "createdAt" DESC);

ALTER TABLE "CreditLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditTxn" ENABLE ROW LEVEL SECURITY;

-- ── grant_credits: add a lot ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_credits(
  p_account_type text, p_account_id text, p_amount integer,
  p_reason text, p_expires_at timestamptz
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "CreditLot" ("accountType", "accountId", amount, remaining, reason, "expiresAt")
  VALUES (p_account_type, p_account_id, p_amount, p_amount, p_reason, p_expires_at);
$$;

-- ── spend_credits: atomic FIFO debit (oldest-expiring first, nulls last) ─────
CREATE OR REPLACE FUNCTION spend_credits(
  p_account_type text, p_account_id text, p_amount integer,
  p_workflow text, p_space_id text, p_user_id text, p_metadata jsonb
) RETURNS TABLE(ok boolean, balance integer, txn_id text)
LANGUAGE plpgsql AS $$
DECLARE
  v_need    integer := p_amount;
  v_take    integer;
  v_lot     RECORD;
  v_debits  jsonb := '[]'::jsonb;
  v_txn     text;
  v_balance integer;
BEGIN
  -- Lock the account's spendable lots so concurrent spends serialize.
  PERFORM 1 FROM "CreditLot"
   WHERE "accountType" = p_account_type AND "accountId" = p_account_id
     AND remaining > 0 AND ("expiresAt" IS NULL OR "expiresAt" > now())
   FOR UPDATE;

  SELECT COALESCE(SUM(remaining), 0) INTO v_balance FROM "CreditLot"
   WHERE "accountType" = p_account_type AND "accountId" = p_account_id
     AND remaining > 0 AND ("expiresAt" IS NULL OR "expiresAt" > now());

  IF v_balance < p_amount THEN
    RETURN QUERY SELECT false, v_balance, NULL::text;
    RETURN;
  END IF;

  FOR v_lot IN
    SELECT id, remaining FROM "CreditLot"
     WHERE "accountType" = p_account_type AND "accountId" = p_account_id
       AND remaining > 0 AND ("expiresAt" IS NULL OR "expiresAt" > now())
     ORDER BY ("expiresAt" IS NULL), "expiresAt" ASC, "createdAt" ASC
  LOOP
    EXIT WHEN v_need <= 0;
    v_take := LEAST(v_lot.remaining, v_need);
    UPDATE "CreditLot" SET remaining = remaining - v_take WHERE id = v_lot.id;
    v_debits := v_debits || jsonb_build_object('lotId', v_lot.id, 'take', v_take);
    v_need := v_need - v_take;
  END LOOP;

  INSERT INTO "CreditTxn" ("accountType", "accountId", delta, workflow, "spaceId", "userId", reason, metadata)
  VALUES (p_account_type, p_account_id, -p_amount, p_workflow, p_space_id, p_user_id, 'spend',
          jsonb_set(COALESCE(p_metadata, '{}'::jsonb), '{debits}', v_debits))
  RETURNING id INTO v_txn;

  RETURN QUERY SELECT true, (v_balance - p_amount), v_txn;
END;
$$;

-- ── refund_credit_txn: reverse a debit, idempotent per txn ───────────────────
CREATE OR REPLACE FUNCTION refund_credit_txn(p_txn_id text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_txn   RECORD;
  v_debit jsonb;
BEGIN
  SELECT * INTO v_txn FROM "CreditTxn" WHERE id = p_txn_id AND reason = 'spend' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM "CreditTxn" WHERE "refundedTxnId" = p_txn_id) THEN RETURN; END IF;

  FOR v_debit IN SELECT * FROM jsonb_array_elements(v_txn.metadata -> 'debits')
  LOOP
    UPDATE "CreditLot" SET remaining = remaining + (v_debit ->> 'take')::int
     WHERE id = v_debit ->> 'lotId';
  END LOOP;

  INSERT INTO "CreditTxn" ("accountType", "accountId", delta, workflow, "spaceId", "userId", reason, "refundedTxnId")
  VALUES (v_txn."accountType", v_txn."accountId", -v_txn.delta, v_txn.workflow, v_txn."spaceId", v_txn."userId", 'refund', p_txn_id);
END;
$$;
