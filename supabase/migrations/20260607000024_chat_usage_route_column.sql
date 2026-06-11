-- ═══════════════════════════════════════════════════════════════════════════
-- ChatUsage.route — Phase 4 dual-path telemetry.
--
-- Phase 4 introduces the dual-path router: most turns now hit a cheap "direct"
-- LLM call (no agents SDK, no tool registry — just system prompt + vector
-- context + history + user message). Action turns still route through the
-- Modal agent. The router lives in `lib/chat/router.ts`; the direct path in
-- `lib/chat/direct-llm.ts`.
--
-- This column records which path each turn took so the Usage page can show
-- the % of turns served by direct vs agent vs direct-then-escalated. Without
-- it we can't measure whether the router is doing its job (most generic Q&A
-- should route direct; the agent path should be reserved for actions).
--
--   'direct'         — router picked direct, the turn finished there.
--   'agent'          — router picked agent from the first heuristic match.
--   'direct→agent'   — direct path ran first, decided it needed tools, and
--                      the request was re-routed to the agent path.
--
-- 'agent' is the default for pre-Phase-4 rows so the legacy mass shows as
-- "agent" on the breakdown (which is correct — every pre-Phase-4 turn went
-- through Modal). Future analytics that want the Phase 4 cutover need to
-- filter on createdAt.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ChatUsage"
  ADD COLUMN IF NOT EXISTS "route" text NOT NULL DEFAULT 'agent';

COMMENT ON COLUMN "ChatUsage"."route" IS
  'Dual-path router outcome: direct | agent | direct→agent. Default agent for backward compat.';

-- Per-route rollup for the Usage page Phase 4 cutover panel.
CREATE INDEX IF NOT EXISTS "ChatUsage_spaceId_route_idx"
  ON "ChatUsage" ("spaceId", "route");
