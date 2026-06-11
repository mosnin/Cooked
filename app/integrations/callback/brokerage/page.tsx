/**
 * /integrations/callback/brokerage — where Composio redirects a broker after
 * a successful brokerage-level OAuth flow.
 *
 * Mirrors the realtor callback (/integrations/callback) but persists into
 * BrokerageIntegrationConnection scoped to the broker's brokerage + their own
 * userId, and redirects back to /broker/integrations. Server component so the
 * persistence happens before the broker ever sees a UI flash.
 *
 * TIERED: requireBroker() gates this — a realtor_member landing here (they
 * never would, since they can't initiate) is bounced to /broker, which the
 * broker layout itself redirects away from non-brokers.
 */

import { redirect } from 'next/navigation';
import { requireBroker } from '@/lib/permissions';
import { auth } from '@clerk/nextjs/server';
import { getComposio } from '@/lib/integrations/composio';
import {
  upsertBrokerageByComposioId,
  findActiveBrokerageConnection,
  revokeBrokerageConnection,
} from '@/lib/integrations/brokerage-connections';
import { findIntegration } from '@/lib/integrations/catalog';
import { logger } from '@/lib/logger';

export default async function BrokerageIntegrationsCallback({
  searchParams,
}: {
  searchParams: Promise<{ connected_account_id?: string; status?: string; app?: string }>;
}) {
  const sp = await searchParams;
  const { connected_account_id: connectedAccountId, status, app: appQuery } = sp;

  logger.info('[broker.integrations.callback] entered', {
    hasConnectedAccountId: Boolean(connectedAccountId),
    status: status ?? null,
    appQuery: appQuery ?? null,
  });

  const { userId: clerkId } = await auth();
  if (!clerkId) {
    logger.warn('[broker.integrations.callback] no clerk session — redirecting to login');
    redirect('/login/realtor');
  }

  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    logger.warn('[broker.integrations.callback] caller is not a broker — bouncing');
    redirect('/broker');
  }

  if (!connectedAccountId) {
    logger.warn('[broker.integrations.callback] missing connected_account_id', { sp });
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
    logger.info('[broker.integrations.callback] account fetched', {
      connectedAccountId,
      toolkit,
      hasLabel: Boolean(label),
    });
  } catch (err) {
    logger.error('[broker.integrations.callback] account fetch failed', {
      connectedAccountId,
      err: err instanceof Error ? err.message : String(err),
    });
    toolkit = appQuery ?? null;
  }

  if (!toolkit) {
    return redirect(buildBackUrl({ ok: false, reason: 'unknown_toolkit' }));
  }
  if (!findIntegration(toolkit)) {
    logger.warn('[broker.integrations.callback] toolkit not in catalog', { toolkit });
    return redirect(buildBackUrl({ ok: false, reason: 'unsupported_toolkit' }));
  }

  const brokerageId = ctx.brokerage.id;

  // Reconnect: revoke any prior active row for this triple before upsert.
  const existing = await findActiveBrokerageConnection({
    brokerageId,
    userId: clerkId,
    toolkit,
  });
  if (existing && existing.composioConnectionId !== connectedAccountId) {
    logger.info('[broker.integrations.callback] revoking prior active row before reconnect', {
      id: existing.id,
      toolkit,
    });
    await revokeBrokerageConnection(existing);
  }

  const inserted = await upsertBrokerageByComposioId({
    brokerageId,
    userId: clerkId,
    toolkit,
    composioConnectionId: connectedAccountId,
    label: label ?? undefined,
  });

  if (!inserted) {
    logger.error('[broker.integrations.callback] upsert returned null', {
      brokerageId,
      userId: clerkId,
      toolkit,
      connectedAccountId,
    });
    return redirect(buildBackUrl({ ok: false, reason: 'persist_failed', toolkit }));
  }

  if (status && status.toUpperCase() !== 'ACTIVE') {
    logger.warn('[broker.integrations.callback] composio returned non-active status', {
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
  return `/broker/integrations?${params.toString()}`;
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
