-- ═══════════════════════════════════════════════════════════════════════════
-- ChatUsage — cache & provider columns (Phase 2 cost-reduction telemetry).
--
-- Phase 1 trimmed ~10.8K tokens per turn (system prompt + tool docstring diet
-- + history limit + reasoning effort to low). Phase 2 wires per-provider
-- prompt caching. These two columns let us VERIFY the cache hit rate from
-- production traffic instead of estimating it — the Usage page surfaces
-- cached/input as a percentage, broken down per provider.
--
--   cachedTokens — count of prompt tokens served from the provider's
--                  prompt cache (free or discounted). Subset of
--                  promptTokens. 0 when the provider has no cache path on
--                  OpenRouter (xAI Grok, Google Gemini today).
--   provider     — OpenRouter prefix derived from the model slug at write
--                  time. 'anthropic' | 'openai' | 'xai' | 'deepseek' |
--                  'google' | 'moonshotai' | 'qwen' | 'unknown'.
--
-- Existing rows back-fill with 0 and 'unknown' — pre-Phase-2 data carries
-- no cache info and we don't try to reconstruct it from the model slug
-- after the fact. The Usage page only counts rows where provider != unknown
-- toward the breakdown so the legacy mass doesn't drag the percentages.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "ChatUsage"
  ADD COLUMN IF NOT EXISTS "cachedTokens" integer NOT NULL DEFAULT 0
    CHECK ("cachedTokens" >= 0),
  ADD COLUMN IF NOT EXISTS "provider"     text    NOT NULL DEFAULT 'unknown';

COMMENT ON COLUMN "ChatUsage"."cachedTokens" IS
  'Input tokens served from provider prompt cache (free or discounted). Subset of promptTokens. 0 when the provider has no caching path.';
COMMENT ON COLUMN "ChatUsage"."provider" IS
  'OpenRouter provider prefix: anthropic | openai | xai | deepseek | google | moonshotai | qwen | unknown.';

-- Per-provider rollup for the Usage page breakdown.
CREATE INDEX IF NOT EXISTS "ChatUsage_spaceId_provider_idx"
  ON "ChatUsage" ("spaceId", "provider");
