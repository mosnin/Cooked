/**
 * GET /api/calls/[id]?slug=<slug> — one call with transcript + summary.
 *
 * Auth: requireSpaceOwner(slug). The row is scoped to the caller's space, so a
 * caller can't read another workspace's call by guessing an id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const CALL_COLUMNS =
  'id, spaceId, contactId, direction, fromNumber, toNumber, telnyxCallId, status, recordingUrl, transcript, summary, durationSec, createdAt, updatedAt';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const { id } = await params;

  const { data, error } = await supabase
    .from('CallLog')
    .select(CALL_COLUMNS)
    .eq('id', id)
    .eq('spaceId', space.id)
    .maybeSingle();

  if (error) {
    logger.error('[calls] get failed', { id, err: error.message });
    return NextResponse.json({ error: 'Could not load the call.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ call: data });
}
