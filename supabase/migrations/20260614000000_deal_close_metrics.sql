-- ============================================================================
-- Deal close + stage-change metrics foundation.
--
-- Adds the two timestamps the broker/realtor performance metrics depend on:
--   - "closedAt"        when a Deal transitioned to a terminal status (won/lost)
--   - "stageChangedAt"  when a Deal last moved to its current stage
--
-- These power avg time-to-close, conversion rate, and per-stage bottleneck
-- analytics (see lib/deal-metrics.ts). No UI is wired in this migration.
--
-- "stageChangedAt" was already introduced by 20260526000000_deal_stage_changed_at;
-- the ADD COLUMN IF NOT EXISTS below is a harmless no-op there and keeps this
-- file self-contained and re-runnable against any database state.
--
-- Additive and idempotent: nullable columns, IF NOT EXISTS, no destructive DDL.
-- ============================================================================

ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "closedAt"       timestamptz;
ALTER TABLE "Deal" ADD COLUMN IF NOT EXISTS "stageChangedAt" timestamptz;

-- Backfill stageChangedAt for rows that never had it set, using updatedAt as a
-- best-guess proxy for "time in current stage". New stage moves stamp it
-- explicitly going forward.
UPDATE "Deal"
   SET "stageChangedAt" = COALESCE("stageChangedAt", "updatedAt")
 WHERE "stageChangedAt" IS NULL;

-- Backfill closedAt for already-closed deals. updatedAt is the best available
-- proxy for the moment of close on historical rows; new closes stamp it
-- explicitly going forward.
UPDATE "Deal"
   SET "closedAt" = "updatedAt"
 WHERE status IN ('won', 'lost')
   AND "closedAt" IS NULL;

-- Maintain stageChangedAt on the Kanban drag-and-drop path. The reorder API
-- (app/api/deals/reorder/route.ts) changes a deal's stage via this RPC rather
-- than a direct .update(), so the timestamp must be stamped here. Only bump it
-- when the stage actually changes — a pure same-stage reorder must not reset
-- "time in current stage". This mirrors the definition in supabase/schema.sql.
CREATE OR REPLACE FUNCTION reorder_deal(
  p_deal_id      text,
  p_new_stage_id text,
  p_new_position integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Shift deals at or after the target position up by one to make room
  UPDATE "Deal"
  SET position = position + 1
  WHERE "stageId" = p_new_stage_id
    AND position >= p_new_position
    AND id != p_deal_id;

  -- Place the deal at its new stage and position
  UPDATE "Deal"
  SET "stageId"   = p_new_stage_id,
      position    = p_new_position,
      "stageChangedAt" = CASE WHEN "stageId" IS DISTINCT FROM p_new_stage_id
                              THEN now() ELSE "stageChangedAt" END,
      "updatedAt" = now()
  WHERE id = p_deal_id;
END;
$$;
