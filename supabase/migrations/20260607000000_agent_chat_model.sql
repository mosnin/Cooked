-- ═══════════════════════════════════════════════════════════════════════════
-- AgentSettings.chatModel — the rep's chosen "primary model".
--
-- Set from Settings → Profile. NULL means "use the app default"
-- (DEFAULT_CHAT_MODEL in lib/llm.ts / agent/llm.py). Stored as an
-- OpenRouter model slug, e.g. 'openai/gpt-5.5', 'anthropic/claude-opus-4.7'.
--
-- The chat runtime (agent/modal_app.py) reads this off the AgentSettings
-- row it already loads per turn and passes it to make_koala_agent().
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "AgentSettings"
  ADD COLUMN IF NOT EXISTS "chatModel" text;
