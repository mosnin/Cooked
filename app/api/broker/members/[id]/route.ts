import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireBroker } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/broker/members/[id]
 * Remove a member from the brokerage. Owner or admin can remove members.
 * The owner cannot remove themselves. Admins cannot remove other admins.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isOwner = ctx.membership.role === 'broker_owner';
  const isAdmin = ctx.membership.role === 'broker_admin';
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Only the owner or admins can remove members' }, { status: 403 });
  }

  const { id: membershipId } = await params;

  // Fetch the membership to validate it belongs to this brokerage
  const { data: membership } = await supabase
    .from('BrokerageMembership')
    .select('id, userId, role')
    .eq('id', membershipId)
    .eq('brokerageId', ctx.brokerage.id)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  if (membership.role === 'broker_owner') {
    return NextResponse.json({ error: 'Cannot remove the brokerage owner' }, { status: 400 });
  }

  // Admins can only remove realtors, not other admins
  if (isAdmin && membership.role === 'broker_admin') {
    return NextResponse.json({ error: 'Only the owner can remove admins' }, { status: 403 });
  }

  // Delete the membership — scope to brokerageId as well to prevent a TOCTOU
  // race between the fetch above and this write.
  const { error: deleteErr } = await supabase
    .from('BrokerageMembership')
    .delete()
    .eq('id', membershipId)
    .eq('brokerageId', ctx.brokerage.id);

  if (deleteErr) {
    console.error('[broker/members/delete] delete failed', deleteErr);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }

  // Record the removal in the deny-list so the removed agent can't silently
  // rejoin via the still-circulating join code. ON CONFLICT DO NOTHING via
  // upsert so re-removal doesn't error if the row already exists (defensive
  // for any race or replay path). Re-hire still works through an explicit
  // /api/invitations/[token] acceptance — that route doesn't consult this
  // table. A broker can rescind by deleting the row.
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
    .from('BrokerageRemoval')
    .upsert(
      {
        brokerageId: ctx.brokerage.id,
        userId: membership.userId,
        removedById: actorDbId,
      },
      { onConflict: 'brokerageId,userId' },
    );
  if (removalErr) {
    // Non-fatal: the membership is already deleted, so the visible
    // outcome the broker requested is done. Log so we can chase it.
    console.error('[broker/members/delete] removal deny-list insert failed', removalErr);
  }

  // Best-effort: unlink their Space from this brokerage
  await supabase
    .from('Space')
    .update({ brokerageId: null })
    .eq('ownerId', membership.userId)
    .eq('brokerageId', ctx.brokerage.id);

  void audit({ actorClerkId: clerkId ?? null, action: 'DELETE', resource: 'BrokerageMembership', resourceId: membershipId, metadata: { brokerageId: ctx.brokerage.id, removedUserId: membership.userId, role: membership.role } });

  return NextResponse.json({ success: true });
}
