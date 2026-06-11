/**
 * /integrations/callback — where Composio redirects the realtor after a
 * successful OAuth flow.
 *
 * Composio's redirect URL accepts `connected_account_id` + (sometimes)
 * `status` + `app` query params. We:
 *   1. Look up the connected account on Composio's side
 *   2. Persist an IntegrationConnection row with toolkit + composio id
 *   3. Redirect the realtor back into the app — settings, ideally onto
 *      the integrations panel — with a success/error flag in the URL.
 *
 * Server component so the persistence happens before the realtor ever
 * sees a UI flash.
 *
 * Every branch logs through `logger.info` / `logger.warn` / `logger.error`
 * with `[integrations.callback]` so production logs tell us exactly which
 * step failed when a realtor reports "I connected at the provider but the
 * row didn't show up." The previous implementation logged only on the
 * SDK-fetch path; every other failure mode redirected silently and made
 * post-mortem impossible.
 */

import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { getComposio } from '@/lib/integrations/composio';
import { upsertByComposioId, findActive, revoke } from '@/lib/integrations/connections';
import { findIntegration } from '@/lib/integrations/catalog';
import { registerForConnection } from '@/lib/integrations/triggers';
import { logger } from '@/lib/logger';

export default async function IntegrationsCallback({
  searchParams,
}: {
  searchParams: Promise<{ connected_account_id?: string; status?: string; app?: string }>;
}) {
  const sp = await searchParams;
  const { connected_account_id: connectedAccountId, status, app: appQuery } = sp;

  logger.info('[integrations.callback] entered', {
    hasConnectedAccountId: Boolean(connectedAccountId),
    status: status ?? null,
    appQuery: appQuery ?? null,
  });

  const { userId } = await auth();
  if (!userId) {
    logger.warn('[integrations.callback] no clerk session — redirecting to login');
    redirect('/login/realtor');
  }

  if (!connectedAccountId) {
    logger.warn('[integrations.callback] missing connected_account_id query param', { sp });
    return redirect(buildBackUrl({ ok: false, reason: 'missing_account' }));
  }

  // Resolve the realtor's space — we won't ship without it.
  const dbUserId = await getDbUserId(userId);
  if (!dbUserId) {
    logger.error('[integrations.callback] db user not found for clerk id', { clerkId: userId });
    return redirect(buildBackUrl({ ok: false, reason: 'no_space' }));
  }

  const { data: spaceRow, error: spaceErr } = await supabase
    .from('Space')
    .select('id, slug, ownerId')
    .eq('ownerId', dbUserId)
    .maybeSingle();
  if (spaceErr) {
    logger.error('[integrations.callback] space lookup failed', {
      dbUserId,
      err: spaceErr.message,
    });
    return redirect(buildBackUrl({ ok: false, reason: 'no_space' }));
  }
  const space = (spaceRow ?? null) as { id: string; slug: string } | null;
  if (!space) {
    logger.warn('[integrations.callback] no space owned by user', { dbUserId, clerkId: userId });
    return redirect(buildBackUrl({ ok: false, reason: 'no_space' }));
  }

  // Composio is the source of truth for what just connected. We pull
  // the toolkit slug from there rather than trust the query param.
  let toolkit: string | null = null;
  let label: string | null = null;
  let accountFetchError: string | null = null;
  let accountStatus: string | null = null;
  try {
    const composio = getComposio();
    const account = await composio.connectedAccounts.get(connectedAccountId);
    toolkit = (account?.toolkit?.slug ?? appQuery ?? null) as string | null;
    label = pickLabel(account);
    accountStatus = ((account as { status?: string } | null)?.status ?? null);
    logger.info('[integrations.callback] account fetched', {
      connectedAccountId,
      toolkit,
      hasLabel: Boolean(label),
      accountStatus,
    });
  } catch (err) {
    accountFetchError = err instanceof Error ? err.message : String(err);
    logger.error('[integrations.callback] account fetch failed', {
      connectedAccountId,
      err: accountFetchError,
    });
    // Fall back to ?app= if Composio's get() failed but the URL hint exists.
    toolkit = appQuery ?? null;
  }

  if (!toolkit) {
    logger.warn('[integrations.callback] no toolkit could be resolved', {
      connectedAccountId,
      appQuery,
      accountFetchError,
    });
    return redirect(
      buildBackUrl({ ok: false, reason: 'unknown_toolkit', slug: space.slug }),
    );
  }

  // Reject toolkits we don't have in our catalog so a stray callback
  // doesn't write an orphan row.
  if (!findIntegration(toolkit)) {
    logger.warn('[integrations.callback] toolkit not in catalog', { toolkit });
    return redirect(buildBackUrl({ ok: false, reason: 'unsupported_toolkit', slug: space.slug }));
  }

  // Reconnect: revoke any prior active row for this triple before we
  // insert the new one. Same invariant the connect route holds.
  const existing = await findActive({ spaceId: space.id, userId, toolkit });
  if (existing) {
    logger.info('[integrations.callback] revoking prior active row before reconnect', {
      id: existing.id,
      toolkit,
    });
    await revoke(existing);
  }

  // Upsert by composioConnectionId — the connect route already inserted a
  // 'pending' row with this id at initiate-time. Promote to 'active' ONLY
  // when Composio's FETCHED account status confirms ACTIVE — the previous
  // version trusted an optional ?status= query param (which Composio doesn't
  // reliably send) and force-activated everything, so abandoned OAuth flows
  // produced permanently-"active" rows whose tools 401'd in chat. If the
  // account fetch itself failed, the realtor still landed back here via the
  // provider redirect — strong signal OAuth completed — so we preserve the
  // old behavior and activate (the chat-time auth-error path self-corrects
  // a wrong guess by flipping the row to 'expired').
  const confirmedActive = accountStatus === null || accountStatus.toUpperCase() === 'ACTIVE';
  const inserted = await upsertByComposioId({
    spaceId: space.id,
    userId,
    toolkit,
    composioConnectionId: connectedAccountId,
    label: label ?? undefined,
    status: confirmedActive ? 'active' : 'pending',
  });

  if (!inserted) {
    logger.error('[integrations.callback] insertConnection returned null', {
      spaceId: space.id,
      userId,
      toolkit,
      connectedAccountId,
    });
    return redirect(buildBackUrl({ ok: false, reason: 'persist_failed', slug: space.slug, toolkit }));
  }

  logger.info('[integrations.callback] connection persisted', {
    id: inserted.id,
    toolkit,
    spaceId: space.id,
  });

  // Status gate — keyed on the FETCHED account status (authoritative), not
  // the optional ?status= query param. A non-ACTIVE account stays 'pending'
  // (the upsert above already wrote that) and the realtor lands back on
  // settings with the failure reason; the reconcile sweep promotes the row
  // if Composio later reports ACTIVE.
  if (!confirmedActive) {
    logger.warn('[integrations.callback] composio account not ACTIVE at callback', {
      connectedAccountId,
      accountStatus,
      statusParam: status ?? null,
    });
    return redirect(
      buildBackUrl({ ok: false, reason: accountStatus ?? 'not_active', slug: space.slug, toolkit }),
    );
  }

  // Register curated triggers ONLY after the connection is confirmed
  // ACTIVE. Registering against an INITIALIZING / FAILED connection
  // creates failed IntegrationTrigger rows the realtor would have to
  // clean up on reconnect. Best-effort: a failure here logs but does
  // NOT fail the OAuth completion (the connection itself succeeded).
  try {
    const result = await registerForConnection({ connection: inserted });
    if (result.failed > 0) {
      logger.warn('[integrations.callback] some triggers failed to register', {
        toolkit,
        connectionId: inserted.id,
        registered: result.registered,
        failed: result.failed,
      });
    }
  } catch (err) {
    logger.error(
      '[integrations.callback] trigger registration threw',
      { toolkit, connectionId: inserted.id },
      err,
    );
  }

  return redirect(buildBackUrl({ ok: true, slug: space.slug, toolkit }));
}

async function getDbUserId(clerkId: string): Promise<string | null> {
  const { data } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', clerkId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

interface CallbackResultArgs {
  ok: boolean;
  reason?: string;
  slug?: string;
  toolkit?: string;
}

function buildBackUrl(args: CallbackResultArgs): string {
  const base = args.slug ? `/s/${args.slug}/settings` : `/`;
  const params = new URLSearchParams();
  params.set('integration', args.ok ? 'connected' : 'failed');
  if (args.reason) params.set('reason', args.reason);
  if (args.toolkit) params.set('toolkit', args.toolkit);
  return `${base}?${params.toString()}#integrations`;
}

/**
 * Pull a realtor-friendly label from Composio's account payload — usually
 * the connected user's email. Falls back to whatever Composio surfaces
 * under common naming variants. If none exist, we leave it null and the
 * UI just shows "Connected".
 */
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
