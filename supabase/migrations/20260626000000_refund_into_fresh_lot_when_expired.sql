-- ============================================================================
-- refund_credit_txn: don't refund credits into an expired/deleted lot.
--
-- The original refund replayed each debit with a blind
--   UPDATE "CreditLot" SET remaining = remaining + take WHERE id = lotId
-- on the ORIGINAL lot, with no check that the lot is still spendable. If that
-- lot expired (or was deleted) between the spend and the refund — e.g. a refund
-- that fires across a monthly-grant expiry boundary — the credits land in a
-- dead lot and are silently lost to the user (balance reads exclude expired
-- lots). Verified on PG16: balance 0 -> spend -> (lot expires) -> refund ->
-- still 0.
--
-- Fix: return credits to the original lot ONLY while it exists and is unexpired;
-- otherwise re-grant the refunded amount into a fresh 30-day lot so it stays
-- spendable. Still idempotent per txn (the existing refund-exists guard), so a
-- retried refund can't double-credit.
--
-- ✓ VALIDATED on PG16 — see PR for the exercise transcript.
-- ============================================================================

CREATE OR REPLACE FUNCTION refund_credit_txn(p_txn_id text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_txn     RECORD;
  v_debit   jsonb;
  v_updated int;
BEGIN
  SELECT * INTO v_txn FROM "CreditTxn" WHERE id = p_txn_id AND reason = 'spend' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM "CreditTxn" WHERE "refundedTxnId" = p_txn_id) THEN RETURN; END IF;

  FOR v_debit IN SELECT * FROM jsonb_array_elements(v_txn.metadata -> 'debits')
  LOOP
    -- Return to the original lot only while it's still spendable.
    UPDATE "CreditLot"
       SET remaining = remaining + (v_debit ->> 'take')::int
     WHERE id = v_debit ->> 'lotId'
       AND ("expiresAt" IS NULL OR "expiresAt" > now());
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
      -- Original lot expired/gone: re-grant into a fresh 30-day lot so the
      -- refunded credits don't vanish into a dead lot.
      INSERT INTO "CreditLot" ("accountType", "accountId", amount, remaining, reason, "expiresAt")
      VALUES (v_txn."accountType", v_txn."accountId",
              (v_debit ->> 'take')::int, (v_debit ->> 'take')::int,
              'refund', now() + interval '30 days');
    END IF;
  END LOOP;

  INSERT INTO "CreditTxn" ("accountType", "accountId", delta, workflow, "spaceId", "userId", reason, "refundedTxnId")
  VALUES (v_txn."accountType", v_txn."accountId", -v_txn.delta, v_txn.workflow, v_txn."spaceId", v_txn."userId", 'refund', p_txn_id);
END;
$$;
