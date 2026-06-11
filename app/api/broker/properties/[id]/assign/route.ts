import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/broker/properties/[id]/assign — assign a pool property to a member
 * realtor (or unassign it).
 *
 * Body: `{ assignedSpaceId: string | null }`. The property must belong to the
 * caller's brokerage; a non-null target must be a Space in that brokerage.
 * Once assigned, the realtor sees the property in their own workspace.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveBrokerContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { assignedSpaceId?: unknown } | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const target =
    body.assignedSpaceId === null || body.assignedSpaceId === ''
      ? null
      : typeof body.assignedSpaceId === 'string'
        ? body.assignedSpaceId
        : undefined;
  if (target === undefined) {
    return NextResponse.json({ error: 'assignedSpaceId must be a space id or null' }, { status: 400 });
  }

  // The property must be in this brokerage's pool.
  const { data: prop } = await supabase
    .from('Property')
    .select('id, brokerageId')
    .eq('id', id)
    .maybeSingle();
  if (!prop || (prop as { brokerageId?: string }).brokerageId !== ctx.brokerage.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // A non-null target must be a space inside this brokerage (a member's, or
  // the owner's own).
  if (target) {
    const { data: space } = await supabase
      .from('Space')
      .select('id, brokerageId, ownerId')
      .eq('id', target)
      .maybeSingle();
    const s = space as { brokerageId?: string; ownerId?: string } | null;
    const inBrokerage =
      s && (s.brokerageId === ctx.brokerage.id || s.ownerId === ctx.brokerage.ownerId);
    if (!inBrokerage) {
      return NextResponse.json({ error: 'That realtor is not in your brokerage.' }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from('Property')
    .update({ assignedSpaceId: target, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    logger.error('[broker/properties/assign] update failed', { brokerageId: ctx.brokerage.id, id }, error);
    return NextResponse.json({ error: 'Failed to assign property' }, { status: 500 });
  }

  return NextResponse.json(data);
}
