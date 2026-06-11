/**
 * /integrations/callback/team — where Composio redirects a manager after
 * a successful team-level OAuth flow.
 *
 * Mirrors the rep callback (/integrations/callback) but persists into
 * TeamIntegrationConnection scoped to the manager's team + their own
 * userId, and redirects back to /manager/integrations. Server component so the
 * persistence happens before the manager ever sees a UI flash.
 *
 * TIERED: requireManager() gates this — a rep_member landing here (they
 * never would, since they can't initiate) is bounced to /manager, which the
 * manager layout itself redirects away from non-managers.
 */

import { redirect } from 'next/navigation';
import { requireManager } from '@/lib/permissions';
import { auth } from '@clerk/nextjs/server';
import { getComposio } from '@/lib/integrations/composio';
import {
  upsertTeamByComposioId,
  findActiveTeamConnection,
  revokeTeamConnection,
} from '@/lib/integrations/team-connections';
import { findIntegration } from '@/lib/integrations/catalog';
import { logger } from '@/lib/logger';

export default async function TeamIntegrationsCallback({
  searchParams,
}: {
  searchParams: Promise<{ connected_account_id?: string; status?: string; app?: string }>;
}) {
  const sp = await searchParams;
  const { connected_account_id: connectedAccountId, status, app: appQuery } = sp;

  logger.info('[manager.integrations.callback] entered', {
    hasConnectedAccountId: Boolean(connectedAccountId),
    status: status ?? null,
    appQuery: appQuery ?? null,
  });

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    logger.warn('[manager.integrations.callback] no clerk session — redirecting to login');
    redirect('/login/rep');
  }

  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    logger.warn('[manager.integrations.callback] caller is not a manager — bouncing');
    redirect('/manager');
  }

  if (!connectedAccountId) {
    logger.warn('[manager.integrations.callback] missing connected_account_id', { sp });
    return redirect(buildBackUrl({ ok: false, reason: 'missing_account' }));
  }

  // Composio is the source of truth for what just connected.
  let toolkit: string | null = null;
  let label: string | null = null;
  try {
    const composio = getComposio();
    const account = await composio.connectedAccounts.get(connectedAccountId);
    toolkit = (account?.toolkit?.slug ?? appQuery ?? null) as string | null;
    label = pickLabel(account);
    logger.info('[manager.integrations.callback] account fetched', {
      connectedAccountId,
      toolkit,
      hasLabel: Boolean(label),
    });
  } catch (err) {
    logger.error('[manager.integrations.callback] account fetch failed', {
      connectedAccountId,
      err: err instanceof Error ? err.message : String(err),
    });
    toolkit = appQuery ?? null;
  }

  if (!toolkit) {
    return redirect(buildBackUrl({ ok: false, reason: 'unknown_toolkit' }));
  }
  if (!findIntegration(toolkit)) {
    logger.warn('[manager.integrations.callback] toolkit not in catalog', { toolkit });
    return redirect(buildBackUrl({ ok: false, reason: 'unsupported_toolkit' }));
  }

  const teamId = ctx.team.id;

  // Reconnect: revoke any prior active row for this triple before upsert.
  const existing = await findActiveTeamConnection({
    teamId,
    userId: clerkId,
    toolkit,
  });
  if (existing && existing.composioConnectionId !== connectedAccountId) {
    logger.info('[manager.integrations.callback] revoking prior active row before reconnect', {
      id: existing.id,
      toolkit,
    });
    await revokeTeamConnection(existing);
  }

  const inserted = await upsertTeamByComposioId({
    teamId,
    userId: clerkId,
    toolkit,
    composioConnectionId: connectedAccountId,
    label: label ?? undefined,
  });

  if (!inserted) {
    logger.error('[manager.integrations.callback] upsert returned null', {
      teamId,
      userId: clerkId,
      toolkit,
      connectedAccountId,
    });
    return redirect(buildBackUrl({ ok: false, reason: 'persist_failed', toolkit }));
  }

  if (status && status.toUpperCase() !== 'ACTIVE') {
    logger.warn('[manager.integrations.callback] composio returned non-active status', {
      connectedAccountId,
      status,
    });
    return redirect(buildBackUrl({ ok: false, reason: status, toolkit }));
  }

  return redirect(buildBackUrl({ ok: true, toolkit }));
}

interface CallbackResultArgs {
  ok: boolean;
  reason?: string;
  toolkit?: string;
}

function buildBackUrl(args: CallbackResultArgs): string {
  const params = new URLSearchParams();
  params.set('integration', args.ok ? 'connected' : 'failed');
  if (args.reason) params.set('reason', args.reason);
  if (args.toolkit) params.set('toolkit', args.toolkit);
  return `/manager/integrations?${params.toString()}`;
}

function pickLabel(account: unknown): string | null {
  if (!account || typeof account !== 'object') return null;
  const a = account as Record<string, unknown>;
  const fromTop =
    (typeof a.email === 'string' && a.email) ||
    (typeof a.username === 'string' && a.username) ||
    null;
  if (fromTop) return fromTop;
  const data = a.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const fromData =
      (typeof d.email === 'string' && d.email) ||
      (typeof d.username === 'string' && d.username) ||
      null;
    if (fromData) return fromData;
  }
  return null;
}
