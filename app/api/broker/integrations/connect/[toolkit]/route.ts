/**
 * POST /api/broker/integrations/connect/[toolkit]
 *
 * Initiate an OAuth connection for the calling broker (owner/admin) + the
 * given toolkit, scoped to the BROKERAGE rather than their personal realtor
 * workspace. Returns the URL the broker's browser should redirect to so
 * Composio can run the auth flow. After approval, Composio sends them back to
 * /integrations/callback/brokerage with the connected-account id.
 *
 * TIERED: gated via requireBroker() + canEditSettings(role) — owner/admin
 * only. A realtor_member can't reach a broker context, so this 403s for them.
 *
 * Mirrors the realtor connect route (app/api/integrations/connect/[toolkit]):
 * we persist the row HERE at initiate-time using Composio's `request.id`, so
 * the connection survives a dropped OAuth round-trip. Only the storage table
 * and scoping (brokerageId + this broker's userId) differ. The Composio
 * plumbing (initiateConnection) is shared, not forked.
 *
 * Composio scopes connections per "entity". We use the brokerage-namespaced
 * entity id `brokerage:<brokerageId>:<userId>` so a broker's brokerage-level
 * Gmail is a DISTINCT Composio connection from their personal realtor Gmail
 * (which uses the bare Clerk userId as the entity).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireBroker, canEditSettings } from '@/lib/permissions';
import { COMING_SOON_TOOLKITS, findIntegration } from '@/lib/integrations/catalog';
import { initiateConnection } from '@/lib/integrations/composio';
import {
  findActiveBrokerageConnection,
  insertBrokerageConnection,
  revokeBrokerageConnection,
} from '@/lib/integrations/brokerage-connections';
import { brokerageEntityId } from '@/lib/integrations/brokerage-entity';
import { logger } from '@/lib/logger';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ toolkit: string }> },
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
      { error: 'Only the brokerage owner or admins can connect integrations' },
      { status: 403 },
    );
  }

  const { toolkit } = await params;
  const app = findIntegration(toolkit);
  if (!app) {
    return NextResponse.json({ error: `Unknown integration: ${toolkit}` }, { status: 404 });
  }

  if (COMING_SOON_TOOLKITS.has(toolkit)) {
    return NextResponse.json(
      { error: `${app.name} support is in progress. We will let you know when it lands.` },
      { status: 501 },
    );
  }

  const brokerageId = ctx.brokerage.id;
  const entityId = brokerageEntityId({ brokerageId, userId: clerkId });

  // Reconnect is the broker explicitly choosing a fresh auth — revoke any
  // existing active row for this combo first so the unique-active index stays
  // clean.
  const existing = await findActiveBrokerageConnection({
    brokerageId,
    userId: clerkId,
    toolkit,
  });
  if (existing) {
    await revokeBrokerageConnection(existing);
  }

  const callbackUrl = brokerageCallbackUrl();

  try {
    const request = await initiateConnection({ entityId, toolkit, callbackUrl });

    const inserted = await insertBrokerageConnection({
      brokerageId,
      userId: clerkId,
      toolkit,
      composioConnectionId: request.id,
    });
    if (!inserted) {
      logger.error('[broker.integrations.connect] persist-at-connect failed', {
        brokerageId,
        userId: clerkId,
        toolkit,
        composioConnectionId: request.id,
      });
      return NextResponse.json(
        { error: `Could not save the ${app.name} connection. Try again.` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      redirectUrl: request.redirectUrl,
      connectionId: request.id,
      toolkit,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[broker.integrations.connect] initiate failed', {
      brokerageId,
      userId: clerkId,
      toolkit,
      err: message,
    });
    const isActionable = message.startsWith('No Auth Config');
    const surfaced = isActionable
      ? message
      : `Could not start ${app.name} connect. Try again in a moment.`;
    return NextResponse.json({ error: surfaced }, { status: 502 });
  }
}

/**
 * The URL Composio sends the broker to after OAuth completes. Distinct from
 * the realtor callback (`/integrations/callback`) so the callback handler
 * knows to persist into the brokerage table, not the realtor one.
 */
function brokerageCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (!base) {
    logger.error(
      '[broker.integrations.connect] NEXT_PUBLIC_APP_URL is not set — Composio will redirect to its default URL after OAuth, not back to this app.',
    );
    return undefined;
  }
  return `${base.replace(/\/$/, '')}/integrations/callback/brokerage`;
}
