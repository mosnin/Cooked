/**
 * LLM provider — OpenRouter.
 *
 * # The provider boundary (read this before adding a model call)
 *
 * There is ONE rule, and it keeps OpenAI-API and OpenRouter cleanly separate:
 *
 *   - **All text/LLM work** — chat agent, autonomous runs, embeddings, lead
 *     scoring, scoring-model generation, form optimization, compaction,
 *     summaries — goes through `getLLMClient()` here. That client points at
 *     OpenRouter whenever `OPENROUTER_API_KEY` is set (the configured default)
 *     and only falls back to the OpenAI API (`OPENAI_API_KEY`) when OpenRouter
 *     is absent. Model slugs for this path MUST be provider-correct: use
 *     `openaiModel(name)` / `resolveChatModel()` so a bare `gpt-*` slug becomes
 *     `openai/gpt-*` on OpenRouter. NEVER `new OpenAI(...)` directly for LLM
 *     work — that bypasses OpenRouter and breaks OpenRouter-only deploys.
 *
 *   - **Audio only** — Whisper transcription, TTS, and the Realtime API —
 *     talks to the OpenAI API directly (`process.env.OPENAI_API_KEY`), because
 *     OpenRouter does not expose those endpoints. Those routes
 *     (`app/api/ai/transcribe|speak|realtime-session`, the Telnyx voice
 *     webhook) are the ONLY sanctioned direct-OpenAI callers. If you find a
 *     direct OpenAI client anywhere else doing text completion, it's a bug.
 *
 * OpenRouter is OpenAI-API-compatible, so the only difference from calling
 * OpenAI directly is the base URL + key.
 *
 * The Python agent has its own equivalent at `agent/llm.py`. The chat
 * model registry lives in `./chat-models` (pure data, client-safe) and is
 * re-exported here for server-side convenience.
 */

import OpenAI from 'openai';

// Local binding for use in this module (the block below only RE-exports it).
import { DEFAULT_CHAT_MODEL } from './chat-models';

export {
  CHAT_MODELS,
  DEFAULT_CHAT_MODEL,
  isValidChatModel,
  type ChatModelOption,
} from './chat-models';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Bound third-party LLM latency and cost. The OpenAI SDK defaults to a 600s
 * (10 min) per-request timeout and 2 silent auto-retries, so a hung or degraded
 * OpenRouter upstream could hold a serverless function open for minutes and
 * triple the token spend on every slow call. We cap both:
 *   - timeout 120s: generous enough that a single (streamed) chat completion
 *     finishes well within it, but bounded so a hang can't outlive the function.
 *     A caller with a genuinely longer call can override per-request
 *     (`client.chat.completions.create(..., { timeout })`).
 *   - 1 retry (down from 2): still rides out a transient 429/5xx, but halves the
 *     worst-case cost/latency amplification.
 */
const LLM_TIMEOUT_MS = 120_000;
const LLM_MAX_RETRIES = 1;

/**
 * Build the shared LLM client. Routes through OpenRouter when configured,
 * otherwise OpenAI direct. Throws only when neither key is present.
 */
export function getLLMClient(): OpenAI {
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    return new OpenAI({
      apiKey: openRouterKey,
      baseURL: OPENROUTER_BASE_URL,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    });
  }
  const openAIKey = process.env.OPENAI_API_KEY;
  if (openAIKey) {
    return new OpenAI({
      apiKey: openAIKey,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
    });
  }
  throw new Error('No LLM key configured — set OPENROUTER_API_KEY (or OPENAI_API_KEY).');
}

/** True once OpenRouter is the active provider. */
export function isOpenRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** True when at least one LLM provider key is configured (OpenRouter or OpenAI). */
export function hasLLMKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * Resolve a bare OpenAI model name to the slug the active provider wants —
 * vendor-prefixed (`openai/...`) for OpenRouter, bare for OpenAI direct.
 * Use for internal utility calls (embeddings, scoring, compaction). The
 * realtor-pickable chat models in CHAT_MODELS are already OpenRouter slugs.
 */
export function openaiModel(name: string): string {
  return isOpenRouterConfigured() ? `openai/${name}` : name;
}

/**
 * The model the in-app chat agent falls back to when ONLY an OpenAI key is
 * configured (no OpenRouter). Must be a real OpenAI model that supports tool
 * calling AND vision. gpt-4o-mini is the most universally-available such model.
 */
export const OPENAI_FALLBACK_CHAT_MODEL = 'gpt-4o-mini';

/**
 * Pick a chat model the ACTIVE provider can actually serve — the fix for the
 * keystone failure mode where the default model (`x-ai/grok-4.3`, an OpenRouter
 * slug) was shipped to `api.openai.com` (which has no such model) and every
 * turn 500'd.
 *
 * - OpenRouter configured → any slug is fine; return the requested model (or
 *   the default) verbatim.
 * - OpenAI-only → a vendor-prefixed slug (`x-ai/…`, `anthropic/…`, `moonshotai/…`)
 *   or any non-`gpt` model cannot be served by OpenAI; substitute the OpenAI
 *   fallback so the request CANNOT 404 on a wrong-provider model. A bare
 *   `gpt-*` model passes through unchanged.
 *
 * This makes the provider/model mismatch structurally impossible regardless of
 * which key the deployment has.
 */
export function resolveChatModel(requested?: string | null): string {
  const wanted = (requested && requested.trim()) || DEFAULT_CHAT_MODEL;
  if (isOpenRouterConfigured()) return wanted;
  // OpenAI-only path: only bare gpt-* models are servable.
  if (wanted.includes('/') || !wanted.toLowerCase().startsWith('gpt')) {
    return OPENAI_FALLBACK_CHAT_MODEL;
  }
  return wanted;
}

/**
 * Embedding model slug. OpenRouter and OpenAI both resolve this to the
 * same underlying model, so stored 1536-dim vectors stay valid across the
 * provider switch — do NOT change this without re-embedding the corpus.
 */
export const EMBEDDING_MODEL = isOpenRouterConfigured()
  ? 'openai/text-embedding-3-small'
  : 'text-embedding-3-small';

/**
 * Return the OpenRouter provider prefix from a model slug. Mirrors
 * `detect_provider` in `agent/llm.py` — keep the two in sync.
 *
 *   'anthropic/claude-opus-4.7' -> 'anthropic'
 *   'openai/gpt-5.5'            -> 'openai'
 *   'x-ai/grok-4.3'             -> 'xai'   (dash normalized out)
 *   'deepseek/deepseek-chat'    -> 'deepseek'
 *   'google/gemini-2.5-pro'     -> 'google'
 *   bare 'gpt-5'                -> 'openai' (OpenAI-direct fallback)
 *
 * Drives the ChatUsage.provider column and Usage page breakdown. Per-
 * provider caching support on OpenRouter:
 *   - anthropic: explicit `cache_control` markers, ~90% discount on
 *     cached input after first hit.
 *   - google (Phase 3): same `cache_control` markers as Anthropic on
 *     OpenRouter, ~75% discount. Min cache write ~4096 tokens.
 *   - openai / deepseek: automatic on stable prefixes >1024 tokens,
 *     ~50% discount.
 *   - xai / moonshotai / qwen: no caching path today; Phase 1 trim is
 *     the only saving.
 */
export function detectProvider(model: string | null | undefined): string {
  if (!model) return 'unknown';
  if (!model.includes('/')) return 'openai';
  const prefix = model.split('/', 1)[0].toLowerCase().replace(/-/g, '');
  return prefix || 'unknown';
}

/**
 * Human-friendly provider labels for the Usage page breakdown. Anything
 * not in the table renders as the raw prefix.
 */
export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  xai: 'xAI Grok',
  deepseek: 'DeepSeek',
  google: 'Google Gemini',
  moonshotai: 'Moonshot Kimi',
  qwen: 'Qwen',
  unknown: 'Other',
};

/**
 * Providers where OpenRouter caches input tokens. The realtor should see
 * a meaningful hit rate over time on these. xAI / Moonshot / Qwen fall
 * back to Phase 1's prompt trim only, so a 0% rate there is correct —
 * not a bug worth surfacing. Google Gemini was added in Phase 3 once the
 * cache_control proxy was extended to forward Anthropic-shape markers
 * to Gemini on OpenRouter.
 */
export const CACHING_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'deepseek',
  'google',
]);
