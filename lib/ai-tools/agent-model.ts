/**
 * Agent-scoped model wrapper for the in-process chat runtime.
 *
 * The interactive chat agent runs on the SAME provider the rest of the app
 * uses — `getLLMClient()` from `lib/llm.ts`, which is OpenRouter-first and
 * falls back to OpenAI direct. This is the fix for the keystone failure mode:
 * the old version hardcoded `gpt-5-mini` on the OpenAI **Responses API** with
 * a direct-OpenAI client, so every chat turn on an OpenRouter-only deploy
 * threw `MissingAgentKeyError` before a single token streamed — and even with
 * an OpenAI key, the realtor's chosen model (`x-ai/grok-4.3`) was ignored.
 *
 * Now:
 *   - One client, the app-wide `getLLMClient()` (OpenRouter or OpenAI).
 *   - The realtor's workspace model, resolved through `resolveChatModel()` so
 *     a provider/model mismatch is structurally impossible.
 *   - `OpenAIChatCompletionsModel` (chat completions), NOT the Responses API.
 *     Chat completions streams reliably across every OpenRouter provider
 *     (Grok, Claude, Gemini, GPT) and never wedges on a reasoning-model
 *     `max_output_tokens` mismatch — the prior hang.
 *
 * We hand the SDK an `OpenAIChatCompletionsModel` built against our own client
 * rather than mutating the SDK's global default client. Local instance = no
 * cross-request bleed, no global state, fully reversible.
 */

import { OpenAIChatCompletionsModel } from '@openai/agents';
import type { Model } from '@openai/agents';
import { getLLMClient, resolveChatModel } from '@/lib/llm';

/**
 * Cache one Model wrapper per resolved model slug. The OpenAI client is
 * stateless per-request and safe to share; rebuilding the wrapper per turn
 * would re-pay client setup for no benefit. Keyed by slug so a workspace that
 * switches models (or a deploy that flips provider) gets a fresh wrapper
 * instead of a stale one.
 */
const cache = new Map<string, Model>();

/**
 * The SDK `Model` the agent runs on: the realtor's workspace model (resolved
 * to something the active provider can actually serve) over the app-wide LLM
 * client, via chat completions.
 *
 * @param modelSlug The workspace's configured chat model. When omitted, the
 *   default chat model is used. Always passed through `resolveChatModel()`.
 */
export function getAgentModel(modelSlug?: string | null): Model {
  const resolved = resolveChatModel(modelSlug);
  const cached = cache.get(resolved);
  if (cached) return cached;
  const model = new OpenAIChatCompletionsModel(getLLMClient(), resolved);
  cache.set(resolved, model);
  return model;
}
