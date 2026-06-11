import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/manager/members/[id]
 * Remove a member from the team. Owner or admin can remove members.
 * The owner cannot remove themselves. Admins cannot remove other admins.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isOwner = ctx.membership.role === 'manager_owner';
  const isAdmin = ctx.membership.role === 'manager_admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Only the owner or admins can remove members' }, { status: 403 });
  }

  const { id: membershipId } = await params;

  // Fetch the membership to validate it belongs to this team
  const { data: membership } = await supabase
    .from('TeamMembership')
    .select('id, userId, role')
    .eq('id', membershipId)
    .eq('teamId', ctx.team.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  if (membership.role === 'manager_owner') {
    return NextResponse.json({ error: 'Cannot remove the team owner' }, { status: 400 });
  }

  // Admins can only remove reps, not other admins
  if (isAdmin && membership.role === 'manager_admin') {
    return NextResponse.json({ error: 'Only the owner can remove admins' }, { status: 403 });
  }

  // Delete the membership — scope to teamId as well to prevent a TOCTOU
  // race between the fetch above and this write.
  const { error: deleteErr } = await supabase
    .from('TeamMembership')
    .delete()
    .eq('id', membershipId)
    .eq('teamId', ctx.team.id);

  if (deleteErr) {
    console.error('[manager/members/delete] delete failed', deleteErr);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }

  // Record the removal in the deny-list so the removed agent can't silently
  // rejoin via the still-circulating join code. ON CONFLICT DO NOTHING via
  // upsert so re-removal doesn't error if the row already exists (defensive
  // for any race or replay path). Re-hire still works through an explicit
  // /api/invitations/[token] acceptance — that route doesn't consult this
  // table. A manager can rescind by deleting the row.
  //
  // Look up the actor's User.id so removedById is the DB id, not the Clerk
  // id. clerkId may be null in edge cases (auth() succeeded for ctx but the
  // separate auth() call above returned null) — log + skip the attribution
  // field rather than failing the removal.
  let actorDbId: string | null = null;
  if (clerkId) {
    const { data: actorUser } = await supabase
      .from('User')
      .select('id')
      .eq('clerkId', clerkId)
      .maybeSingle();
    actorDbId = (actorUser as { id?: string } | null)?.id ?? null;
  }
  const { error: removalErr } = await supabase
    .from('TeamRemoval')
    .upsert(
      {
        teamId: ctx.team.id,
        userId: membership.userId,
        removedById: actorDbId,
      },
      { onConflict: 'teamId,userId' },
    );
  if (removalErr) {
    // Non-fatal: the membership is already deleted, so the visible
    // outcome the manager requested is done. Log so we can chase it.
    console.error('[manager/members/delete] removal deny-list insert failed', removalErr);
  }

  // Best-effort: unlink their Space from this team
  await supabase
    .from('Space')
    .update({ teamId: null })
    .eq('ownerId', membership.userId)
    .eq('teamId', ctx.team.id);

  void audit({ actorClerkId: clerkId ?? null, action: 'DELETE', resource: 'TeamMembership', resourceId: membershipId, metadata: { teamId: ctx.team.id, removedUserId: membership.userId, role: membership.role } });

  return NextResponse.json({ success: true });
}
