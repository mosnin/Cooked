/**
 * POST /api/ai/task — on-demand agent streaming endpoint.
 *
 * Every chat turn proxies to the Modal Python sandbox running Chippi via the
 * OpenAI Agents SDK. Modal provides the secure isolated execution environment
 * for long-running, autonomous, multi-step reasoning chains. The Next.js layer
 * handles auth, rate-limiting, persistence, and SSE translation; Modal handles
 * the actual agent loop.
 *
 * Pipeline:
 *   1. Auth the caller + resolve a ToolContext.
 *   2. Rate-limit (per-user, per-IP, per-space).
 *   3. Resolve/create the conversation; save the user message.
 *   4. Load recent history (capped at HISTORY_LIMIT).
 *   5. Hydrate any referenced Attachment rows.
 *   6. POST to Modal chat_turn endpoint with the full context.
 *   7. Translate Modal SSE events → standard agent event format.
 *   8. Persist the assistant message on turn completion.
 *
 * Set CHIPPI_CHAT_RUNTIME=ts to fall back to the in-process TypeScript runtime
 * (useful for local dev without a Modal deployment).
 */

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { saveUserMessage, saveAssistantMessage } from '@/lib/ai-tools/persistence';
import { resolveToolContext } from '@/lib/ai-tools/context';
import { isReservedConversationTitle } from '@/lib/chat/conversation-access';
import type { ToolContext } from '@/lib/ai-tools/types';
import {
  chippiErrorMessage,
  computeConversationTitle,
  fallbackHeuristic,
} from '@/lib/ai-tools/chippi-voice';
import {
  emit as emitTelemetry,
  hasEmitted as hasEmittedTelemetry,
  getFirstEmittedAt,
  secondsBetween,
} from '@/lib/telemetry';
import { chatRuntime } from '@/lib/ai-tools/runtime-flag';
import { streamTsChatTurn } from '@/lib/ai-tools/sdk-chat-stream';
import { sanitizeUserInput } from '@/lib/agent/prompt-sanitizer';
import { isSubscriptionDelinquent } from '@/lib/api-auth';
import { getTodayTokenUsage } from '@/lib/usage/today-token-usage';
import { assertCanSpend, CreditsExhaustedError } from '@/lib/billing/meter';
import { resolveBillingAccount } from '@/lib/billing/account';
import { getSignedDownloadUrl } from '@/lib/storage';
import { decideRoute } from '@/lib/chat/router';
import { streamDirectTurn } from '@/lib/chat/direct-stream';
import {
  type MultimodalAttachment,
  pickModelForAttachments,
} from '@/lib/chat/multimodal';
import { resolveChatModel, isOpenRouterConfigured } from '@/lib/llm';
import { DEFAULT_CHAT_MODEL } from '@/lib/chat-models';

/** TTL for attachment URLs forwarded to Modal. The agent reads them within
 *  seconds of receiving the task; 30 minutes is plenty of headroom and short
 *  enough that a leaked task payload can't be replayed against the assets. */
const ATTACHMENT_HYDRATE_TTL_SECONDS = 60 * 30;
import type { MessageBlock } from '@/lib/ai-tools/blocks';

// A Modal chat turn can run for minutes (multi-tool agentic reasoning). The
// proxy must outlive the Modal function (its timeout is 600s) or Vercel kills
// the stream mid-turn and the assistant message is lost. nodejs runtime is
// required — this route streams and uses Node `crypto`.
export const runtime = 'nodejs';
export const maxDuration = 300;

interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
}

interface AttachmentPayload {
  id: string;
  filename: string;
  mime_type: string;
  extracted_text: string | null;
  public_url: string;
}

/** Cap on history messages fed to the model. */
const HISTORY_LIMIT = 8;

interface PostBody {
  spaceSlug: string;
  conversationId?: string | null;
  message: string;
  attachmentIds?: string[];
  /**
   * Explicit per-message runtime pick from the composer's Chat/Agent switch.
   *   - 'chat'  → lean single-call path: one LLM completion + read-only vector
   *               search over the realtor's data. No tools, no agent loop, so
   *               a turn costs ~3k tokens. The structural fix for the
   *               500k-tokens-per-input blowup: most turns never touch the
   *               tool loop at all.
   *   - 'agent' → full tool surface on Modal. Can act (create / send /
   *               schedule). Bounded server-side (max_turns + lean tool set).
   * Absent (older client) → fall back to the heuristic router.
   */
  mode?: 'chat' | 'agent' | string;
}

function autoTitleConversation(spaceId: string, conversationId: string, userMessage: string): void {
  void (async () => {
    try {
      const { allowed } = await checkRateLimit(`chat:title:${spaceId}`, 60, 3600);
      const title = allowed
        ? await computeConversationTitle(userMessage)
        : fallbackHeuristic(userMessage);
      if (!title || title === 'New conversation') return;
      const { error } = await supabase
        .from('Conversation')
        .update({ title, updatedAt: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('spaceId', spaceId);
      if (error) {
        logger.warn('[ai/task] auto-title patch failed', { conversationId }, error);
      }
    } catch (err) {
      logger.warn('[ai/task] auto-title pipeline crashed', { conversationId }, err);
    }
  })();
}

async function resolveConversation(
  spaceId: string,
  conversationId: string | null | undefined,
  userMessage: string,
): Promise<string> {
  if (conversationId) {
    const { data } = await supabase
      .from('Conversation')
      .select('id, spaceId, title')
      .eq('id', conversationId)
      .maybeSingle();
    // Reject reserved broker/team titles. A broker_owner's personal spaceId
    // equals their realtor space, and the pre-migration broker/team rows still
    // live in this shared table — so the spaceId check alone is NOT isolation.
    // Without this, a broker/team conversationId would be accepted on the
    // realtor surface, its history fed to the model, and new realtor turns
    // persisted into that broker conversation. Fall through to a fresh one.
    if (data && data.spaceId === spaceId && !isReservedConversationTitle(data.title)) {
      if (!data.title || data.title === 'New conversation') {
        autoTitleConversation(spaceId, conversationId, userMessage);
      }
      return conversationId;
    }
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from('Conversation').insert({
    id,
    spaceId,
    title: 'New conversation',
  });
  if (error) throw error;
  autoTitleConversation(spaceId, id, userMessage);
  return id;
}

async function loadHistory(spaceId: string, conversationId: string): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from('Message')
    .select('role, content, createdAt')
    .eq('spaceId', spaceId)
    .eq('conversationId', conversationId)
    .order('createdAt', { ascending: false })
    .limit(HISTORY_LIMIT);

  // ascending:false + limit fetches the most RECENT n; reverse to restore
  // chronological order. The old ascending:true + limit silently fed the
  // model the OLDEST n messages and dropped every recent turn once a
  // conversation passed n messages.
  const rows = ((data ?? []) as Array<{ role: string; content: string }>).reverse();
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
    }));
}

async function hydrateAttachments(
  spaceId: string,
  ids: string[] | undefined,
): Promise<AttachmentPayload[]> {
  if (!ids || ids.length === 0) return [];
  try {
    const { data, error } = await supabase
      .from('Attachment')
      .select('id, filename, "mimeType", "extractedText", "storagePath", "extractionStatus"')
      .in('id', ids)
      .eq('spaceId', spaceId);
    if (error) {
      logger.warn('[ai/task] attachment hydrate failed — continuing empty', { spaceId }, error);
      return [];
    }
    const rows = (data ?? []) as Array<{
      id: string;
      filename: string;
      mimeType: string;
      extractedText: string | null;
      storagePath: string | null;
      extractionStatus: string;
    }>;
    // Mint a fresh signed URL per attachment for this task. Each task is a
    // single agent turn — short-lived URLs are correct here. A signing
    // failure for one row drops that row's URL but doesn't poison the rest.
    return Promise.all(
      rows.map(async (r) => {
        let signedUrl = '';
        if (r.storagePath) {
          try {
            signedUrl = await getSignedDownloadUrl(
              r.storagePath,
              ATTACHMENT_HYDRATE_TTL_SECONDS,
            );
          } catch (signErr) {
            logger.warn(
              '[ai/task] attachment sign failed',
              { spaceId, attachmentId: r.id },
              signErr,
            );
          }
        }
        return {
          id: r.id,
          filename: r.filename,
          mime_type: r.mimeType,
          extracted_text: r.extractedText,
          public_url: signedUrl,
        };
      }),
    );
  } catch (err) {
    logger.warn('[ai/task] attachment hydrate threw — continuing empty', { spaceId }, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Modal SSE proxy
// ---------------------------------------------------------------------------

interface ProxyModalStreamInput {
  modalBody: ReadableStream<Uint8Array>;
  spaceId: string;
  conversationId: string;
  abortController: AbortController;
}

/**
 * Translate the SSE stream from Modal's chat_turn endpoint into the standard
 * agent event format the browser client expects, persisting the assistant
 * message once the turn completes.
 *
 * Modal event → browser event mapping:
 *   token            → text_delta
 *   tool_call_start  → tool_call_start  (rename "tool" field → "name")
 *   tool_call_result → tool_call_result (rename "tool" field → "name")
 *   done             → turn_complete    (+ persist assistant message)
 *   error            → error
 */
function proxyModalStream({
  modalBody,
  spaceId,
  conversationId,
  abortController,
}: ProxyModalStreamInput): Response {
  const encoder = new TextEncoder();
  let seq = 0;

  function push(controller: ReadableStreamDefaultController, event: Record<string, unknown>) {
    const line = `data: ${JSON.stringify({ seq: seq++, ts: new Date().toISOString(), ...event })}\n\n`;
    controller.enqueue(encoder.encode(line));
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = modalBody.getReader();
      const decoder = new TextDecoder();
      let lineBuf = '';
      const textChunks: string[] = [];
      // Ordered render list assembled as the turn streams — text + tool-call
      // blocks. Persisted verbatim so a reloaded conversation shows what
      // Chippi actually did (tool calls, plan cards), not just a flat reply.
      const blocks: MessageBlock[] = [];
      // Track args from the most recent create_plan tool_call_start so we can
      // emit plan_created when the matching tool_call_result arrives.
      let pendingPlanArgs: Record<string, unknown> | null = null;
      // Persist exactly once — on `done`, on `error`, or on the stream simply
      // dropping. Before this only the `done` path saved, so any mid-stream
      // Modal failure erased the whole assistant turn from history.
      let persisted = false;
      // Track whether a terminal browser event (turn_complete | error) ever
      // reached the wire. Modal can be killed mid-stream (600s container
      // timeout, dropped socket) and end the SSE with NO `done`/`error`
      // frame — the browser's EventSource then sits open forever. The
      // `finally` below uses this to guarantee exactly one terminal frame.
      let sentTerminal = false;
      async function persistOnce(finalText?: string): Promise<void> {
        if (persisted) return;
        persisted = true;
        let toSave: MessageBlock[] = blocks;
        if (toSave.length === 0 && finalText && finalText.trim()) {
          toSave = [{ type: 'text', content: finalText }];
        }
        if (toSave.length === 0) return;
        try {
          await saveAssistantMessage({ spaceId, conversationId, blocks: toSave });
        } catch (err) {
          logger.warn('[ai/task] modal: persist assistant message failed', { spaceId }, err);
        }
      }

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuf += decoder.decode(value, { stream: true });
          const lines = lineBuf.split('\n');
          lineBuf = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              continue;
            }

            const type = typeof evt.type === 'string' ? evt.type : '';

            if (type === 'token') {
              const delta = String(evt.delta ?? '');
              textChunks.push(delta);
              blocks.push({ type: 'text', content: delta });
              push(controller, { type: 'text_delta', delta });

            } else if (type === 'reasoning_delta') {
              push(controller, { type: 'reasoning_delta', delta: String(evt.delta ?? '') });

            } else if (type === 'tool_call_start') {
              const toolName = String(evt.tool ?? 'tool');
              const toolArgs = (evt.args ?? {}) as Record<string, unknown>;
              // Use the SDK call_id Modal now forwards so the browser can
              // correlate the result back to this call; fall back to a fresh
              // id for older Modal deploys that don't send one.
              const callId =
                typeof evt.call_id === 'string' && evt.call_id
                  ? evt.call_id
                  : crypto.randomUUID();
              // Remember create_plan args so we can emit plan_created on result.
              if (toolName === 'create_plan') {
                pendingPlanArgs = toolArgs;
              }
              blocks.push({
                type: 'tool_call',
                callId,
                name: toolName,
                args: toolArgs,
                status: 'complete',
              });
              push(controller, {
                type: 'tool_call_start',
                name: toolName,
                args: toolArgs,
                callId,
              });

            } else if (type === 'tool_call_result') {
              const toolName = String(evt.tool ?? 'tool');
              const callId = typeof evt.call_id === 'string' ? evt.call_id : '';
              const ok = evt.ok !== false;
              const summary = String(evt.summary ?? '');
              // Settle the result onto its tool-call block — by call_id when
              // present, else the most recent still-unresolved tool call.
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i];
                if (b.type !== 'tool_call') continue;
                if (callId ? b.callId === callId : !b.result) {
                  b.result = { ok, summary };
                  b.status = ok ? 'complete' : 'error';
                  break;
                }
              }
              // Emit plan_created before the result so the browser can render
              // the plan card immediately, before the tool call settles.
              if (toolName === 'create_plan' && pendingPlanArgs !== null) {
                const args = pendingPlanArgs;
                if (typeof args.task === 'string' && Array.isArray(args.steps)) {
                  push(controller, {
                    type: 'plan_created',
                    task: args.task,
                    steps: args.steps,
                  });
                }
                pendingPlanArgs = null;
              }
              push(controller, {
                type: 'tool_call_result',
                name: toolName,
                ok,
                summary,
                callId,
              });

            } else if (type === 'done') {
              const finalText =
                typeof evt.final_text === 'string' && evt.final_text.trim()
                  ? evt.final_text
                  : textChunks.join('');
              await persistOnce(finalText);
              push(controller, { type: 'turn_complete', reason: 'complete' });
              sentTerminal = true;

            } else if (type === 'error') {
              // Persist whatever streamed before the failure so a mid-turn
              // Modal error doesn't erase the assistant message the user saw.
              await persistOnce();
              push(controller, { type: 'error', message: evt.message ?? 'Agent error' });
              sentTerminal = true;
            }
          }
        }

        // Flush any remaining buffer
        if (lineBuf.startsWith('data: ')) {
          const raw = lineBuf.slice(6).trim();
          if (raw) {
            try {
              const evt = JSON.parse(raw) as Record<string, unknown>;
              if (evt.type === 'done') {
                const finalText =
                  typeof evt.final_text === 'string' && evt.final_text.trim()
                    ? evt.final_text
                    : textChunks.join('');
                await persistOnce(finalText);
                push(controller, { type: 'turn_complete', reason: 'complete' });
                sentTerminal = true;
              }
            } catch {
              // ignore malformed trailing line
            }
          }
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          logger.error('[ai/task] modal stream read error', { spaceId }, err);
          push(controller, { type: 'error', message: chippiErrorMessage('internal') });
          sentTerminal = true;
        }
      } finally {
        // Safety net — the stream ended with no `done`/`error` event (Modal
        // crash, dropped connection, 600s container kill mid-stream). Persist
        // whatever streamed (idempotent via `persisted`) AND guarantee the
        // browser sees exactly one terminal frame so its EventSource closes
        // instead of hanging open forever. Skip when the client aborted —
        // there's no one listening.
        await persistOnce();
        if (!sentTerminal && !abortController.signal.aborted) {
          logger.warn('[ai/task] modal stream ended with no terminal event', { spaceId });
          push(controller, { type: 'error', message: chippiErrorMessage('internal') });
        }
        controller.close();
        reader.releaseLock();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const spaceSlug = typeof body.spaceSlug === 'string' ? body.spaceSlug.trim() : '';
  const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
  if (!spaceSlug) return NextResponse.json({ error: 'spaceSlug required' }, { status: 400 });
  if (!rawMessage) return NextResponse.json({ error: 'message required' }, { status: 400 });
  if (rawMessage.length > 8000) {
    return NextResponse.json({ error: 'message too long (8000 char max)' }, { status: 400 });
  }

  const sanitized = sanitizeUserInput(rawMessage);
  if (!sanitized.safe) {
    return NextResponse.json(
      { error: 'Message blocked by safety filter', violations: sanitized.violations },
      { status: 400 },
    );
  }
  const message = sanitized.sanitized;

  const abortController = new AbortController();

  const ctxOrResponse = await resolveToolContext(spaceSlug, abortController.signal);
  if (ctxOrResponse instanceof NextResponse) return ctxOrResponse;
  const ctx: ToolContext = ctxOrResponse;

  // The three rate-limit counters are independent — fire them together
  // instead of paying three sequential Redis round-trips on the critical
  // path before the first token.
  const ip = getClientIp(req);
  const [userLimit, ipLimit, spaceLimit] = await Promise.all([
    checkRateLimit(`ai:task:${ctx.userId}`, 30, 3600),
    checkRateLimit(`chat:ip:${ip}`, 30, 600),
    checkRateLimit(`chat:space:${ctx.space.id}`, 60, 600),
  ]);
  if (!userLimit.allowed) {
    return NextResponse.json({ error: chippiErrorMessage('rate_limited') }, { status: 429 });
  }
  if (!ipLimit.allowed || !spaceLimit.allowed) {
    return NextResponse.json(
      { error: chippiErrorMessage('rate_limited') },
      { status: 429, headers: { 'Retry-After': '600' } },
    );
  }

  // Dunning gate — pause premium AI for a LAPSED paid subscription (the card
  // failed, or the plan was canceled), while leaving the CRM fully usable.
  // Only past_due / canceled / unpaid are gated; free & never-subscribed
  // ('inactive'), trialing, and active all pass. Admins bypass. Fails OPEN so a
  // DB hiccup can't lock out a paying customer.
  //
  // Gate on the account that actually FUNDS the space, not the Space row: Solo/
  // Pro pay from the Space, but Team / Team Plus members are funded by their
  // Brokerage pool and their own Space status stays 'inactive' by design — so
  // reading only the Space let a lapsed brokerage keep premium AI on every seat.
  try {
    const { account } = await resolveBillingAccount(ctx.space.id);
    const { data: subRow } =
      account.type === 'brokerage'
        ? await supabase
            .from('Brokerage')
            .select('stripeSubscriptionStatus')
            .eq('id', account.id)
            .maybeSingle()
        : await supabase
            .from('Space')
            .select('stripeSubscriptionStatus')
            .eq('id', account.id)
            .maybeSingle();
    const subStatus = subRow?.stripeSubscriptionStatus ?? 'inactive';
    if (isSubscriptionDelinquent(subStatus)) {
      const { data: userRow } = await supabase
        .from('User')
        .select('platformRole')
        .eq('clerkId', ctx.userId)
        .maybeSingle();
      if (userRow?.platformRole !== 'admin') {
        return NextResponse.json(
          {
            error:
              'Your subscription needs attention — update your payment method in billing to keep using Chippi. Your workspace and data stay available.',
          },
          { status: 402 },
        );
      }
    }
  } catch (err) {
    logger.warn('[ai/task] subscription status check failed — allowing turn', { spaceSlug }, err);
  }

  try {
    // Budget settings + today's usage are independent reads — fetch together.
    const [settingsResult, usageResult] = await Promise.all([
      supabase
        .from('AgentSettings')
        .select('dailyTokenBudget')
        .eq('spaceId', ctx.space.id)
        .maybeSingle(),
      // Sums ChatUsage rows + the autonomous Redis counter, matching the
      // Settings display. (The old version read AgentTask token columns no
      // code writes, so enforcement silently passed every time.)
      getTodayTokenUsage(ctx.space.id),
    ]);

    // Default must match the AgentSettings.dailyTokenBudget DB column default
    // (and schemas.py / the settings + usage APIs), which are all 50_000. This
    // fallback was 500_000, so a space with no AgentSettings row was gated at
    // 10x the budget every other surface shows and enforces.
    const dailyTokenBudget: number =
      ((settingsResult.data as { dailyTokenBudget?: number | null } | null)?.dailyTokenBudget as
        | number
        | null
        | undefined) ?? 50_000;
    const { total: todayTokens } = usageResult;

    if (todayTokens >= dailyTokenBudget) {
      logger.warn('[ai/task] daily token budget exceeded', {
        spaceId: ctx.space.id,
        todayTokens,
        dailyTokenBudget,
      });
      return NextResponse.json({ error: 'Daily token budget exceeded' }, { status: 429 });
    }
  } catch (err) {
    logger.warn('[ai/task] token budget check failed — continuing', { spaceSlug }, err);
  }

  // Credit gate — refuse the turn up front when the funding account is out of
  // credits. No-op unless CREDITS_ENFORCED, so this is dormant until credits go
  // live. Joins the daily-token-budget gate above as a pre-stream refusal the
  // chat client already surfaces (same non-OK JSON error shape as 429/400).
  try {
    await assertCanSpend(ctx.space.id, 'chat_turn');
  } catch (err) {
    if (err instanceof CreditsExhaustedError) {
      return NextResponse.json(
        { error: 'Out of credits. Buy a top-up or upgrade your plan to keep chatting with Chippi.' },
        { status: 402 },
      );
    }
    throw err;
  }

  let conversationId: string;
  try {
    conversationId = await resolveConversation(ctx.space.id, body.conversationId ?? null, message);
  } catch (err) {
    logger.error('[ai/task] conversation resolve failed', { spaceSlug }, err);
    return NextResponse.json({ error: chippiErrorMessage('internal') }, { status: 500 });
  }

  try {
    await saveUserMessage({ spaceId: ctx.space.id, conversationId, content: message });
  } catch (err) {
    logger.error('[ai/task] save user message failed', { spaceSlug }, err);
    return NextResponse.json({ error: chippiErrorMessage('internal') }, { status: 500 });
  }

  // The turn's credit charge is applied by the model-aware ChatUsage trigger
  // (meter_chat_usage_credits) when usage is recorded — not here. A second flat
  // charge at this point would double-debit the turn. The pre-stream gate above
  // (assertCanSpend) stays: refuse up front when out of credits.

  void (async () => {
    try {
      if (await hasEmittedTelemetry(ctx.space.id, 'chippi_first_message')) return;
      const signupAt = await getFirstEmittedAt(ctx.space.id, 'signup_completed');
      await emitTelemetry({
        event: 'chippi_first_message',
        spaceId: ctx.space.id,
        userId: ctx.userId,
        payload: {
          conversationId,
          messagePreview: message.slice(0, 50),
          secondsFromSignup: secondsBetween(signupAt, new Date()),
        },
      });
    } catch (err) {
      logger.warn('[ai/task] first-message telemetry failed', { spaceSlug }, err);
    }
  })();

  let history: HistoryRow[];
  try {
    history = await loadHistory(ctx.space.id, conversationId);
  } catch (err) {
    logger.warn('[ai/task] history load failed — continuing without it', { spaceSlug }, err);
    history = [];
  }

  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'user' && last.content === message) history.pop();
  }

  const hydratedAttachments = await hydrateAttachments(ctx.space.id, body.attachmentIds);

  // ── Unified router ─────────────────────────────────────────────────────────
  // The router decides direct (fast Q&A / multimodal summary) vs agent (full
  // tool surface). Both run IN-PROCESS by default — no Modal cold start, fast
  // first token. Modal is reached two ways and two ways only:
  //   1. the agent runtime spawns deep / swarm sub-tasks ON Modal via
  //      delegate_task (the keystone use the owner wants Modal for), and
  //   2. CHIPPI_CHAT_RUNTIME=modal proxies the WHOLE agent turn to the sandbox
  //      (kept as a fallback / for running heavy turns entirely in Modal).
  // Router errors → 'agent' (its safe default), so a router bug can't silently
  // drop a real action.
  const routerAttachments = hydratedAttachments.map((a) => ({
    id: a.id,
    mimeType: a.mime_type,
  }));
  // Explicit per-message mode from the composer's Chat/Agent switch wins over
  // the heuristic router. 'chat' maps to the lean direct path (no tools, no
  // loop — the 500k-token fix); 'agent' maps to the full tool surface. An
  // absent mode (older client) falls back to decideRoute so nothing breaks.
  const explicitMode: 'chat' | 'agent' | null =
    body.mode === 'agent' ? 'agent' : body.mode === 'chat' ? 'chat' : null;
  const route =
    explicitMode === 'chat'
      ? 'direct'
      : explicitMode === 'agent'
        ? 'agent'
        : decideRoute(message, routerAttachments);

  // Resolve the model for THIS turn: the workspace model forced to something
  // the active provider can actually serve (kills the grok-slug-to-OpenAI
  // mismatch), then upgraded to a vision-capable model if the turn carries
  // attachments the chosen model can't see — so multimodal just works instead
  // of dropping the file on a text-only model.
  const workspaceModel = await loadWorkspaceModel(ctx.space.id);
  const baseModel = resolveChatModel(workspaceModel);
  const turnAttachments = hydratedAttachments.map<MultimodalAttachment>((a) => ({
    id: a.id,
    filename: a.filename,
    mimeType: a.mime_type,
    url: a.public_url,
  }));
  const { model: turnModel, upgraded } = pickModelForAttachments(
    baseModel,
    turnAttachments,
    isOpenRouterConfigured(),
  );
  if (upgraded) {
    logger.info('[ai/task] vision upgrade for attachment turn', {
      spaceSlug,
      from: baseModel,
      to: turnModel,
    });
  }

  // Direct path — fast Q&A + multimodal summaries, fully in-process.
  if (route === 'direct') {
    logger.info('[ai/task] router → direct', { spaceSlug, model: turnModel });
    return streamDirectTurn({
      spaceId: ctx.space.id,
      userId: ctx.userId,
      conversationId,
      model: turnModel,
      userMessage: message,
      history: history.map((h) => ({ role: h.role, content: h.content })),
      attachments: turnAttachments,
      abortController,
      // Escalation hook — when the direct model's reply trips
      // shouldEscalate() ("I can't send that from here…"), re-run the SAME
      // message on the in-process TS agent (full tool surface) and pipe its
      // stream through. This was previously hardwired to `false`, so a
      // misrouted action committed the toolless deflection — the realtor
      // read that as "Chippi has no tools".
      onEscalate: async () => {
        logger.info('[ai/task] direct → agent escalation', { spaceSlug, model: turnModel });
        return streamTsChatTurn({
          ctx,
          conversationId,
          userMessage: message,
          history,
          model: turnModel,
          attachments: turnAttachments,
          abortController,
        });
      },
    });
  }

  // Agent path → Modal. Two ways in:
  //   1. CHIPPI_CHAT_RUNTIME=modal forces ALL agent turns through the sandbox.
  //      This is a deliberate deploy choice, so a missing MODAL_CHAT_URL is a
  //      misconfiguration we surface loudly (callModalAgent returns 503) rather
  //      than silently downgrading the whole deploy to the TS runtime.
  //   2. The realtor picked Agent mode for THIS message. Prefer Modal, but if
  //      MODAL_CHAT_URL is unset, degrade gracefully to the in-process TS agent
  //      (it has the full tool surface too) instead of failing the one turn.
  const forcedModal = chatRuntime() === 'modal';
  const perMessageModal = explicitMode === 'agent' && Boolean(process.env.MODAL_CHAT_URL);
  if (route === 'agent' && (forcedModal || perMessageModal)) {
    logger.info('[ai/task] router → agent (Modal)', { spaceSlug, explicitMode, forcedModal });
    return callModalAgent({
      ctx,
      conversationId,
      message,
      history,
      hydratedAttachments,
      abortController,
      spaceSlug,
    });
  }

  // ── Default: in-process TS runtime (PRIMARY) ─────────────────────────────
  // App-wide LLM client (OpenRouter-first), the realtor's workspace model,
  // full Chippi tool set, approval gates, rate limits, tool-call logging,
  // multimodal, and the delegate_task orchestrator. No Modal cold start —
  // first token is fast. Deep work is spawned ON Modal via delegate_task and
  // streamed back inline.
  logger.info('[ai/task] router → agent (in-process TS)', { spaceSlug, model: turnModel });
  return streamTsChatTurn({
    ctx,
    conversationId,
    userMessage: message,
    history,
    model: turnModel,
    attachments: turnAttachments,
    abortController,
  });
}

// ── Workspace model lookup ────────────────────────────────────────────────

/**
 * Resolve the chat model the realtor's workspace is configured for. The
 * direct path needs this BEFORE the LLM call (provider detection drives
 * multimodal encoding); the agent path reads it inside Modal so it doesn't
 * need this helper. Falls back to DEFAULT_CHAT_MODEL on any lookup failure.
 */
async function loadWorkspaceModel(spaceId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('AgentSettings')
      .select('"chatModel"')
      .eq('spaceId', spaceId)
      .maybeSingle();
    const m = (data as { chatModel?: string } | null)?.chatModel;
    return m && typeof m === 'string' && m.trim() ? m.trim() : DEFAULT_CHAT_MODEL;
  } catch {
    return DEFAULT_CHAT_MODEL;
  }
}

// ── Modal agent call (extracted so the router can call either path) ──────

interface CallModalAgentInput {
  ctx: ToolContext;
  conversationId: string;
  message: string;
  history: HistoryRow[];
  hydratedAttachments: AttachmentPayload[];
  abortController: AbortController;
  spaceSlug: string;
}

async function callModalAgent(input: CallModalAgentInput): Promise<Response> {
  const { ctx, conversationId, message, history, hydratedAttachments, abortController, spaceSlug } =
    input;

  const modalChatUrl = process.env.MODAL_CHAT_URL;
  if (!modalChatUrl) {
    logger.error('[ai/task] MODAL_CHAT_URL not set — cannot route to Modal sandbox', { spaceSlug });
    return NextResponse.json(
      { error: 'Agent backend not configured. Set MODAL_CHAT_URL.' },
      { status: 503 },
    );
  }

  const payload = {
    secret: process.env.AGENT_INTERNAL_SECRET ?? '',
    space_id: ctx.space.id,
    // Composio scopes connections per "entity" (Clerk userId). Without
    // this, Modal can't know which realtor's Gmail / Slack / etc. to
    // load — the agent ends up with zero integration tools regardless
    // of how many the realtor has connected. The Python side reads
    // `user_id` to look up active toolkits in IntegrationConnection
    // and load them via the Composio Python SDK.
    user_id: ctx.userId,
    message,
    history: history.map((h) => ({ role: h.role, content: h.content })),
    conversation_id: conversationId,
    attachments: hydratedAttachments,
  };

  let modalRes: Response;
  try {
    modalRes = await fetch(modalChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abortController.signal,
    });
  } catch (err) {
    logger.error('[ai/task] Modal fetch failed', { spaceSlug }, err);
    return NextResponse.json({ error: chippiErrorMessage('internal') }, { status: 502 });
  }

  if (!modalRes.ok || !modalRes.body) {
    const status = modalRes.status;
    logger.error('[ai/task] Modal returned error', { status, spaceSlug });
    return NextResponse.json({ error: chippiErrorMessage('internal') }, { status: 502 });
  }

  return proxyModalStream({
    modalBody: modalRes.body,
    spaceId: ctx.space.id,
    conversationId,
    abortController,
  });
}
