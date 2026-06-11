/**
 * GET /api/agent/brief/sections?slug=xxx
 *
 * Returns the PIPELINE + OVERNIGHT shapes for the redesigned daily-brief
 * surface. These two sections aren't part of the composed Brief payload
 * — they're state-of-the-business roll-ups computed on every page load
 * (cheap reads against the realtor's own DB).
 *
 * YOUR DAY (today's calendar events) is fetched by the client from the
 * existing /api/calendar/events route — that endpoint already has a 60s
 * memoization layer in front of the Composio call, so calling it twice
 * (once for /chippi/calendar, once for /chippi/brief) is cheap.
 *
 * Returns `{ pipeline: PipelineSummary | null, overnight: OvernightSummary | null }`.
 * Either may be null — the surface omits the corresponding section silently.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import {
  composePipelineSummary,
  composeOvernight,
  type PipelineSummary,
  type OvernightSummary,
} from '@/lib/briefing/sections';

export const runtime = 'nodejs';

interface Payload {
  pipeline: PipelineSummary | null;
  overnight: OvernightSummary | null;
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const [pipeline, overnight] = await Promise.all([
    composePipelineSummary(space.id).catch(() => null),
    composeOvernight(space.id).catch(() => null),
  ]);

  const payload: Payload = { pipeline, overnight };
  return NextResponse.json(payload);
}
