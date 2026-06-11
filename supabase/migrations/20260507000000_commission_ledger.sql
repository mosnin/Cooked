-- ============================================================================
-- Commission Ledger: team-scoped commission rows on won deals
-- ============================================================================
-- Why this exists
--   Before this migration, manager payouts were computed on the fly in memory
--   from Deal.value * Deal.commissionRate whenever a dashboard was rendered.
--   That worked for a "what's GCI looking like this month" glance, but left
--   managers with no month-end artifact: nothing to reconcile against bank
--   deposits, nothing to hand to bookkeeping, nothing that survived a rate
--   change or a deal edit. The CommissionLedger is that artifact — one row
--   per won deal, amounts frozen at close time, statuses the API can move
--   from 'pending' to 'paid' or 'void' as money actually moves.
--
-- Trigger points (see sync_commission_ledger below)
--   * AFTER INSERT ON "Deal" FOR EACH ROW           WHEN NEW.status = 'won'
--   * AFTER UPDATE OF status ON "Deal" FOR EACH ROW WHEN OLD.status IS DISTINCT
--                                                        FROM NEW.status
--                                                    AND NEW.status = 'won'
--   Both fire the same plpgsql function, which resolves the deal's Space to
--   a teamId + ownerId, snapshots the team's current default rates,
--   and inserts one ledger row. Deals in non-team workspaces
--   (Space.teamId IS NULL) are silently skipped — solo agents don't
--   need a ledger.
--
-- Snapshot semantics (important for the API / UI agents)
--   Rates live on Team as defaults, but every ledger row captures its
--   own agentRate / managerRate / referralRate at write time. Changing a
--   team's default rates tomorrow does NOT retroactively alter any
--   historical ledger row's amounts. Re-computation is an explicit decision
--   (edit the row, or void + re-insert) — never a side effect of a rate
--   bump. This is the whole point of having a ledger in the first place.
--
-- Idempotency
--   UNIQUE ("dealId") + ON CONFLICT DO NOTHING means status can flip
--   won -> active -> won -> lost -> won and the ledger never duplicates.
--   First transition into 'won' wins; later transitions are no-ops. If a
--   manager genuinely needs to recalculate, the API should void the existing
--   row (status='void') and insert a replacement manually.
-- ============================================================================


-----------------------------------------------------------------------
-- 1. Default rate columns on Team
-----------------------------------------------------------------------
-- Units are percent. 2.5 means 2.5% of deal value goes to the agent,
-- 0.5% to the house. Existing teams pick up the defaults harmlessly;
-- the UI exposes overrides in team settings.
ALTER TABLE "Team"
  ADD COLUMN IF NOT EXISTS "defaultAgentRate"  numeric(5,2) NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS "defaultManagerRate" numeric(5,2) NOT NULL DEFAULT 0.5;


-----------------------------------------------------------------------
-- 2. CommissionLedger table
-----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "CommissionLedger" (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "teamId"     text NOT NULL REFERENCES "Team"(id) ON DELETE CASCADE,
  "agentUserId"     text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "dealId"          text NOT NULL REFERENCES "Deal"(id) ON DELETE CASCADE,
  "closedAt"        timestamptz NOT NULL,
  "dealValue"       numeric(12,2) NOT NULL,
  "agentRate"       numeric(5,2) NOT NULL,
  "managerRate"      numeric(5,2) NOT NULL,
  "referralRate"    numeric(5,2) NOT NULL DEFAULT 0,
  "referralUserId"  text REFERENCES "User"(id) ON DELETE SET NULL,
  "agentAmount"     numeric(12,2) NOT NULL,
  "managerAmount"    numeric(12,2) NOT NULL,
  "referralAmount"  numeric(12,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','void')),
  "payoutAt"        timestamptz,
  notes             text,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "updatedAt"       timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("dealId")
);

CREATE INDEX IF NOT EXISTS idx_commission_team
  ON "CommissionLedger" ("teamId", "closedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_commission_agent
  ON "CommissionLedger" ("agentUserId", "closedAt" DESC);
CREATE INDEX IF NOT EXISTS idx_commission_status
  ON "CommissionLedger" (status);


-----------------------------------------------------------------------
-- 3. sync_commission_ledger + triggers on Deal
-----------------------------------------------------------------------
-- SECURITY DEFINER so the trigger succeeds regardless of which RLS
-- policies apply to the Deal writer. The function only ever reads
-- Space / Team and writes CommissionLedger, and its ON CONFLICT
-- shape makes replays safe, so running it elevated is bounded.
CREATE OR REPLACE FUNCTION sync_commission_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id   text;
  v_owner_id       text;
  v_agent_rate     numeric(5,2);
  v_manager_rate    numeric(5,2);
  v_deal_value     numeric(12,2);
BEGIN
  ---------------------------------------------------------------------
  -- Resolve the deal's Space. A deal in a non-team workspace
  -- (teamId IS NULL) gets no ledger row — solo agents opted out.
  ---------------------------------------------------------------------
  SELECT s."teamId", s."ownerId"
    INTO v_team_id, v_owner_id
    FROM "Space" s
   WHERE s.id = NEW."spaceId";

  IF v_team_id IS NULL THEN
    RETURN NEW;
  END IF;

  ---------------------------------------------------------------------
  -- Snapshot the team's current default rates. The ledger row
  -- keeps these forever; future rate edits don't mutate history.
  ---------------------------------------------------------------------
  SELECT b."defaultAgentRate", b."defaultManagerRate"
    INTO v_agent_rate, v_manager_rate
    FROM "Team" b
   WHERE b.id = v_team_id;

  IF v_agent_rate IS NULL OR v_manager_rate IS NULL THEN
    -- Team row missing or rates NULL (shouldn't happen with the
    -- NOT NULL defaults above, but fail closed rather than insert
    -- garbage).
    RETURN NEW;
  END IF;

  v_deal_value := COALESCE(NEW.value, 0);

  ---------------------------------------------------------------------
  -- Insert. UNIQUE (dealId) + ON CONFLICT DO NOTHING means
  -- re-entering 'won' is a no-op after the first transition.
  ---------------------------------------------------------------------
  INSERT INTO "CommissionLedger" (
    "teamId",
    "agentUserId",
    "dealId",
    "closedAt",
    "dealValue",
    "agentRate",
    "managerRate",
    "referralRate",
    "agentAmount",
    "managerAmount",
    "referralAmount",
    status
  ) VALUES (
    v_team_id,
    v_owner_id,
    NEW.id,
    now(),
    v_deal_value,
    v_agent_rate,
    v_manager_rate,
    0,
    ROUND((v_deal_value * v_agent_rate  / 100)::numeric, 2),
    ROUND((v_deal_value * v_manager_rate / 100)::numeric, 2),
    0,
    'pending'
  )
  ON CONFLICT ("dealId") DO NOTHING;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_commission_ledger()
  TO authenticated, service_role;

-- Triggers. Drop first for idempotency — CREATE TRIGGER has no IF NOT EXISTS
-- until PG 14, and we want this migration to replay cleanly on older shards.
DROP TRIGGER IF EXISTS trg_deal_won_insert ON "Deal";
CREATE TRIGGER trg_deal_won_insert
  AFTER INSERT ON "Deal"
  FOR EACH ROW
  WHEN (NEW.status = 'won')
  EXECUTE FUNCTION sync_commission_ledger();

DROP TRIGGER IF EXISTS trg_deal_won_update ON "Deal";
CREATE TRIGGER trg_deal_won_update
  AFTER UPDATE OF status ON "Deal"
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'won')
  EXECUTE FUNCTION sync_commission_ledger();


-----------------------------------------------------------------------
-- 4. Backfill: one ledger row for every pre-existing won deal in a
--    team-linked space that doesn't already have one.
-----------------------------------------------------------------------
-- Same amount math as the trigger. closedAt for the backfill is the
-- deal's own updatedAt when available, else now() — historical
-- closings predate this feature so there's no truthful close timestamp
-- to recover. WHERE NOT EXISTS (...) keeps the migration idempotent
-- even if the trigger has already fired for some rows.
INSERT INTO "CommissionLedger" (
  "teamId",
  "agentUserId",
  "dealId",
  "closedAt",
  "dealValue",
  "agentRate",
  "managerRate",
  "referralRate",
  "agentAmount",
  "managerAmount",
  "referralAmount",
  status
)
SELECT
  s."teamId",
  s."ownerId",
  d.id,
  COALESCE(d."updatedAt", now()),
  COALESCE(d.value, 0),
  b."defaultAgentRate",
  b."defaultManagerRate",
  0,
  ROUND((COALESCE(d.value, 0) * b."defaultAgentRate"  / 100)::numeric, 2),
  ROUND((COALESCE(d.value, 0) * b."defaultManagerRate" / 100)::numeric, 2),
  0,
  'pending'
  FROM "Deal" d
  JOIN "Space"     s ON s.id = d."spaceId"
  JOIN "Team" b ON b.id = s."teamId"
 WHERE d.status = 'won'
   AND s."teamId" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "CommissionLedger" cl WHERE cl."dealId" = d.id
   );


-----------------------------------------------------------------------
-- 5. RLS on CommissionLedger
-----------------------------------------------------------------------
-- Service role bypasses RLS by convention. No public policies are
-- defined: the API layer is the only legitimate reader/writer and it
-- performs manager-scope authorization before touching this table.
ALTER TABLE "CommissionLedger" ENABLE ROW LEVEL SECURITY;
