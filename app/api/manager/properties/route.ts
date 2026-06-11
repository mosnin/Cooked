import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { logger } from '@/lib/logger';
import { _sanitisePropertyBody as sanitiseBody } from '@/app/api/properties/route';

/**
 * GET /api/manager/properties — the team's property pool.
 *
 * Lists every Property tagged with this team (`teamId`), newest
 * first, plus the roster of member spaces so the UI can render the
 * "assign to rep" control and resolve `assignedSpaceId` to a name.
 *
 * POST — create a pool property. It's owned by the manager owner's Space (so
 * the NOT NULL `spaceId` FK holds) and tagged with `teamId`; an optional
 * `assignedSpaceId` assigns it to a member rep on creation.
 *
 * Manager-only gate: `resolveManagerContext()` rejects rep_members.
 */

interface MemberSpace {
  id: string;
  name: string;
  ownerName: string | null;
}

/** The team's member spaces (every rep's Space under the team,
 *  plus the owner's own Space — the pool's home). Used to validate assignment
 *  targets and to label assigned properties. */
async function loadMemberSpaces(teamId: string, ownerId: string): Promise<MemberSpace[]> {
  const { data: spaces } = await supabase
    .from('Space')
    .select('id, name, ownerId')
    .or(`teamId.eq.${teamId},ownerId.eq.${ownerId}`)
    .limit(2000);
  const rows = (spaces ?? []) as { id: string; name: string; ownerId: string }[];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(new Set(rows.map((r) => r.ownerId)));
  const { data: users } = await supabase.from('User').select('id, name').in('id', ownerIds);
  const nameById = new Map((users ?? []).map((u) => [u.id as string, u.name as string | null]));

  return rows.map((r) => ({ id: r.id, name: r.name, ownerName: nameById.get(r.ownerId) ?? null }));
}

export async function GET() {
  const ctx = await resolveManagerContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const members = await loadMemberSpaces(ctx.team.id, ctx.team.ownerId);

  const { data, error } = await supabase
    .from('Property')
    .select('*')
    .eq('teamId', ctx.team.id)
    .order('updatedAt', { ascending: false })
    .limit(2000);
  if (error) {
    logger.error('[manager/properties/GET] query failed', { teamId: ctx.team.id }, error);
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }

  return NextResponse.json({ properties: data ?? [], members });
}

export async function POST(req: NextRequest) {
  const ctx = await resolveManagerContext();
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  // The pool's home Space — the manager owner's. Required because Property.spaceId
  // is NOT NULL. A manager with no personal Space can't seed the pool yet.
  const { data: ownerSpace } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', ctx.team.ownerId)
    .maybeSingle();
  if (!ownerSpace?.id) {
    return NextResponse.json(
      { error: 'Set up your own workspace before adding pool properties.' },
      { status: 409 },
    );
  }

  const { out, errors } = sanitiseBody(body, 'create');
  if (errors.length) return NextResponse.json({ error: errors.join(', ') }, { status: 400 });

  // Optional assignment on create — must be a space in this team.
  let assignedSpaceId: string | null = null;
  if (typeof body.assignedSpaceId === 'string' && body.assignedSpaceId) {
    const members = await loadMemberSpaces(ctx.team.id, ctx.team.ownerId);
    if (!members.some((m) => m.id === body.assignedSpaceId)) {
      return NextResponse.json({ error: 'That rep is not in your team.' }, { status: 400 });
    }
    assignedSpaceId = body.assignedSpaceId;
  }

  const insert = {
    id: crypto.randomUUID(),
    spaceId: ownerSpace.id as string,
    teamId: ctx.team.id,
    assignedSpaceId,
    listingStatus: out.listingStatus ?? 'active',
    photos: out.photos ?? [],
    ...out,
  };

  const { data, error } = await supabase.from('Property').insert(insert).select().single();
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'A property with that CRM number already exists' }, { status: 409 });
    }
    logger.error('[manager/properties/POST] insert failed', { teamId: ctx.team.id }, error);
    return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
