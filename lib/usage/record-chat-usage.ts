/**
 * recordChatUsage — TS-side writer for the ChatUsage table.
 *
 * Phase 4: the direct LLM path (`lib/chat/direct-llm.ts`) runs in the
 * Next.js process and needs its own telemetry writer — there is no
 * Modal hop to delegate to. Mirrors `agent/ledger.py::record_chat_usage`
 * (which the Modal agent path uses); both target the same table.
 *
 * Phase 4 also adds the `route` column (direct | agent | direct→agent).
 * This writer is the only thing on the TS side that knows the route at
 * write time, so it's the authoritative populater for direct-path rows.
 *
 * Never throws. A telemetry failure must not break a chat turn — the
 * caller already streamed bytes to the browser by the time this fires.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { detectProvider } from '@/lib/llm';

/**
 * Per-million-token pricing in USD. Mirrors agent/ledger.py:MODEL_PRICES —
 * keep in sync when adding new models.
 */
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  'gpt-5-mini': { in: 0.75, out: 4.5 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4o': { in: 2.5, out: 10.0 },
  'gpt-4.1': { in: 2.0, out: 8.0 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'openai/gpt-5.5': { in: 5.0, out: 30.0 },
  'openai/gpt-5-mini': { in: 0.75, out: 4.5 },
  'openai/gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'openai/gpt-4o-mini': { in: 0.15, out: 0.6 },
  'x-ai/grok-4.3': { in: 1.25, out: 2.5 },
  'anthropic/claude-opus-4.7': { in: 5.0, out: 25.0 },
  'moonshotai/kimi-k2.6': { in: 0.73, out: 3.49 },
  'qwen/qwen3.6-flash': { in: 0.19, out: 1.13 },
};
const DEFAULT_PRICE = { in: 2.5, out: 10.0 };

function calculateCost(model: string, tokensIn: number, tokensOut: number): number {
  const p = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  const cost = (tokensIn / 1_000_000) * p.in + (tokensOut / 1_000_000) * p.out;
  // 6 decimals matches numeric(10,6).
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export type ChatRoute = 'direct' | 'agent' | 'direct→agent';

export interface RecordChatUsageInput {
  spaceId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  userId?: string | null;
  conversationId?: string | null;
  /** Phase 4 router outcome. */
  route: ChatRoute;
  /** 'modal' (production agent path) | 'ts' (direct path or local fallback). */
  runtime?: 'modal' | 'ts';
}

export async function recordChatUsage(input: RecordChatUsageInput): Promise<void> {
  const promptTokens = Math.max(0, Math.floor(input.promptTokens || 0));
  const completionTokens = Math.max(0, Math.floor(input.completionTokens || 0));
  const cachedTokens = Math.max(
    0,
    Math.min(Math.floor(input.cachedTokens ?? 0), promptTokens),
  );
  if (promptTokens === 0 && completionTokens === 0) return;
  try {
    await supabase.from('ChatUsage').insert({
      spaceId: input.spaceId,
      userId: input.userId ?? null,
      conversationId: input.conversationId ?? null,
      model: input.model,
      promptTokens,
      completionTokens,
      cachedTokens,
      provider: detectProvider(input.model),
      route: input.route,
      costUsd: calculateCost(input.model, promptTokens, completionTokens),
      runtime: input.runtime ?? 'ts',
    });
  } catch (err) {
    logger.warn('[record-chat-usage] insert failed', { spaceId: input.spaceId }, err);
  }
}
