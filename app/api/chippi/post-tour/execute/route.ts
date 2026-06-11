/**
 * POST /api/chippi/post-tour/execute
 *
 * Body: { proposals: { tool: string, args: Record<string, unknown> }[] }
 * Returns: { results: { tool, ok, summary, error? }[] }
 *
 * Runs each approved proposal serially through `executeTool` — the same
 * pipeline the chat agent uses, which means rate limits, zod validation,
 * and per-tool side effects all behave identically. Serial on purpose:
 * a misbehaving model can't fan out a wave of writes, and a partial
 * failure surfaces the exact tool that broke.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { checkRateLimit } from '@/lib/rate-limit';
import { executeTool } from '@/lib/ai-tools/execute';
import {
  POST_TOUR_TOOL_ALLOWLIST,
  POST_TOUR_INTEGRATION_SLUG_ALLOWLIST,
  doneVerbForToolkit,
} from '@/lib/chippi/post-tour';
import { activeToolkits } from '@/lib/integrations/connections';
import { composioConfigured, executeToolForEntity } from '@/lib/integrations/composio';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ExecuteBody {
  proposals?: unknown;
}

interface ProposalIn {
  tool: string;
  args: Record<string, unknown>;
  /** Toolkit slug if this came from a connected app (gmail, googlecalendar, ...). */
  integrationToolkit?: string;
}

interface ResultOut {
  tool: string;
  ok: boolean;
  summary: string;
  error?: string;
  /** Realtor-voice verb for the post-execute toast. Only set on success. */
  doneVerb?: string;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`chippi:post-tour-exec:${userId}`, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: ExecuteBody;
  try {
    body = (await req.json()) as ExecuteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.proposals) || body.proposals.length === 0) {
    return NextResponse.json({ error: 'No proposals' }, { status: 400 });
  }
  if (body.proposals.length > 10) {
    return NextResponse.json({ error: 'Too many proposals' }, { status: 413 });
  }

  // Sanitize the input. Native tools must be on the post-tour allowlist;
  // integration tools must reference a toolkit the realtor has actually
  // connected AND their slug must be on the integration-slug allowlist.
  // This route is a post-tour orchestrator, not a generic Composio
  // passthrough — `GMAIL_TRASH_EMAIL` and friends have no business here.
  const nativeAllow = new Set(POST_TOUR_TOOL_ALLOWLIST as readonly string[]);
  const integrationSlugAllow = new Set(
    POST_TOUR_INTEGRATION_SLUG_ALLOWLIST as readonly string[],
  );
  const connectedToolkits = composioConfigured()
    ? new Set(await activeToolkits({ spaceId: space.id, userId }))
    : new Set<string>();

  const proposals: ProposalIn[] = [];
  for (const p of body.proposals) {
    if (!p || typeof p !== 'object') continue;
    const tool = (p as { tool?: unknown }).tool;
    const args = (p as { args?: unknown }).args;
    const integrationToolkit = (p as { integrationToolkit?: unknown }).integrationToolkit;
    if (typeof tool !== 'string' || !tool) continue;
    if (args && typeof args !== 'object') continue;

    if (nativeAllow.has(tool)) {
      proposals.push({ tool, args: (args as Record<string, unknown>) ?? {} });
    } else if (
      typeof integrationToolkit === 'string' &&
      integrationToolkit &&
      connectedToolkits.has(integrationToolkit) &&
      integrationSlugAllow.has(tool)
    ) {
      // Integration proposal — accept only if (1) the realtor still has
      // that toolkit connected at execute time and (2) the slug is one
      // we explicitly support. A revoke between propose and execute, or a
      // model that drifted to an unsupported verb, both get dropped here.
      proposals.push({
        tool,
        args: (args as Record<string, unknown>) ?? {},
        integrationToolkit,
      });
    }
  }
  if (proposals.length === 0) {
    return NextResponse.json({ error: 'No valid proposals' }, { status: 400 });
  }

  const ctx = {
    userId,
    space: {
      id: space.id,
      slug: space.slug,
      name: space.name,
      ownerId: space.ownerId,
    },
    signal: AbortSignal.timeout(50_000),
  };

  const results: ResultOut[] = [];
  for (const p of proposals) {
    try {
      // Branch (a): the SDK already knows how to fire its own tools.
      // Native path stays on the imperative executor; integration path
      // calls Composio directly. Two surfaces, no shared adapter.
      if (p.integrationToolkit) {
        const resp = await executeToolForEntity({
          entityId: userId,
          slug: p.tool,
          arguments: p.args,
        });
        if (resp.successful) {
          // Log a CalendarEventMirror row when Chippi fires a calendar
          // create through Composio. The realtor's calendar is the
          // source of truth; this row is forensics — if they swap
          // providers later we still know what we put there.
          if (
            p.tool === 'GOOGLECALENDAR_CREATE_EVENT' &&
            (p.integrationToolkit === 'googlecalendar' ||
              p.integrationToolkit === 'outlook_calendar')
          ) {
            await logCalendarMirrorBestEffort({
              spaceId: space.id,
              provider: p.integrationToolkit,
              args: p.args,
              resp,
            });
          }
          const verb = doneVerbForToolkit(p.integrationToolkit) ?? 'done';
          results.push({
            tool: p.tool,
            ok: true,
            summary: verb,
            doneVerb: verb,
          });
        } else {
          results.push({
            tool: p.tool,
            ok: false,
            summary: resp.error ?? 'Failed',
            error: 'integration_error',
          });
        }
      } else {
        const exec = await executeTool(p.tool, p.args, ctx);
        if (exec.ok && exec.result) {
          results.push({ tool: p.tool, ok: true, summary: exec.result.summary });
        } else {
          results.push({
            tool: p.tool,
            ok: false,
            summary: exec.error?.message ?? 'Failed',
            error: exec.error?.code,
          });
        }
      }
    } catch (err) {
      logger.error('[chippi/post-tour/execute] tool threw', { tool: p.tool }, err);
      results.push({
        tool: p.tool,
        ok: false,
        summary: 'Unexpected error',
        error: 'handler_error',
      });
    }
  }

  return NextResponse.json({ results });
}

/**
 * Best-effort write of the mirror row for a successful Composio
 * GOOGLECALENDAR_CREATE_EVENT call. Pulls what we can out of the args
 * (which the realtor approved) + the response (which gives us the
 * Google event id). Never throws — the realtor's calendar already has
 * the event; the mirror is forensics only.
 */
async function logCalendarMirrorBestEffort(args: {
  spaceId: string;
  provider: 'googlecalendar' | 'outlook_calendar';
  args: Record<string, unknown>;
  resp: { data?: unknown };
}): Promise<void> {
  try {
    // Composio's arg shape is the same one the model proposed; pull the
    // canonical fields we wrote on the way out.
    const a = args.args;
    const title = typeof a.summary === 'string' ? a.summary : '(Untitled event)';
    const startsAt =
      typeof a.start_datetime === 'string'
        ? a.start_datetime
        : typeof a.startDateTime === 'string'
          ? a.startDateTime
          : null;
    const endsAt =
      typeof a.end_datetime === 'string'
        ? a.end_datetime
        : typeof a.endDateTime === 'string'
          ? a.endDateTime
          : null;
    if (!startsAt || !endsAt) return;

    const attendeesRaw = Array.isArray(a.attendees) ? a.attendees : [];
    const attendees = attendeesRaw
      .map((x) => x as { email?: string; displayName?: string; name?: string })
      .filter((x) => typeof x.email === 'string' && x.email)
      .map((x) => ({ email: x.email as string, name: x.displayName ?? x.name ?? null }));

    const data = (args.resp.data as { id?: string; eventId?: string } | undefined) ?? undefined;
    const externalEventId = data?.id ?? data?.eventId ?? null;

    await supabase.from('CalendarEventMirror').insert({
      spaceId: args.spaceId,
      externalProvider: args.provider,
      externalEventId,
      title,
      start: startsAt,
      end: endsAt,
      attendees,
      createdBy: 'agent',
    });
  } catch (err) {
    logger.warn(
      '[chippi/post-tour/execute] mirror insert failed',
      { spaceId: args.spaceId },
      err,
    );
  }
}
