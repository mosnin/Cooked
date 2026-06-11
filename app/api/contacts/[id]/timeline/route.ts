import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

/**
 * Returns system-generated timeline events for a contact:
 * - Demo bookings, confirmations, completions, cancellations
 * - Deal creation events
 * These are merged with manual activities on the client side.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id: contactId } = await params;

  // Get space first, then query contact scoped to that space to prevent
  // cross-tenant information disclosure.
  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: contact } = await supabase.from('Contact').select('spaceId').eq('id', contactId).eq('spaceId', space.id).maybeSingle();
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const events: Array<{
    id: string;
    kind: string;
    type: string;
    content: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }> = [];

  // Fetch demos for this contact
  const { data: demos } = await supabase
    .from('Demo')
    .select('id, startsAt, endsAt, status, propertyAddress, createdAt, updatedAt')
    .eq('contactId', contactId)
    .eq('spaceId', space.id)
    .order('startsAt', { ascending: false })
    .limit(50);

  for (const t of demos ?? []) {
    const dateStr = new Date(t.startsAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = new Date(t.startsAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Demo creation event
    events.push({
      id: `demo-${t.id}-created`,
      kind: 'demo',
      type: 'demo_scheduled',
      content: `Demo scheduled for ${dateStr} at ${timeStr}${t.propertyAddress ? ` — ${t.propertyAddress}` : ''}`,
      metadata: { demoId: t.id },
      createdAt: t.createdAt,
    });

    // Status events (if not still scheduled)
    if (t.status === 'confirmed') {
      events.push({
        id: `demo-${t.id}-confirmed`,
        kind: 'demo',
        type: 'demo_confirmed',
        content: `Demo confirmed for ${dateStr}`,
        metadata: { demoId: t.id },
        createdAt: t.updatedAt || t.createdAt,
      });
    } else if (t.status === 'completed') {
      events.push({
        id: `demo-${t.id}-completed`,
        kind: 'demo',
        type: 'demo_completed',
        content: `Demo completed${t.propertyAddress ? ` — ${t.propertyAddress}` : ''}`,
        metadata: { demoId: t.id },
        createdAt: t.updatedAt || t.createdAt,
      });
    } else if (t.status === 'cancelled') {
      events.push({
        id: `demo-${t.id}-cancelled`,
        kind: 'demo',
        type: 'demo_cancelled',
        content: 'Demo was cancelled',
        metadata: { demoId: t.id },
        createdAt: t.updatedAt || t.createdAt,
      });
    } else if (t.status === 'no_show') {
      events.push({
        id: `demo-${t.id}-noshow`,
        kind: 'demo',
        type: 'demo_no_show',
        content: 'Guest did not show up for the demo',
        metadata: { demoId: t.id },
        createdAt: t.updatedAt || t.createdAt,
      });
    }
  }

  // Fetch deals linked to this contact — scope to the user's space via the
  // joined Deal record to prevent cross-tenant data leakage.
  const { data: dealLinks } = await supabase
    .from('DealContact')
    .select('Deal(id, title, createdAt, address, spaceId)')
    .eq('contactId', contactId);

  for (const row of (dealLinks ?? []) as any[]) {
    // Only include deals belonging to the same space as the contact
    if (row.Deal && row.Deal.spaceId === space.id) {
      events.push({
        id: `deal-${row.Deal.id}-created`,
        kind: 'deal',
        type: 'deal_created',
        content: `Deal "${row.Deal.title}" created${row.Deal.address ? ` — ${row.Deal.address}` : ''}`,
        metadata: { dealId: row.Deal.id },
        createdAt: row.Deal.createdAt,
      });
    }
  }

  return NextResponse.json(events);
}
