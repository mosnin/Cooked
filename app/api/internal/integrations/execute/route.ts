/**
 * POST /api/internal/integrations/execute — internal endpoint for the
 * Chippi agent (Modal/Python). Authed by AGENT_INTERNAL_SECRET.
 *
 * Executes ONE Composio action by slug for a (spaceId, userId). The Modal
 * dispatcher's call_integration_tool POSTs here; the sibling /search route
 * powers find_integration_tool. Both exist because Modal egress IPs vary
 * (Composio's IP allowlist accepts Vercel and may reject Modal), so the
 * agent proxies every Composio touch through Next.js.
 *
 * Response shape: { ok: boolean, data?: unknown, error?: string,
 * composio?: { code, statusCode, errorId, requestId, possibleFixes } }.
 * The Python side passes the JSON straight back to the model as the tool
 * result; the model uses `composio.possibleFixes` to self-correct on
 * recoverable errors and surfaces `requestId` to the realtor if they
 * need to file a Composio support ticket.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeToolForEntity, composioConfigured } from '@/lib/integrations/composio';
import { checkRateLimit } from '@/lib/rate-limit';
import { userOwnsSpace } from '@/lib/space';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const secret = process.env.AGENT_INTERNAL_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'Server misconfigured' }, { status: 500 });
  }
  if (req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (!composioConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Integrations are not configured.' },
      { status: 503 },
    );
  }

  let body: {
    spaceId?: unknown;
    userId?: unknown;
    slug?: unknown;
    arguments?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const spaceId = typeof body.spaceId === 'string' ? body.spaceId : '';
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const slug = typeof body.slug === 'string' ? body.slug : '';
  const args =
    body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments)
      ? (body.arguments as Record<string, unknown>)
      : {};
  if (!spaceId || !userId || !slug) {
    return NextResponse.json(
      { ok: false, error: 'spaceId, userId, and slug are required' },
      { status: 400 },
    );
  }

  // The bearer secret authenticates Modal, not the (spaceId, userId) pair in
  // the body. Verify the user actually owns the space BEFORE the rate-limit so
  // a mismatched pair can't charge another workspace's budget (or, via execute,
  // act under the wrong space's bucket). Composio itself is keyed by userId, so
  // this is defense-in-depth on top of that.
  if (!(await userOwnsSpace(spaceId, userId))) {
    return NextResponse.json({ ok: false, error: 'space/user mismatch' }, { status: 403 });
  }

  // Per-space cap — the bearer secret authenticates Modal, but a runaway
  // agent loop firing send/post actions has real cost (Twilio SMS, fal
  // generation, etc. each charge per call). 300/hour is well above any
  // legitimate chat session (a busy agent runs 20-30 tool calls per turn,
  // 10-15 turns per chat = ~300 calls per hour at maximum).
  const rl = await checkRateLimit(`integrations:execute:${spaceId}`, 300, 3600);
  if (!rl.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many tool executions for this workspace.' },
      { status: 429 },
    );
  }

  let result: unknown;
  try {
    result = await executeToolForEntity({
      entityId: userId,
      slug,
      arguments: args,
    });
  } catch (err) {
    // Composio throws `ComposioError` which carries way more than `.message`:
    //   - .code        (e.g. 'TOOL_VERSION_REQUIRED', 'CONNECTION_NOT_FOUND')
    //   - .statusCode  (HTTP)
    //   - .errorId     (Composio's internal id for the error class)
    //   - .cause       (the raw API body — { error: { code, message,
    //                   request_id, slug, suggested_fix } })
    //   - .possibleFixes (pre-baked actionable hints, e.g. "set
    //                   version: 'latest' or dangerouslySkipVersionCheck")
    // Flattening to .message strips every clue the model would need to
    // self-correct. Surface the lot — the agent gets the actionable hint,
    // the realtor gets the request_id for Composio support.
    const e = err as {
      message?: string;
      code?: string;
      statusCode?: number;
      errorId?: string;
      cause?: unknown;
      possibleFixes?: string[];
    };
    const causeBody =
      e.cause && typeof e.cause === 'object' ? (e.cause as Record<string, unknown>) : undefined;
    const requestId = (causeBody as { error?: { request_id?: string } } | undefined)?.error
      ?.request_id;
    logger.warn('[integrations.execute] tool execution threw', {
      spaceId,
      userId,
      slug,
      err: e.message,
      code: e.code,
      statusCode: e.statusCode,
      errorId: e.errorId,
      requestId,
      possibleFixes: e.possibleFixes,
      cause: causeBody,
    });
    return NextResponse.json(
      {
        ok: false,
        error: `Composio error: ${slug} — ${e.message ?? 'unknown'}`,
        composio: {
          code: e.code,
          statusCode: e.statusCode,
          errorId: e.errorId,
          requestId,
          possibleFixes: e.possibleFixes,
        },
      },
      { status: 200 }, // 200 + ok:false so the agent surfaces a clean error to the model
    );
  }

  // Composio's ToolExecuteResponse: { successful, error, data, logId,
  // sessionInfo: { requestId } }. Normalize to {ok, data, error, composio}
  // and KEEP the requestId so the realtor (and Chippi) can mention it if
  // they need to file a support ticket.
  const r = (result || {}) as {
    successful?: boolean;
    error?: unknown;
    data?: unknown;
    logId?: string;
    sessionInfo?: { requestId?: string };
  };
  const ok = r.successful !== false;
  const errMsg = r.error
    ? typeof r.error === 'string'
      ? r.error
      : JSON.stringify(r.error)
    : undefined;

  // Slack `channel_not_found` happens when the realtor names a channel the
  // workspace doesn't have. The default behaviour (model retries with a
  // different channel) silently picks one — we never want that. List the
  // workspace's channels, find the closest match, and surface a "did you
  // mean" so the realtor (or Chippi) can pick the real one explicitly.
  let finalError = ok ? undefined : `Composio error: ${slug} — ${errMsg ?? 'failed'}`;
  if (!ok && slug === 'SLACK_SEND_MESSAGE' && errMsg && /channel[_\s]?not[_\s]?found/i.test(errMsg)) {
    const requested = typeof (args as Record<string, unknown>).channel === 'string'
      ? ((args as Record<string, unknown>).channel as string)
      : '';
    let suggestion = '';
    try {
      const channelsResp = await executeToolForEntity({
        entityId: userId,
        slug: 'SLACK_LIST_ALL_CHANNELS',
        arguments: { limit: 100 },
      });
      // Composio returns the slack response as { data: { channels: [{name, id, ...}] } }
      // or nested under data.data depending on the toolkit version — handle both.
      const wrapper = (channelsResp ?? {}) as { data?: unknown };
      const inner = (wrapper.data ?? {}) as { channels?: unknown; data?: { channels?: unknown } };
      const channels = (Array.isArray(inner.channels)
        ? inner.channels
        : Array.isArray(inner.data?.channels)
          ? inner.data!.channels
          : []) as Array<{ name?: unknown }>;
      const names = channels
        .map((c) => (typeof c?.name === 'string' ? c.name : ''))
        .filter((n) => n.length > 0);
      if (names.length > 0) {
        const want = requested.toLowerCase().replace(/^#/, '');
        // Cheap prefix/substring match — Levenshtein adds a dependency for
        // the same realtor-readable outcome on 99% of typos.
        const close = names.find((n) => n.toLowerCase() === want)
          ?? names.find((n) => n.toLowerCase().startsWith(want))
          ?? names.find((n) => n.toLowerCase().includes(want));
        if (close && requested) {
          suggestion = ` Did you mean #${close}?`;
        } else {
          const list = names.slice(0, 6).map((n) => `#${n}`).join(', ');
          suggestion = ` Channels in this workspace: ${list}.`;
        }
      }
    } catch {
      // Channel list fetch failed — surface the original error verbatim.
    }
    const reqLabel = requested ? `#${requested.replace(/^#/, '')}` : 'channel';
    finalError = `Channel ${reqLabel} not found.${suggestion}`;
  }

  return NextResponse.json({
    ok,
    data: r.data ?? (ok ? result : undefined),
    error: finalError,
    composio: ok
      ? undefined
      : { logId: r.logId, requestId: r.sessionInfo?.requestId },
  });
}
