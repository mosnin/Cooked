/**
 * POST /api/email/send
 *
 * Send an email through the realtor's connected provider. Reuses the
 * shared validator + send helper from `lib/communication/*` — channel is
 * implied to be email here.
 *
 * Body: { slug, to, subject, body, cc?, bcc?, inReplyToId? }
 *
 * Gmail in v1. Outlook send is rejected with a clean error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import {
  findEmailConnection,
  sendEmailThrough,
} from '@/lib/communication/connect';
import { validateSendPayload } from '@/lib/communication/validation';
import { withObservability } from '@/lib/with-observability';

export const runtime = 'nodejs';
export const maxDuration = 30;

async function POSTHandler(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  // Force channel to 'email' so the validator picks the email shape — the
  // route is email-pure.
  const validated = validateSendPayload({ ...body, channel: 'email' });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  if (validated.value.channel !== 'email') {
    return NextResponse.json({ error: 'Expected email payload.' }, { status: 400 });
  }

  const conn = await findEmailConnection(space.id);
  if (!conn) {
    return NextResponse.json(
      { error: 'Connect email first.' },
      { status: 400 },
    );
  }
  if (conn.toolkit === 'outlook') {
    return NextResponse.json(
      { error: 'Outlook send isn’t supported yet. Connect Gmail to send.' },
      { status: 400 },
    );
  }

  const v = validated.value;
  const result = await sendEmailThrough({
    entityId: conn.userId,
    provider: 'gmail',
    to: v.to,
    cc: v.cc.length > 0 ? v.cc : undefined,
    bcc: v.bcc.length > 0 ? v.bcc : undefined,
    subject: v.subject,
    body: v.body,
  });
  if (!result.ok) {
    logger.warn('[api/email/send] failed', { error: result.error });
    return NextResponse.json(
      { error: 'That didn’t go through.' },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    externalMessageId: result.externalMessageId,
  });
}

export const POST = withObservability(POSTHandler, 'api.email.send');
