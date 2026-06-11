import { NextResponse } from 'next/server';
import {
  DEFAULT_CHAT_MODEL,
  EMBEDDING_MODEL,
  detectProvider,
  hasLLMKey,
  isOpenRouterConfigured,
  resolveChatModel,
} from '@/lib/llm';
import { chatRuntime } from '@/lib/ai-tools/runtime-flag';

/**
 * GET /api/ai/health
 *
 * Non-secret diagnostic for the Chippi chat agent. Answers, in one GET,
 * WHICH provider/model/runtime a chat turn will actually use and whether the
 * required keys are present — so a broken deploy can be diagnosed from the
 * outside without reading logs.
 *
 * Secrets are NEVER returned. Env vars are reported only as booleans
 * (present/absent); the only strings exposed are non-secret config values
 * (model slugs, runtime flag) derived from the shared `@/lib/llm` helpers.
 */
export const runtime = 'nodejs';

export async function GET() {
  try {
    const provider = isOpenRouterConfigured()
      ? 'openrouter'
      : Boolean(process.env.OPENAI_API_KEY)
        ? 'openai'
        : 'none';

    const resolvedDefaultModel = resolveChatModel();

    return NextResponse.json({
      provider,
      hasLLMKey: hasLLMKey(),
      keys: {
        openRouter: Boolean(process.env.OPENROUTER_API_KEY),
        openai: Boolean(process.env.OPENAI_API_KEY),
      },
      chatRuntime: chatRuntime(),
      defaultModel: DEFAULT_CHAT_MODEL,
      resolvedDefaultModel,
      resolvedProvider: detectProvider(resolvedDefaultModel),
      embeddingModel: EMBEDDING_MODEL,
      modal: {
        chatUrlConfigured: Boolean(process.env.MODAL_CHAT_URL),
        internalSecretConfigured: Boolean(process.env.AGENT_INTERNAL_SECRET),
      },
      composioConfigured: Boolean(process.env.COMPOSIO_API_KEY),
      ok: hasLLMKey(),
      checkedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'health check failed' }, { status: 500 });
  }
}
