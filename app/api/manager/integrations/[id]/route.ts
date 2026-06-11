/**
 * DELETE /api/manager/integrations/[id] — disconnect (revoke) a team-level
 * connection.
 *
 * TIERED: gated via requireManager() (owner/admin only) AND ownership-scoped —
 * the row must belong to the caller's team AND to the caller's own
 * userId. A manager can't disconnect another member's connection by guessing
 * an id, and a rep_member can't reach this at all.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager, canEditSettings } from '@/lib/permissions';
import {
  getTeamConnectionById,
  revokeTeamConnection,
} from '@/lib/integrations/team-connections';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!canEditSettings(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the team owner or admins can manage integrations' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const row = await getTeamConnectionById(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership: the row must belong to this team AND this manager. Prevents
  // id-guessing across teams or across members.
  if (row.teamId !== ctx.team.id || row.userId !== clerkId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await revokeTeamConnection(row);
  return NextResponse.json({ ok: true });
}
