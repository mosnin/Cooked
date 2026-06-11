/**
 * Mock calls — Axil practice sessions.
 *
 *   GET  ?slug=<slug>                          → { sessions }  a space's mock calls, newest first
 *   POST { slug, icpId, scenario? }            → { session }   start a live mock call against an ICP
 *
 * Auth: requireSpaceOwner(slug) — the workspace owner (or a managing
 * manager_owner/manager_admin), same posture as /api/calls.
 *
 * Creating a session just inserts a 'live' MockCall row; no LLM call happens
 * until the rep takes their first turn (POST /api/mock-calls/[id]). The ICP must
 * be visible to the space (its own or a seeded default) — never trust the body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { getIcp } from '@/lib/mock-calls/icp';
import { listSessions, createSession } from '@/lib/mock-calls/session';

export const runtime = 'nodejs';

// ── GET — the space's mock calls, newest first ───────────────────────────────

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  try {
    const sessions = await listSessions(supabase, space.id);
    return NextResponse.json({ sessions });
  } catch (err) {
    logger.error('[mock-calls] list failed', {
      spaceId: space.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not load your practice calls.' }, { status: 500 });
  }
}

// ── POST — start a mock call ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: { slug?: string; icpId?: string; scenario?: string | null };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = payload.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  // A human starts a handful of practice calls — clamp loops/abuse.
  const { allowed } = await checkRateLimit(`mock-calls:start:${userId}`, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  const icpId = payload.icpId?.trim();
  if (!icpId) return NextResponse.json({ error: 'Pick a profile to practice against.' }, { status: 400 });

  try {
    // The ICP must be visible to this space (its own, or a seeded default).
    const icp = await getIcp(supabase, space.id, icpId);
    if (!icp) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });

    const session = await createSession(supabase, {
      spaceId: space.id,
      userId,
      icp,
      scenario: payload.scenario ?? null,
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    logger.error('[mock-calls] create failed', {
      spaceId: space.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not start the practice call.' }, { status: 500 });
  }
}
