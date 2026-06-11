-- ═══════════════════════════════════════════════════════════════════════════
-- AgentTrajectory — cache & provider columns (Phase 3 cost-reduction
-- telemetry for the autonomous-run path).
--
-- Phase 2 wired the same two columns onto ChatUsage so the interactive
-- chat surface could prove the cache hit rate from production traffic.
-- The autonomous-run path writes AgentTrajectory, not ChatUsage, so the
-- cache discount was invisible there. Phase 3 mirrors the columns onto
-- AgentTrajectory so a "cost per autonomous run" rollup can show the
-- same numbers.
--
--   cachedTokens — count of prompt tokens served from the provider's
--                  prompt cache (free or discounted). Subset of
--                  totalTokens. 0 when the provider has no cache path
--                  on OpenRouter (xAI Grok, Moonshot Kimi, Qwen today).
--                  Anthropic + Google Gemini get explicit markers
--                  (Phase 3 extends Phase 2's marker proxy to Gemini);
--                  OpenAI + DeepSeek auto-cache.
--   provider     — OpenRouter prefix derived from the model slug at the
--                  end of the run. 'anthropic' | 'openai' | 'xai' |
--                  'deepseek' | 'google' | 'moonshotai' | 'qwen' |
--                  'unknown'.
--
-- Existing rows back-fill with 0 / 'unknown'. Pre-Phase-3 trajectories
-- carry no cache info and we don't try to reconstruct it from the model
-- slug after the fact — any future per-provider rollup should filter
-- provider != 'unknown' the same way the ChatUsage rollup does (see
-- app/api/agent/usage/route.ts).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "AgentTrajectory"
  ADD COLUMN IF NOT EXISTS "cachedTokens" integer NOT NULL DEFAULT 0
    CHECK ("cachedTokens" >= 0),
  ADD COLUMN IF NOT EXISTS "provider"     text    NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN "AgentTrajectory"."cachedTokens" IS
  'Input tokens served from provider prompt cache (free or discounted). Subset of totalTokens. 0 when the provider has no caching path.';
COMMENT ON COLUMN "AgentTrajectory"."provider" IS
  'OpenRouter provider prefix: anthropic | openai | xai | deepseek | google | moonshotai | qwen | unknown.';

-- Per-provider rollup. Mirrors ChatUsage_spaceId_provider_idx so the same
-- "cache hit rate per provider, last 7d" query shape works on either
-- table. Cheap to maintain; only fires on autonomous-run writes (≤ a
-- handful per realtor per day).
CREATE INDEX IF NOT EXISTS "AgentTrajectory_spaceId_provider_idx"
  ON "AgentTrajectory" ("spaceId", "provider");
