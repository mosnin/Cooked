/**
 * GET /api/broker/integrations
 *
 * List the calling broker's OWN brokerage-level connections — one row per
 * (toolkit, status) the brokerage integrations panel renders. Each admin/owner
 * sees only the accounts they personally connected at the brokerage level
 * (they OAuth with their own grants).
 *
 * TIERED: gated via requireBroker() (owner/admin only). A realtor_member has
 * no broker_owner/broker_admin membership, so requireBroker() throws and this
 * returns 403 — the connect/disconnect actions are never reachable for them.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireBroker } from '@/lib/permissions';
import { listBrokerageConnectionsForUser } from '@/lib/integrations/brokerage-connections';
import { composioConfigured } from '@/lib/integrations/composio';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const apiKeySet = composioConfigured();

  const all = await listBrokerageConnectionsForUser({
    brokerageId: ctx.brokerage.id,
    userId: clerkId,
  });
  // Drop revoked rows — they're audit-only, not broker-facing.
  const visible = all.filter((c) => c.status !== 'revoked');

  const appUrlSet = Boolean(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL);
  const setup = {
    apiKeySet,
    appUrlSet,
    callbackUrl: appUrlSet
      ? `${(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '')}/integrations/callback/brokerage`
      : null,
  };

  return NextResponse.json({
    configured: apiKeySet,
    setup,
    connections: visible.map((c) => ({
      id: c.id,
      toolkit: c.toolkit,
      status: c.status,
      label: c.label,
      lastError: c.lastError,
      createdAt: c.createdAt,
      // Brokerage-level connections don't register curated triggers yet, so
      // the watch affordance is always 'off' — the panel renders connect /
      // disconnect only, no pause toggle.
      triggers: 'off' as const,
    })),
  });
}
