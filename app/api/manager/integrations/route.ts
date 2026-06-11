/**
 * GET /api/manager/integrations
 *
 * List the calling manager's OWN team-level connections — one row per
 * (toolkit, status) the team integrations panel renders. Each admin/owner
 * sees only the accounts they personally connected at the team level
 * (they OAuth with their own grants).
 *
 * TIERED: gated via requireManager() (owner/admin only). A rep_member has
 * no manager_owner/manager_admin membership, so requireManager() throws and this
 * returns 403 — the connect/disconnect actions are never reachable for them.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager } from '@/lib/permissions';
import { listTeamConnectionsForUser } from '@/lib/integrations/team-connections';
import { composioConfigured } from '@/lib/integrations/composio';

export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const apiKeySet = composioConfigured();

  const all = await listTeamConnectionsForUser({
    teamId: ctx.team.id,
    userId: clerkId,
  });
  // Drop revoked rows — they're audit-only, not manager-facing.
  const visible = all.filter((c) => c.status !== 'revoked');

  const appUrlSet = Boolean(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL);
  const setup = {
    apiKeySet,
    appUrlSet,
    callbackUrl: appUrlSet
      ? `${(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '')}/integrations/callback/team`
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
      // Team-level connections don't register curated triggers yet, so
      // the watch affordance is always 'off' — the panel renders connect /
      // disconnect only, no pause toggle.
      triggers: 'off' as const,
    })),
  });
}
