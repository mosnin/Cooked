/**
 * POST /api/email/star
 *
 * Toggle the STARRED label on a Gmail message. Body:
 *   { slug, messageId, starred: boolean }
 *
 * Gmail's STARRED label IS the star — no local schema. Toggle calls add
 * or remove the label through Composio. The next list fetch picks up the
 * new state from the provider.
 *
 * Outlook isn't wired yet; the helper surfaces a clean error and the UI
 * leaves the row state alone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { findEmailConnection, setEmailStar } from '@/lib/communication/connect';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  let body: { slug?: unknown; messageId?: unknown; starred?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }
  const messageId = typeof body.messageId === 'string' ? body.messageId : '';
  if (!messageId) {
    return NextResponse.json({ error: 'messageId required' }, { status: 400 });
  }
  const starred = body.starred === true;

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const conn = await findEmailConnection(space.id);
  if (!conn) {
    return NextResponse.json(
      { error: 'Connect email first.' },
      { status: 400 },
    );
  }
  if (conn.toolkit !== 'gmail') {
    return NextResponse.json(
      { error: 'Starring is Gmail-only for now.' },
      { status: 400 },
    );
  }

  const result = await setEmailStar({
    entityId: conn.userId,
    provider: 'gmail',
    messageId,
    starred,
  });
  if (!result.ok) {
    logger.warn('[api/email/star] failed', {
      messageId,
      starred,
      error: result.error,
    });
    return NextResponse.json(
      { error: 'Could not update the star.' },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, starred });
}
