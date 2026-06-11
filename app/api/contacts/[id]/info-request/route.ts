import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireContactAccess } from '@/lib/api-auth';
import { sendClientNotification } from '@/lib/client-email';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const MAX_MESSAGE = 1000;

/**
 * POST /api/contacts/[id]/info-request — realtor asks a client to send
 * information. Creates a pending ClientInfoRequest and emails the client. The
 * client answers from their portal (see /api/clients/info-request).
 *
 * Realtor auth via requireContactAccess (the protected-system pattern) — the
 * realtor must own the space the contact belongs to.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const auth = await requireContactAccess(contactId);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const message = (body.message ?? '').trim();
  if (message.length === 0) {
    return NextResponse.json({ error: 'Describe what you need.' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: 'Too long.' }, { status: 400 });
  }

  const { allowed } = await checkRateLimit(`contacts:inforeq:${userId}`, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  const { data: inserted, error } = await supabase
    .from('ClientInfoRequest')
    .insert({ contactId, spaceId: space.id, message, status: 'pending' })
    .select('id, message, status, response, createdAt, fulfilledAt')
    .single();
  if (error) {
    logger.error('[contacts/info-request] insert failed', { contactId }, error);
    return NextResponse.json({ error: 'Failed to create request.' }, { status: 500 });
  }

  // Notify the client by their contact email (best-effort).
  const { data: contact } = await supabase
    .from('Contact')
    .select('email')
    .eq('id', contactId)
    .maybeSingle();
  const email = (contact as { email?: string | null } | null)?.email;
  if (email) {
    void sendClientNotification({
      to: email,
      subject: `${space.name ?? 'Your agent'} needs some information`,
      heading: 'A quick request',
      body: message,
      ctaLabel: 'Respond in your portal',
    });
  }

  return NextResponse.json({ request: inserted }, { status: 201 });
}
