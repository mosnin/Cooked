/**
 * DELETE /api/broker/integrations/[id] — disconnect (revoke) a brokerage-level
 * connection.
 *
 * TIERED: gated via requireBroker() (owner/admin only) AND ownership-scoped —
 * the row must belong to the caller's brokerage AND to the caller's own
 * userId. A broker can't disconnect another member's connection by guessing
 * an id, and a realtor_member can't reach this at all.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireBroker, canEditSettings } from '@/lib/permissions';
import {
  getBrokerageConnectionById,
  revokeBrokerageConnection,
} from '@/lib/integrations/brokerage-connections';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!canEditSettings(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the brokerage owner or admins can manage integrations' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const row = await getBrokerageConnectionById(id);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership: the row must belong to this brokerage AND this broker. Prevents
  // id-guessing across brokerages or across members.
  if (row.brokerageId !== ctx.brokerage.id || row.userId !== clerkId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await revokeBrokerageConnection(row);
  return NextResponse.json({ ok: true });
}
