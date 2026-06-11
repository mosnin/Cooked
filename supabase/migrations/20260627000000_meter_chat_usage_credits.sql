-- ============================================================================
-- Model-aware credit metering for every agent/chat turn (realtor + brokerage).
--
-- A flat "1 credit per turn" can't hold margin: models cost wildly different
-- amounts (gpt-4o-mini ~$0.15/1M in vs Claude Opus $5/1M in, $25/1M out). This
-- charges credits proportional to each turn's ACTUAL token COGS, calibrated so a
-- plan's full monthly credit allotment still leaves >=60% gross margin.
--
-- Calibration (see /tmp margin proof + lib/plans.ts CREDIT_COGS_BUDGET_USD):
--   margin at full use = 1 - (monthlyCredits * COGS_per_credit) / planPrice.
--   Binding tier is the Team Plus add-on seat ($69 / 2000 credits) → max
--   $0.0138/credit for exactly 60%. We use $0.013 → >=62% on every tier, a
--   buffer for model-price-estimate / OpenRouter-markup error.
--   credits/turn = max(1, ceil(costUsd / 0.013)).
--
-- ONE trigger on ChatUsage covers EVERY path: realtor direct (direct-stream),
-- realtor agent in-process (sdk-chat-stream), broker direct (broker-direct), and
-- realtor+broker via Modal (agent/ledger.py) — they all INSERT one ChatUsage row
-- per turn with costUsd. No per-surface or Python code change can bypass it.
--
-- Self-gating rollout: it drains only EXISTING spendable lots (never negative),
-- so accounts with no credit grants yet are a no-op. Blocking a turn when out of
-- credits stays the app-layer gate (CREDITS_ENFORCED) — this migration does the
-- charging, not the refusing.
--
-- ✓ VALIDATED on PostgreSQL 16 — see PR for the transcript.
-- ============================================================================

-- Mirror of lib/billing/account.ts resolveBillingAccount: a space's spend funds
-- the brokerage pool only when the brokerage is on a team plan AND the space
-- owner is a verified member; otherwise the space's own balance.
CREATE OR REPLACE FUNCTION resolve_billing_account_for_space(p_space_id text)
RETURNS TABLE(account_type text, account_id text)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_space  RECORD;
  v_brk    RECORD;
  v_member text;
BEGIN
  SELECT id, plan, "brokerageId", "ownerId" INTO v_space FROM "Space" WHERE id = p_space_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_space."brokerageId" IS NOT NULL THEN
    SELECT id, plan INTO v_brk FROM "Brokerage" WHERE id = v_space."brokerageId";
    IF FOUND AND v_brk.plan IN ('team', 'team_plus') THEN
      SELECT "userId" INTO v_member FROM "BrokerageMembership"
        WHERE "brokerageId" = v_space."brokerageId" AND "userId" = v_space."ownerId" LIMIT 1;
      IF v_member IS NOT NULL THEN
        account_type := 'brokerage'; account_id := v_brk.id; RETURN NEXT; RETURN;
      END IF;
    END IF;
  END IF;

  account_type := 'space'; account_id := v_space.id; RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION charge_credits_for_chat_usage()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_credits integer;
  v_acct    RECORD;
  v_need    integer;
  v_lot     RECORD;
  v_take    integer;
  v_debited integer := 0;
BEGIN
  -- Model-aware cost -> credits. 0.013 USD COGS budget per credit (lib/plans.ts).
  v_credits := GREATEST(1, CEIL(COALESCE(NEW."costUsd", 0) / 0.013));

  SELECT account_type, account_id INTO v_acct
    FROM resolve_billing_account_for_space(NEW."spaceId");
  IF v_acct.account_id IS NULL THEN RETURN NEW; END IF;

  v_need := v_credits;
  -- FIFO drain over spendable lots, soonest-expiring first (nulls last) — mirrors
  -- spend_credits' ordering. Drains to AVAILABLE only (never negative): a turn
  -- that overshoots the balance leaves it at 0 and the app gate refuses the next
  -- one. No spendable lots → no-op (self-gating).
  FOR v_lot IN
    SELECT id, remaining FROM "CreditLot"
     WHERE "accountType" = v_acct.account_type
       AND "accountId"   = v_acct.account_id
       AND remaining > 0
       AND ("expiresAt" IS NULL OR "expiresAt" > now())
     ORDER BY ("expiresAt" IS NULL), "expiresAt" ASC, "createdAt" ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_need <= 0;
    v_take := LEAST(v_lot.remaining, v_need);
    UPDATE "CreditLot" SET remaining = remaining - v_take WHERE id = v_lot.id;
    v_need    := v_need - v_take;
    v_debited := v_debited + v_take;
  END LOOP;

  IF v_debited > 0 THEN
    INSERT INTO "CreditTxn" ("accountType", "accountId", delta, workflow, "spaceId", "userId", reason, metadata)
    VALUES (
      v_acct.account_type, v_acct.account_id, -v_debited, 'chat_turn', NEW."spaceId", NEW."userId", 'spend',
      jsonb_build_object(
        'chatUsageId', NEW.id, 'model', NEW.model, 'costUsd', NEW."costUsd",
        'creditsAssessed', v_credits, 'creditsDebited', v_debited
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_charge_credits_on_chat_usage ON "ChatUsage";
CREATE TRIGGER trg_charge_credits_on_chat_usage
  AFTER INSERT ON "ChatUsage"
  FOR EACH ROW EXECUTE FUNCTION charge_credits_for_chat_usage();
