import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireContactAccess } from '@/lib/api-auth';
import { sendClientNotification } from '@/lib/client-email';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const MAX_BODY = 2000;

/**
 * GET /api/contacts/[id]/client-messages — realtor reads the client-portal
 * thread for one of their contacts. Marks client → realtor messages read.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const auth = await requireContactAccess(contactId);
  if (auth instanceof NextResponse) return auth;

  const { data } = await supabase
    .from('ClientMessage')
    .select('id, senderType, body, createdAt')
    .eq('contactId', contactId)
    .order('createdAt', { ascending: true });

  await supabase
    .from('ClientMessage')
    .update({ readAt: new Date().toISOString() })
    .eq('contactId', contactId)
    .eq('senderType', 'client')
    .is('readAt', null);

  return NextResponse.json({ messages: data ?? [] });
}

/**
 * POST /api/contacts/[id]/client-messages — realtor replies (senderType
 * 'realtor'). Notifies the client by their contact email (best-effort).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactId } = await params;
  const auth = await requireContactAccess(contactId);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  const body = (await req.json().catch(() => ({}))) as { body?: string };
  const text = (body.body ?? '').trim();
  if (text.length === 0) return NextResponse.json({ error: 'Write a message.' }, { status: 400 });
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'Message too long.' }, { status: 400 });

  const { allowed } = await checkRateLimit(`contacts:msg:${userId}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many messages.' }, { status: 429 });

  const { data: inserted, error } = await supabase
    .from('ClientMessage')
    .insert({ contactId, spaceId: space.id, senderType: 'realtor', body: text })
    .select('id, senderType, body, createdAt')
    .single();
  if (error) {
    logger.error('[contacts/client-messages] insert failed', { contactId }, error);
    return NextResponse.json({ error: 'Failed to send.' }, { status: 500 });
  }

  const { data: contact } = await supabase
    .from('Contact')
    .select('email')
    .eq('id', contactId)
    .maybeSingle();
  const email = (contact as { email?: string | null } | null)?.email;
  if (email) {
    void sendClientNotification({
      to: email,
      subject: `New message from ${space.name ?? 'your agent'}`,
      heading: 'You have a new message',
      body: 'Your agent replied in your portal.',
    });
  }

  return NextResponse.json({ message: inserted }, { status: 201 });
}
