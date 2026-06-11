-- ============================================================================
-- Brokerage.leadRoutingRule — brokerage-wide default routing strategy
-- ============================================================================
-- WHY: Today every new unassigned lead waits for a broker to pick a realtor
-- by hand at /broker/leads. As brokerages grow that doesn't scale — the
-- broker becomes the queue. This column captures the brokerage's preferred
-- default for auto-routing: keep manual (today's behaviour), round-robin
-- across active members, or fewest-active-load.
--
-- Phase 3 of Chippi-for-Brokers ships the set_routing_rule write tool that
-- writes this column. The actual ENFORCEMENT (i.e. when a new lead arrives,
-- auto-pick a realtor based on this strategy) is OUT OF SCOPE for Phase 3
-- and will land as a separate change in the lead-creation pipeline. Until
-- that follow-up lands, the column is informational — it captures broker
-- intent so the routing-rule UI and Chippi can speak the same language,
-- without changing the existing manual flow.
-- ============================================================================

ALTER TABLE "Brokerage"
  ADD COLUMN IF NOT EXISTS "leadRoutingRule" text
    NOT NULL DEFAULT 'manual'
    CHECK ("leadRoutingRule" IN ('manual', 'round_robin', 'fewest_active'));

-- No backfill needed — the DEFAULT clause sets every existing row to
-- 'manual', which matches the current behaviour (broker assigns by hand).
