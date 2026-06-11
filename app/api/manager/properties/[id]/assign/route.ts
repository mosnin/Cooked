import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { logger } from '@/lib/logger';

/**
 * PATCH /api/manager/properties/[id]/assign — assign a pool property to a member
 * rep (or unassign it).
 *
 * Body: `{ assignedSpaceId: string | null }`. The property must belong to the
 * caller's team; a non-null target must be a Space in that team.
 * Once assigned, the rep sees the property in their own workspace.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveManagerContext();
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

  // The property must be in this team's pool.
  const { data: prop } = await supabase
    .from('Property')
    .select('id, teamId')
    .eq('id', id)
    .maybeSingle();
  if (!prop || (prop as { teamId?: string }).teamId !== ctx.team.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // A non-null target must be a space inside this team (a member's, or
  // the owner's own).
  if (target) {
    const { data: space } = await supabase
      .from('Space')
      .select('id, teamId, ownerId')
      .eq('id', target)
      .maybeSingle();
    const s = space as { teamId?: string; ownerId?: string } | null;
    const inTeam =
      s && (s.teamId === ctx.team.id || s.ownerId === ctx.team.ownerId);
    if (!inTeam) {
      return NextResponse.json({ error: 'That rep is not in your team.' }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from('Property')
    .update({ assignedSpaceId: target, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    logger.error('[manager/properties/assign] update failed', { teamId: ctx.team.id, id }, error);
    return NextResponse.json({ error: 'Failed to assign property' }, { status: 500 });
  }

  return NextResponse.json(data);
}
