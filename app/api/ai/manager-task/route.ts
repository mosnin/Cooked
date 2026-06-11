/**
 * POST /api/ai/manager-task — manager chat surface streaming endpoint.
 *
 * Parallel to `app/api/ai/task/route.ts` (the rep chat surface) but
 * gated on manager access and dispatched to Modal with `mode: 'manager'`.
 * The shared SSE protocol is identical; the routes differ in auth and in
 * WHERE they persist.
 *
 * STORAGE IS STRUCTURALLY SEPARATE. Manager conversations + messages live in
 * their OWN tables — "ManagerConversation" / "ManagerMessage" — keyed by
 * `teamId`, NOT in the rep "Conversation"/"Message" tables. A rep
 * surface cannot read a manager row because the rows are not in the same table.
 *
 * RUNTIME SPACE vs. STORAGE. The Modal runtime still needs a `space_id` for
 * AgentSettings/usage/the agent run — that stays the manager owner's personal
 * Space (resolveRuntimeSpaceId). But it is RUNTIME-ONLY; no conversation or
 * message is ever written keyed by that space. If the runtime space can't be
 * resolved, the turn still persists to the manager tables.
 *
 * Defense layer 2 of three (per Koala-for-Managers Phase 1 spec):
 *
 *   1. ROUTE GUARD   — `app/manager/koala/page.tsx` server component
 *                      redirects when the caller isn't a manager.
 *   2. API GATE      — THIS ROUTE. `resolveManagerContext()` is the gate;
 *                      rep_member + non-manager + signed-out callers
 *                      all 403 here. The check fires BEFORE any DB writes,
 *                      Modal fetch, or rate-limit increment.
 *   3. TOOL-RUNTIME  — `agent/tools/manager/_guards.py:require_manager_role`
 *                      refuses tool execution unless AgentContext carries
 *                      a manager role (Phase 2/3 tools wrap every handler).
 *
 * Phase 1 ships zero manager tools, so this route exists to wire the pipe.
 * Phase 2/3 add tools by appending to `agent/tools/manager.MANAGER_TOOLS`;
 * the manager-task route itself does NOT need to change.
 */

import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { saveManagerUserMessage, saveManagerAssistantMessage } from '@/lib/agent/manager-persistence';
import { koalaErrorMessage } from '@/lib/ai-tools/koala-voice';
import { sanitizeUserInput } from '@/lib/agent/prompt-sanitizer';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import type { MessageBlock } from '@/lib/ai-tools/blocks';
import { auth } from '@clerk/nextjs/server';
import { decideManagerRoute } from '@/lib/chat/router';
import { streamManagerDirectTurn } from '@/lib/chat/manager-direct';
import { getTodayTokenUsage } from '@/lib/usage/today-token-usage';
import { isSubscriptionDelinquent } from '@/lib/api-auth';

// A Modal chat turn can run for minutes (multi-tool agentic reasoning). The
// proxy must outlive the Modal function (its timeout is 600s) or Vercel
// kills the stream mid-turn and the assistant message is lost.
export const runtime = 'nodejs';
export const maxDuration = 300;

interface HistoryRow {
  role: 'user' | 'assistant';
  content: string;
}

interface PostBody {
  conversationId?: string | null;
  message: string;
}

/** Cap on history messages fed to the model. Mirrors the rep route's
 *  HISTORY_LIMIT — Phase 1 PR #155 dropped that from 20 to 8 to stop
 *  paying for 12 stale turns every request; Phase 3 mirrors the same cut
 *  here. The manager chat surface answers about team state, not a
 *  many-turn conversation, so 8 is plenty. */
const HISTORY_LIMIT = 8;

/**
 * Resolve the manager owner's personal Space id — RUNTIME USE ONLY.
 *
 * The Modal runtime still needs a `space_id` for AgentSettings/usage/the agent
 * run. The manager owner's personal Space is the anchor. This is NOT where
 * conversations or messages are stored — those live in the manager tables keyed
 * by teamId. Returns null if the manager owner has no personal Space; the
 * caller treats that as a non-fatal "no runtime space" and still persists the
 * turn to the manager tables.
 */
async function resolveRuntimeSpaceId(teamOwnerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', teamOwnerId)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Find or create the ManagerConversation for this turn.
 *
 * If a conversationId is given, accept it ONLY when the ManagerConversation's
 * teamId matches this manager's team — a foreign id (another
 * team's, or a rep's, which won't even exist in this table) is
 * rejected and a fresh conversation is created instead. No spaceId, no title
 * prefix: the teamId column is the boundary.
 */
async function resolveConversation(
  teamId: string,
  conversationId: string | null | undefined,
): Promise<string> {
  if (conversationId) {
    const { data } = await supabase
      .from('ManagerConversation')
      .select('id, teamId')
      .eq('id', conversationId)
      .maybeSingle();
    if (data && data.teamId === teamId) {
      return conversationId;
    }
  }

  const id = crypto.randomUUID();
  const { error } = await supabase.from('ManagerConversation').insert({
    id,
    teamId,
    title: 'New conversation',
  });
  if (error) throw error;
  return id;
}

async function loadHistory(conversationId: string): Promise<HistoryRow[]> {
  const { data } = await supabase
    .from('ManagerMessage')
    .select('role, content, createdAt')
    .eq('conversationId', conversationId)
    .order('createdAt', { ascending: false })
    .limit(HISTORY_LIMIT);

  const rows = ((data ?? []) as Array<{ role: string; content: string }>).reverse();
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({
      role: r.role as 'user' | 'assistant',
      content: r.content,
    }));
}

// ---------------------------------------------------------------------------
// Modal SSE proxy — translates Modal's chat_turn events into the
// browser-facing protocol the manager chat client already speaks.
// Same event shape as the rep route.
// ---------------------------------------------------------------------------

interface ProxyModalStreamInput {
  modalBody: ReadableStream<Uint8Array>;
  teamId: string;
  conversationId: string;
  abortController: AbortController;
}

function proxyModalStream({
  modalBody,
  teamId,
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
      const blocks: MessageBlock[] = [];
      let persisted = false;
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
          await saveManagerAssistantMessage({ teamId, conversationId, blocks: toSave });
        } catch (err) {
          logger.warn('[ai/manager-task] persist assistant message failed', { teamId }, err);
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
              const callId =
                typeof evt.call_id === 'string' && evt.call_id
                  ? evt.call_id
                  : crypto.randomUUID();
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
              for (let i = blocks.length - 1; i >= 0; i--) {
                const b = blocks[i];
                if (b.type !== 'tool_call') continue;
                if (callId ? b.callId === callId : !b.result) {
                  b.result = { ok, summary };
                  b.status = ok ? 'complete' : 'error';
                  break;
                }
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
              await persistOnce();
              push(controller, { type: 'error', message: evt.message ?? 'Agent error' });
              sentTerminal = true;
            }
          }
        }

        // Flush trailing buffer.
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
          logger.error('[ai/manager-task] modal stream read error', { teamId }, err);
          push(controller, { type: 'error', message: koalaErrorMessage('internal') });
          sentTerminal = true;
        }
      } finally {
        // Safety net — ported from the rep route: a Modal crash / dropped
        // connection / container kill mid-stream previously ended this stream
        // with NO terminal frame, so the manager's EventSource hung open
        // forever. Persist whatever streamed and guarantee exactly one
        // terminal frame unless the client itself aborted.
        await persistOnce();
        if (!sentTerminal && !abortController.signal.aborted) {
          logger.warn('[ai/manager-task] modal stream ended with no terminal event', {
            teamId,
          });
          push(controller, { type: 'error', message: koalaErrorMessage('internal') });
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
  // ── Layer 2: API gate. Re-check manager context here even though the
  //    server-side page guard already redirected — a misconfigured
  //    client (custom fetch) must still 403 at the route boundary. ──
  const managerCtx = await resolveManagerContext();
  if (!managerCtx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    // resolveManagerContext returned non-null, which means a Clerk session
    // existed at that moment — but we still need the userId for the
    // Modal entity scope. A null between the two checks is a race; refuse.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
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

  const teamId = managerCtx.team.id;

  // Rate limits — independent counters, fired together (the rep route got
  // the same treatment). The per-team limiter is NEW: user- and IP-level
  // limits alone let a multi-admin team burst far past intent.
  const ip = getClientIp(req);
  const [userLimit, ipLimit, teamLimit] = await Promise.all([
    checkRateLimit(`ai:manager-task:${clerkUserId}`, 30, 3600),
    checkRateLimit(`chat:ip:${ip}`, 30, 600),
    checkRateLimit(`chat:team:${teamId}`, 60, 600),
  ]);
  if (!userLimit.allowed) {
    return NextResponse.json({ error: koalaErrorMessage('rate_limited') }, { status: 429 });
  }
  if (!ipLimit.allowed || !teamLimit.allowed) {
    return NextResponse.json(
      { error: koalaErrorMessage('rate_limited') },
      { status: 429, headers: { 'Retry-After': '600' } },
    );
  }

  // Dunning gate — a manager's seats are funded by the TEAM subscription, so
  // gate on the team's status. The rep route (app/api/ai/task) gates
  // its funding account too; manager-task previously had NO dunning gate, so a
  // lapsed Team kept full premium AI for every seat. Only past_due / canceled /
  // unpaid are gated; active / trialing / inactive pass. Platform admins bypass.
  // Fails OPEN so a DB hiccup can't lock out a paying team.
  try {
    const { data: bRow } = await supabase
      .from('Team')
      .select('stripeSubscriptionStatus')
      .eq('id', teamId)
      .maybeSingle();
    if (isSubscriptionDelinquent(bRow?.stripeSubscriptionStatus ?? 'inactive')) {
      const { data: userRow } = await supabase
        .from('User')
        .select('platformRole')
        .eq('clerkId', clerkUserId)
        .maybeSingle();
      if (userRow?.platformRole !== 'admin') {
        return NextResponse.json(
          {
            error:
              'Your team subscription needs attention — update the payment method in billing to keep using Koala. Your workspace and data stay available.',
          },
          { status: 402 },
        );
      }
    }
  } catch (err) {
    logger.warn(
      '[ai/manager-task] subscription status check failed — allowing turn',
      { teamId },
      err,
    );
  }

  // Runtime space — the manager owner's personal Space, needed ONLY for the
  // Modal agent run (AgentSettings/usage). It is NOT where the conversation or
  // messages are stored. A manager owner with no personal Space still gets a
  // working chat: the turn persists to the manager tables; only the Modal
  // settings/usage want a space, and the direct (in-process) path needs none.
  const runtimeSpaceId = await resolveRuntimeSpaceId(managerCtx.team.ownerId);

  // Route decision is pure — compute it BEFORE any persistence so an
  // agent-path precondition failure (Modal unconfigured, no runtime space)
  // can refuse cleanly. The previous order saved the user message first and
  // THEN 503'd, leaving an orphaned user message with no assistant reply in
  // the thread.
  const route = decideManagerRoute(message);
  if (route === 'agent') {
    if (!process.env.MODAL_CHAT_URL) {
      logger.error('[ai/manager-task] MODAL_CHAT_URL not set');
      return NextResponse.json(
        { error: 'Agent backend not configured. Set MODAL_CHAT_URL.' },
        { status: 503 },
      );
    }
    if (!runtimeSpaceId) {
      logger.warn('[ai/manager-task] no runtime space for agentic turn', { teamId });
      return NextResponse.json(
        { error: 'Manager actions are not available for this team yet.' },
        { status: 503 },
      );
    }

    // Daily token budget — gate against the runtime (funding) space, BEFORE
    // any persistence. Fails OPEN so a transient DB error can't block a
    // legitimate turn. Default matches the AgentSettings column default
    // (50_000) — same correction the rep route carries.
    try {
      const [settingsResult, usageResult] = await Promise.all([
        supabase
          .from('AgentSettings')
          .select('dailyTokenBudget')
          .eq('spaceId', runtimeSpaceId)
          .maybeSingle(),
        getTodayTokenUsage(runtimeSpaceId),
      ]);
      const dailyTokenBudget: number =
        ((settingsResult.data as { dailyTokenBudget?: number | null } | null)
          ?.dailyTokenBudget as number | null | undefined) ?? 50_000;
      if (usageResult.total >= dailyTokenBudget) {
        logger.warn('[ai/manager-task] daily token budget exceeded', {
          teamId,
          runtimeSpaceId,
          todayTokens: usageResult.total,
          dailyTokenBudget,
        });
        return NextResponse.json({ error: 'Daily token budget exceeded' }, { status: 429 });
      }
    } catch (err) {
      logger.warn('[ai/manager-task] token budget check failed — continuing', { teamId }, err);
    }
  }

  const abortController = new AbortController();

  let conversationId: string;
  try {
    conversationId = await resolveConversation(teamId, body.conversationId ?? null);
  } catch (err) {
    logger.error('[ai/manager-task] conversation resolve failed', { teamId }, err);
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 500 });
  }

  try {
    await saveManagerUserMessage({ teamId, conversationId, content: message });
  } catch (err) {
    logger.error('[ai/manager-task] save user message failed', { teamId }, err);
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 500 });
  }

  let history: HistoryRow[];
  try {
    history = await loadHistory(conversationId);
  } catch (err) {
    logger.warn(
      '[ai/manager-task] history load failed — continuing without it',
      { teamId },
      err,
    );
    history = [];
  }

  if (history.length > 0) {
    const last = history[history.length - 1];
    if (last.role === 'user' && last.content === message) history.pop();
  }

  // ── Router: Q&A in-process, actions to Modal ─────────────────────────────
  // Generic Q&A answers in-process from a live team snapshot — instant,
  // no Modal cold start. Everything manager-domain ("team health", "at-risk
  // agents", "reassign Maria's leads") goes to Modal where MANAGER_TOOLS lives.
  // decideManagerRoute = the shared rep router PLUS the manager noun set;
  // the plain decideRoute used to send manager-domain reads to the snapshot
  // path, whose prompt is instructed to say it doesn't have the answer —
  // managers read that as "Koala has no tools". Errors → Modal (safe default).
  if (route === 'direct') {
    logger.info('[ai/manager-task] router → direct (in-process)', { teamId });
    return streamManagerDirectTurn({
      team: managerCtx.team,
      // Runtime space is for usage recording only; null is fine (usage just
      // skips). The conversation/message persist goes to the manager tables.
      runtimeSpaceId,
      userId: clerkUserId,
      conversationId,
      userMessage: message,
      history: history.map((h) => ({ role: h.role, content: h.content })),
      abortController,
    });
  }

  // Modal dispatch. `mode: 'manager'` + team_id + manager_role tell
  // chat_turn to build the manager-variant agent (MANAGER_TOOLS, manager
  // system prompt) and refuse the request if those fields are missing.
  // Preconditions (MODAL_CHAT_URL, runtimeSpaceId) were verified BEFORE the
  // user message was persisted — see the route-decision block above.
  const modalChatUrl = process.env.MODAL_CHAT_URL as string;

  const payload = {
    secret: process.env.AGENT_INTERNAL_SECRET ?? '',
    space_id: runtimeSpaceId,
    user_id: clerkUserId,
    message,
    history: history.map((h) => ({ role: h.role, content: h.content })),
    conversation_id: conversationId,
    // ── Manager-mode fields — Modal's chat_turn reads these to dispatch
    //    to make_manager_agent() and to populate AgentContext for the
    //    per-tool require_manager_role() guard (defense layer 3). ──
    mode: 'manager' as const,
    team_id: teamId,
    manager_role: managerCtx.managerRole,
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
    logger.error('[ai/manager-task] Modal fetch failed', { teamId }, err);
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 502 });
  }

  if (!modalRes.ok || !modalRes.body) {
    const status = modalRes.status;
    logger.error('[ai/manager-task] Modal returned error', { status, teamId });
    return NextResponse.json({ error: koalaErrorMessage('internal') }, { status: 502 });
  }

  return proxyModalStream({
    modalBody: modalRes.body,
    teamId,
    conversationId,
    abortController,
  });
}
