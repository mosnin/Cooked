/**
 * POST /api/admin/triggers/test-fire
 *
 * Operator-only: synthesise a fake-but-signed Composio webhook
 * delivery and POST it to our own /api/webhooks/composio receiver.
 *
 * The full trigger pipeline runs end-to-end: HMAC verify (real
 * signature, since we sign with the same secret the receiver checks),
 * dedupe, rate-cap, Inngest enqueue, handler dispatch. The realtor's
 * draft inbox gets a new row at the end if everything is wired.
 *
 * Use case — "my realtor says Chippi went quiet; is the pipe broken?"
 * Without this, an operator has to log into Composio's dashboard and
 * manually fire a trigger, or wait for real upstream activity. This
 * route closes that loop in seconds.
 *
 * Auth: Bearer ${CRON_SECRET}. Same gate as the backfill route.
 *
 * Body: {
 *   connectionId: string;         // IntegrationConnection.id
 *   triggerSlug: string;          // must be one of the connection's registered slugs
 *   payload?: Record<string, unknown>;  // shape-of-an-event; the templates' field-pickers act on this
 * }
 *
 * Returns: { receiverStatus, receiverBody, deliveryId }
 *   so the operator sees exactly what the receiver returned.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getById } from '@/lib/integrations/connections';
import { listTriggersForConnection } from '@/lib/integrations/triggers';
import { logger } from '@/lib/logger';
import { isPlatformAdmin } from '@/lib/permissions';

export const runtime = 'nodejs';
export const maxDuration = 30;

function bearerOk(header: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

interface TestFireBody {
  connectionId: string;
  triggerSlug: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  // Auth: a logged-in platform admin (honors the /api/admin/* invariant) OR a
  // valid CRON_SECRET bearer (ops/CLI invocation has no Clerk session). Either
  // is sufficient; both fail closed.
  if (!(await isPlatformAdmin())) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }
    if (!bearerOk(req.headers.get('Authorization'), cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const webhookSecret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: 'COMPOSIO_WEBHOOK_SECRET not set — receiver would reject any synthetic delivery' },
      { status: 500 },
    );
  }

  let body: TestFireBody;
  try {
    body = (await req.json()) as TestFireBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { connectionId, triggerSlug } = body;
  if (!connectionId || !triggerSlug) {
    return NextResponse.json(
      { error: 'Body must include { connectionId: string, triggerSlug: string }' },
      { status: 400 },
    );
  }

  // Resolve the connection. We won't fire for a connection that doesn't
  // exist on our side — the receiver would just drop the event and the
  // operator would see "no_connection" without understanding why.
  const connection = await getById(connectionId);
  if (!connection) {
    return NextResponse.json({ error: `IntegrationConnection ${connectionId} not found` }, { status: 404 });
  }

  // Resolve the trigger row so we have the composioTriggerId the
  // receiver expects. We need this ID specifically so the handler's
  // findByComposioTriggerId lookup hits.
  const triggers = await listTriggersForConnection(connectionId);
  const triggerRow = triggers.find((t) => t.triggerSlug === triggerSlug);
  if (!triggerRow) {
    return NextResponse.json(
      {
        error: `Trigger ${triggerSlug} is not registered for connection ${connectionId}. Available: ${triggers.map((t) => t.triggerSlug).join(', ') || '(none)'}`,
      },
      { status: 404 },
    );
  }
  if (!triggerRow.composioTriggerId) {
    return NextResponse.json(
      { error: `Trigger ${triggerSlug} has no composioTriggerId — it's likely in 'failed' status; reconnect first` },
      { status: 409 },
    );
  }

  // Build the IncomingTriggerPayload shape the SDK normalises to.
  // The receiver passes this through to the Inngest event, the
  // handler resolves connection + trigger from the metadata.* IDs.
  const deliveryId = `msg_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const incomingPayload = {
    id: deliveryId,
    uuid: randomUUID(),
    triggerSlug,
    toolkitSlug: connection.toolkit,
    userId: connection.userId,
    payload: body.payload ?? {},
    metadata: {
      id: triggerRow.composioTriggerId,
      uuid: randomUUID(),
      toolkitSlug: connection.toolkit,
      triggerSlug,
      triggerConfig: {},
      connectedAccount: {
        id: connection.composioConnectionId,
        uuid: randomUUID(),
        authConfigId: 'ac_test',
        authConfigUUID: randomUUID(),
        userId: connection.userId,
        status: 'ACTIVE' as const,
      },
    },
  };

  // The SDK's verifyWebhook expects a V3-style envelope. The
  // composio-CwcLLO7C.d.mts headers also reference V1/V2; for a
  // synthetic delivery, V3 is the cleanest shape since the SDK's
  // verify function normalises all three to the same
  // IncomingTriggerPayload. We pack it under a V3 envelope key.
  const rawBody = JSON.stringify({
    type: 'composio.trigger.message',
    timestamp: new Date().toISOString(),
    data: incomingPayload,
  });

  // HMAC-SHA256 the signature the same way Composio does. The signing
  // input is `${webhookId}.${webhookTimestamp}.${body}`; the
  // signature format is `v1,<base64>`. See
  // lib/integrations/composio.ts verifyTriggerWebhook for the
  // verify side.
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const signingInput = `${deliveryId}.${webhookTimestamp}.${rawBody}`;
  const signature = `v1,${createHmac('sha256', webhookSecret).update(signingInput).digest('base64')}`;

  // POST to our own receiver. Use the request's origin so we hit the
  // SAME deployment (prevents preview-vs-prod cross-talk during
  // smoke testing of a preview deploy).
  const origin = new URL(req.url).origin;
  const receiverUrl = `${origin}/api/webhooks/composio`;

  let receiverStatus: number;
  let receiverBody: unknown;
  try {
    const res = await fetch(receiverUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': deliveryId,
        'webhook-timestamp': webhookTimestamp,
        'webhook-signature': signature,
      },
      body: rawBody,
    });
    receiverStatus = res.status;
    receiverBody = await res.json().catch(() => null);
  } catch (err) {
    logger.error('[triggers.test-fire] receiver fetch threw', { deliveryId }, err);
    return NextResponse.json(
      {
        error: 'Receiver request failed before responding',
        cause: err instanceof Error ? err.message : String(err),
        deliveryId,
      },
      { status: 502 },
    );
  }

  logger.info('[triggers.test-fire] complete', {
    connectionId,
    triggerSlug,
    deliveryId,
    receiverStatus,
  });

  return NextResponse.json({
    receiverStatus,
    receiverBody,
    deliveryId,
    connectionId,
    triggerSlug,
    composioTriggerId: triggerRow.composioTriggerId,
  });
}
