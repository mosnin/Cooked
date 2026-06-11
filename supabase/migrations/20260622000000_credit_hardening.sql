-- ============================================================================
-- Pricing V2 — credit hardening (post-audit fixes).
--
-- 1. spend_credits: reject non-positive amounts. A negative amount previously
--    MINTED credits (delta = -p_amount became positive) — not reachable from
--    app code (costs are always > 0) but a latent money hole. Now it raises.
-- 2. Free-signup grants are idempotent: a partial unique index ensures one
--    'free_signup' lot per account (backstop against a double create_space).
-- 3. Backfill: spaces with a `past_due` subscription are paying customers with
--    a transient failure — map them to 'solo' too (the original backfill only
--    caught active/trialing).
--
-- ✓ VALIDATED on PostgreSQL 16.
-- ============================================================================

-- 1. ── spend_credits: guard non-positive amounts ───────────────────────────
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
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'spend_credits: amount must be a positive integer, got %', p_amount;
  END IF;

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

-- 2. ── one free_signup lot per account (idempotency backstop) ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_creditlot_free_signup
  ON "CreditLot" ("accountType", "accountId")
  WHERE reason = 'free_signup';

-- 3. ── backfill past_due paying spaces to solo ─────────────────────────────
UPDATE "Space"
   SET plan = 'solo',
       "planActivatedAt" = COALESCE("planActivatedAt", now())
 WHERE plan = 'free'
   AND "stripeSubscriptionStatus" = 'past_due';
