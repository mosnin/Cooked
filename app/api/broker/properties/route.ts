import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { logger } from '@/lib/logger';
import { _sanitisePropertyBody as sanitiseBody } from '@/app/api/properties/route';

/**
 * GET /api/broker/properties — the brokerage's property pool.
 *
 * Lists every Property tagged with this brokerage (`brokerageId`), newest
 * first, plus the roster of member spaces so the UI can render the
 * "assign to realtor" control and resolve `assignedSpaceId` to a name.
 *
 * POST — create a pool property. It's owned by the broker owner's Space (so
 * the NOT NULL `spaceId` FK holds) and tagged with `brokerageId`; an optional
 * `assignedSpaceId` assigns it to a member realtor on creation.
 *
 * Broker-only gate: `resolveBrokerContext()` rejects realtor_members.
 */

interface MemberSpace {
  id: string;
  name: string;
  ownerName: string | null;
}

/** The brokerage's member spaces (every realtor's Space under the brokerage,
 *  plus the owner's own Space — the pool's home). Used to validate assignment
 *  targets and to label assigned properties. */
async function loadMemberSpaces(brokerageId: string, ownerId: string): Promise<MemberSpace[]> {
  const { data: spaces } = await supabase
    .from('Space')
    .select('id, name, ownerId')
    .or(`brokerageId.eq.${brokerageId},ownerId.eq.${ownerId}`)
    .limit(2000);
  const rows = (spaces ?? []) as { id: string; name: string; ownerId: string }[];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)));
  const { data: users } = await supabase.from('User').select('id, name').in('id', ownerIds);
  const nameById = new Map((users ?? []).map((u) => [u.id as string, u.name as string | null]));

  return rows.map((r) => ({ id: r.id, name: r.name, ownerName: nameById.get(r.ownerId) ?? null }));
}

export async function GET() {
  const ctx = await resolveBrokerContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const members = await loadMemberSpaces(ctx.brokerage.id, ctx.brokerage.ownerId);

  const { data, error } = await supabase
    .from('Property')
    .select('*')
    .eq('brokerageId', ctx.brokerage.id)
    .order('updatedAt', { ascending: false })
    .limit(2000);
  if (error) {
    logger.error('[broker/properties/GET] query failed', { brokerageId: ctx.brokerage.id }, error);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }

  return NextResponse.json({ properties: data ?? [], members });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveBrokerContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  // The pool's home Space — the broker owner's. Required because Property.spaceId
  // is NOT NULL. A broker with no personal Space can't seed the pool yet.
  const { data: ownerSpace } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', ctx.brokerage.ownerId)
    .maybeSingle();
  if (!ownerSpace?.id) {
    return NextResponse.json(
      { error: 'Set up your own workspace before adding pool properties.' },
      { status: 409 },
    );
  }

  const { out, errors } = sanitiseBody(body, 'create');
  if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });

  // Optional assignment on create — must be a space in this brokerage.
  let assignedSpaceId: string | null = null;
  if (typeof body.assignedSpaceId === 'string' && body.assignedSpaceId) {
    const members = await loadMemberSpaces(ctx.brokerage.id, ctx.brokerage.ownerId);
    if (!members.some((m) => m.id === body.assignedSpaceId)) {
      return NextResponse.json({ error: 'That realtor is not in your brokerage.' }, { status: 400 });
    }
    assignedSpaceId = body.assignedSpaceId;
  }

  const insert = {
    id: crypto.randomUUID(),
    spaceId: ownerSpace.id as string,
    brokerageId: ctx.brokerage.id,
    assignedSpaceId,
    listingStatus: out.listingStatus ?? 'active',
    photos: out.photos ?? [],
    ...out,
  };

  const { data, error } = await supabase.from('Property').insert(insert).select().single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A property with that MLS number already exists' }, { status: 409 });
    }
    logger.error('[broker/properties/POST] insert failed', { brokerageId: ctx.brokerage.id }, error);
    return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
