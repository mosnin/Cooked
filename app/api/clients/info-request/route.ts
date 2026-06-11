import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getClientUser } from '@/lib/client-auth';
import { clientOwnsContact } from '@/lib/client-portal-data';
import { sendClientNotification } from '@/lib/client-email';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const MAX_RESPONSE = 2000;

/**
 * GET /api/clients/info-request?contactId=… — list info-requests on a contact
 * the client owns (pending + already fulfilled, newest first).
 */
export async function GET(req: NextRequest) {
  const user = await getClientUser();
  if (!user?.emailVerifiedAt) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  if (!(await clientOwnsContact(user.email, contactId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data } = await supabase
    .from('ClientInfoRequest')
    .select('id, message, status, response, createdAt, fulfilledAt')
    .eq('contactId', contactId)
    .neq('status', 'dismissed')
    .order('createdAt', { ascending: false });

  return NextResponse.json({ requests: data ?? [] });
}

/**
 * POST /api/clients/info-request — client responds to a pending request. Sets
 * the response + status='fulfilled' and notifies the realtor.
 */
export async function POST(req: NextRequest) {
  const user = await getClientUser();
  if (!user?.emailVerifiedAt) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { id?: string; response?: string };
  const id = body.id;
  const response = (body.response ?? '').trim();
  if (!id || response.length === 0) {
    return NextResponse.json({ error: 'id and a response are required' }, { status: 400 });
  }
  if (response.length > MAX_RESPONSE) {
    return NextResponse.json({ error: 'Response too long.' }, { status: 400 });
  }

  const { allowed } = await checkRateLimit(`clients:inforeq:${user.id}`, 20, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });

  // Load the request + verify ownership via its contact.
  const { data: reqRow } = await supabase
    .from('ClientInfoRequest')
    .select('id, contactId, status, spaceId')
    .eq('id', id)
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const row = reqRow as { id: string; contactId: string; status: string; spaceId: string };

  if (!(await clientOwnsContact(user.email, row.contactId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (row.status !== 'pending') {
    return NextResponse.json({ error: 'Already answered.' }, { status: 409 });
  }

  const { error } = await supabase
    .from('ClientInfoRequest')
    .update({ response, status: 'fulfilled', fulfilledAt: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    logger.error('[clients/info-request] update failed', { id }, error);
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 });
  }

  // Notify the realtor (best-effort).
  const { data: space } = await supabase
    .from('Space')
    .select('ownerId')
    .eq('id', row.spaceId)
    .maybeSingle();
  const ownerId = (space as { ownerId?: string | null } | null)?.ownerId;
  if (ownerId) {
    const { data: owner } = await supabase.from('User').select('email').eq('id', ownerId).maybeSingle();
    const ownerEmail = (owner as { email?: string | null } | null)?.email;
    if (ownerEmail) {
      void sendClientNotification({
        to: ownerEmail,
        subject: 'A client answered your request',
        heading: 'Request answered',
        body: `${user.name ?? user.email} responded to your information request.`,
      });
    }
  }

  return NextResponse.json({ ok: true });
}
