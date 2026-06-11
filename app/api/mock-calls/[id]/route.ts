/**
 * One mock call.
 *
 *   GET  /api/mock-calls/[id]?slug=<slug>                  → { session }
 *   POST /api/mock-calls/[id]  { slug, action: 'turn', message }  → { session, prospectReply }
 *   POST /api/mock-calls/[id]  { slug, action: 'end' }            → { session, scoreError? }
 *
 * Auth: requireSpaceOwner(slug). The MockCall is loaded scoped to the caller's
 * space, so a caller can't read or drive another workspace's session by guessing
 * an id.
 *
 * A 'turn' appends the rep's line, asks Axil (the prospect) for an in-character
 * reply, and returns the grown transcript. If the prospect LLM fails, the call
 * stays 'live' and a 502 is returned with the rep's turn NOT lost — they can
 * retry. An 'end' grades the transcript (best-effort) and marks the call
 * 'completed'; a grading failure still completes the call and surfaces
 * `scoreError` so the UI can offer a re-grade.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { hasLLMKey } from '@/lib/llm';
import { getSession, addRepTurn, endSession } from '@/lib/mock-calls/session';

export const runtime = 'nodejs';

// ── GET — one session ────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const { id } = await params;

  try {
    const session = await getSession(supabase, space.id, id);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ session });
  } catch (err) {
    logger.error('[mock-calls] get failed', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not load the practice call.' }, { status: 500 });
  }
}

// ── POST — drive the session ('turn' | 'end') ────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let payload: { slug?: string; action?: string; message?: string };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = payload.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const action = payload.action === 'end' ? 'end' : payload.action === 'turn' ? 'turn' : null;
  if (!action) {
    return NextResponse.json(
      { error: 'action must be "turn" or "end"' },
      { status: 400 },
    );
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  const { id } = await params;

  // The prospect reply and the grader both call the model — gate on a key so we
  // fail clean (503) instead of throwing deep in the orchestrator.
  if (!hasLLMKey()) {
    return NextResponse.json(
      { error: 'Practice calls are not configured for this workspace yet.' },
      { status: 503 },
    );
  }

  // Per-user turn budget — a live call is interactive but still loop-bounded.
  const { allowed } = await checkRateLimit(`mock-calls:turn:${userId}`, 60, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Slow down a moment, then continue.' }, { status: 429 });
  }

  let session;
  try {
    session = await getSession(supabase, space.id, id);
  } catch (err) {
    logger.error('[mock-calls] load failed', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not load the practice call.' }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Lazy-import the LLM client so the heavy OpenAI SDK stays out of routes that
  // never reach this branch, mirroring lib/scoring/enhance.ts.
  const { getLLMClient } = await import('@/lib/llm');
  const openai = getLLMClient();

  if (action === 'turn') {
    try {
      const result = await addRepTurn(supabase, openai, {
        call: session,
        message: payload.message ?? '',
      });
      if (!result.ok) {
        // Bad input → 400; the prospect went quiet (LLM) → 502 with the call
        // still 'live'; a deleted ICP → 409.
        const status =
          result.code === 'empty' || result.code === 'not_live'
            ? 400
            : result.code === 'icp_missing'
              ? 409
              : 502;
        return NextResponse.json({ error: result.error, code: result.code }, { status });
      }
      return NextResponse.json({ session: result.call, prospectReply: result.prospectReply });
    } catch (err) {
      logger.error('[mock-calls] turn failed', {
        id,
        err: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json({ error: 'Could not send your message.' }, { status: 500 });
    }
  }

  // action === 'end'
  try {
    const result = await endSession(supabase, openai, { call: session });
    return NextResponse.json({ session: result.call, scoreError: result.scoreError });
  } catch (err) {
    logger.error('[mock-calls] end failed', {
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not end the practice call.' }, { status: 500 });
  }
}
