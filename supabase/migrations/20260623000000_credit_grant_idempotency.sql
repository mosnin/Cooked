-- ============================================================================
-- Pricing V2 — credit grant idempotency (audit blocker #1).
--
-- Problem: `grant_credits` was a bare INSERT with no idempotency key. The only
-- thing stopping a retried Stripe webhook from double-granting was a best-effort
-- Redis event-id dedupe that fails OPEN (returns null when Upstash is unset or
-- unreachable). So a Stripe retry storm or a Redis blip would re-grant a full
-- month of credits (or a top-up) every time. Free-signup already had a DB
-- backstop (uq_creditlot_free_signup); monthly_grant and topup did not.
--
-- Fix: give every grant an optional `sourceId` (the Stripe invoice id for a
-- monthly grant, the checkout session id for a top-up) and a partial unique
-- index on (reason, sourceId). `grant_credits` now ON CONFLICT DO NOTHING on
-- that index, so a given Stripe object can mint at most one lot — retries are
-- no-ops at the database level, not the cache level. Grants with a NULL
-- sourceId (manual admin, migration, addon_user) are excluded from the index
-- and behave exactly as before.
--
-- ✓ VALIDATED on PostgreSQL 16: duplicate sourceId is a no-op, distinct
--   sourceId grants stack, NULL sourceId always inserts, free_signup still
--   blocked by its own index. See the PR for the exercise transcript.
-- ============================================================================

ALTER TABLE "CreditLot" ADD COLUMN IF NOT EXISTS "sourceId" text;

-- One lot per (reason, sourceId). Partial so NULL-source grants (manual/migration)
-- are unconstrained, exactly as before.
CREATE UNIQUE INDEX IF NOT EXISTS uq_creditlot_source
  ON "CreditLot" (reason, "sourceId")
  WHERE "sourceId" IS NOT NULL;

-- Adding a parameter creates a NEW overload rather than replacing the function,
-- which makes PostgREST calls ambiguous ("function is not unique"). Drop the old
-- 5-arg signature first, then create the 6-arg version. The new p_source_id has
-- a DEFAULT so existing 5-named-arg callers keep resolving to this one function.
DROP FUNCTION IF EXISTS grant_credits(text, text, integer, text, timestamptz);

CREATE OR REPLACE FUNCTION grant_credits(
  p_account_type text, p_account_id text, p_amount integer,
  p_reason text, p_expires_at timestamptz, p_source_id text DEFAULT NULL
) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO "CreditLot" ("accountType", "accountId", amount, remaining, reason, "expiresAt", "sourceId")
  VALUES (p_account_type, p_account_id, p_amount, p_amount, p_reason, p_expires_at, p_source_id)
  ON CONFLICT (reason, "sourceId") WHERE "sourceId" IS NOT NULL DO NOTHING;
$$;
