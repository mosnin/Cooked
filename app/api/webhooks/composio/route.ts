/**
 * POST /api/webhooks/composio
 *
 * Composio's outbound webhook for trigger deliveries. Every delivery is
 * HMAC-SHA256-signed; the SDK verifies in-process. Setup:
 *
 *   1. Composio dashboard → Project Settings → Webhook → set the endpoint
 *      URL to https://<your-domain>/api/webhooks/composio.
 *   2. Copy the webhook signing secret into COMPOSIO_WEBHOOK_SECRET on
 *      Vercel (Production + Preview).
 *
 * Two layers of at-least-once delivery sit upstream of this route:
 * Composio retries on non-2xx, and Inngest retries inside our handler.
 * The receiver therefore MUST be idempotent on the webhook delivery id —
 * a Redis dedupe ring stops the second delivery before it reaches
 * Inngest. Without it, a noisy day would create duplicate drafts.
 *
 * The receiver returns 200 quickly (<100ms) and hands the actual work
 * to `lib/inngest/functions.ts:handleComposioTrigger`. Doing the dispatch
 * inline would tie up the Vercel function for the lifetime of a Modal
 * autonomous run — minutes — and Composio would time out and retry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyTriggerWebhook } from '@/lib/integrations/composio';
import { inngest } from '@/lib/inngest/client';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// 24h: longer than any reasonable Composio retry window. After this the
// dedupe key expires; a retry that arrived a day late would be processed
// (extremely unlikely, but we don't want to keep dedupe keys forever).
const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

// Per-(connection, slug) cap. A noisy Gmail account can fire 100s of
// triggers an hour; each DRAFT dispatch is a real Modal run, which costs
// real money. Above this cap we drop with a log. The realtor noticing
// "Chippi went quiet" is a much better failure mode than a 4-figure
// Modal bill from a single connected account.
const HOURLY_CAP_PER_TRIGGER = 60;
const RATE_WINDOW_SECONDS = 60 * 60;

const WEBHOOK_ID_HEADER = 'webhook-id';
const WEBHOOK_TIMESTAMP_HEADER = 'webhook-timestamp';
const WEBHOOK_SIGNATURE_HEADER = 'webhook-signature';

export async function POST(req: NextRequest) {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[composio-webhook] COMPOSIO_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const webhookId = req.headers.get(WEBHOOK_ID_HEADER);
  const webhookTimestamp = req.headers.get(WEBHOOK_TIMESTAMP_HEADER);
  const signature = req.headers.get(WEBHOOK_SIGNATURE_HEADER);
  if (!webhookId || !webhookTimestamp || !signature) {
    return NextResponse.json(
      { error: 'Missing webhook signature headers' },
      { status: 400 },
    );
  }

  const rawBody = await req.text();

  // Verify signature + timestamp tolerance via the SDK. Throws on invalid.
  let verified;
  try {
    verified = await verifyTriggerWebhook({
      webhookId,
      webhookTimestamp,
      signature,
      rawBody,
      secret,
    });
  } catch (err) {
    logger.warn('[composio-webhook] verification failed', {
      webhookId,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = verified.payload;

  // ── Dedupe ────────────────────────────────────────────────────────────
  // Composio retries on non-2xx. We also have Inngest's at-least-once
  // delivery inside the handler. The first hop's dedupe key uses Composio's
  // delivery id; the inner hop relies on the event being idempotent
  // downstream (the handler can be safely re-run on Inngest's retry).
  const dedupeKey = `composio:webhook:seen:${webhookId}`;
  const claimed = await redis.set(dedupeKey, '1', { nx: true, ex: DEDUPE_TTL_SECONDS });
  if (claimed === null) {
    // Already processed — return 200 so Composio stops retrying.
    logger.debug('[composio-webhook] duplicate delivery — skipped', {
      webhookId,
      triggerSlug: payload.triggerSlug,
    });
    return NextResponse.json({ received: true, deduped: true });
  }

  // ── Rate cap ──────────────────────────────────────────────────────────
  // Per-(connectedAccount, slug) per-hour. A chatty source can't burn
  // through Modal. Above the cap we drop with a log — the dedupe key is
  // already claimed so a Composio retry won't bypass this either.
  const connectedAccountId = payload.metadata.connectedAccount.id;
  const hourBucket = Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS);
  const rateKey = `composio:trigger:rate:${connectedAccountId}:${payload.triggerSlug}:${hourBucket}`;
  const count = (await redis.incr(rateKey)) as number;
  if (count === 1) {
    await redis.expire(rateKey, RATE_WINDOW_SECONDS);
  }
  if (count > HOURLY_CAP_PER_TRIGGER) {
    logger.warn('[composio-webhook] hourly cap exceeded — dropping', {
      connectedAccountId,
      triggerSlug: payload.triggerSlug,
      count,
      cap: HOURLY_CAP_PER_TRIGGER,
    });
    return NextResponse.json({ received: true, capped: true });
  }

  // Hand the verified, deduped, rate-capped delivery to Inngest. The
  // handler does the DB lookups and dispatch — that work can take
  // seconds and the receiver MUST return fast or Composio retries.
  try {
    await inngest.send({
      name: 'composio/trigger.received',
      data: {
        deliveryId: payload.id,
        triggerSlug: payload.triggerSlug,
        toolkitSlug: payload.toolkitSlug,
        composioConnectionId: connectedAccountId,
        composioTriggerId: payload.metadata.id,
        userId: payload.userId,
        payload: payload.payload ?? {},
      },
    });
  } catch (err) {
    // Release the dedupe key so Composio's retry can re-claim it —
    // otherwise the second delivery short-circuits at the dedupe gate
    // and the event is silently lost. The narrow race window (two
    // concurrent retries both seeing no claim) is acceptable because
    // Inngest itself is at-least-once at the function level; the
    // alternative (event lost forever) is much worse.
    await redis.del(dedupeKey).catch(() => null);
    logger.error('[composio-webhook] inngest send failed — dedupe released', { webhookId }, err);
    return NextResponse.json({ error: 'enqueue_failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
