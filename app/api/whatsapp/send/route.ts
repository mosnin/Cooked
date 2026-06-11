/**
 * POST /api/whatsapp/send
 *
 * Send a WhatsApp message through the realtor's Business account. Body:
 *   { slug, to, body }
 *
 * Channel is implied. The shared validator's whatsapp branch is what
 * checks phone shape + body length.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import {
  findWhatsAppConnection,
  sendWhatsAppThrough,
} from '@/lib/communication/connect';
import { validateSendPayload } from '@/lib/communication/validation';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
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

  const validated = validateSendPayload({ ...body, channel: 'whatsapp' });
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  if (validated.value.channel !== 'whatsapp') {
    return NextResponse.json({ error: 'Expected whatsapp payload.' }, { status: 400 });
  }

  const conn = await findWhatsAppConnection(space.id);
  if (!conn) {
    return NextResponse.json(
      { error: 'Connect WhatsApp first.' },
      { status: 400 },
    );
  }

  const v = validated.value;
  const result = await sendWhatsAppThrough({
    entityId: conn.userId,
    to: v.to,
    body: v.body,
  });
  if (!result.ok) {
    logger.warn('[api/whatsapp/send] failed', { error: result.error });
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
