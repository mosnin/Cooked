/**
 * Web push (VAPID) dispatch.
 *
 * Thin wrapper over the `web-push` library. Loads every PushSubscription for a
 * space and replays an encrypted payload to each one. Dead subscriptions
 * (404/410 from the push service) are pruned at send time.
 *
 * Gated on three env vars — with any of them missing this module cleanly
 * no-ops and warns, exactly like lib/sms.ts. It NEVER throws; a broken push
 * subscription can't be allowed to break the lead/tour/deal flow that calls it.
 *
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — the VAPID public key (also shipped to the
 *                                   browser so it can subscribe)
 *   VAPID_PRIVATE_KEY             — the VAPID private key (server only)
 *   VAPID_SUBJECT                 — a mailto: or https: contact URL for the
 *                                   push service (e.g. mailto:ops@usechippi.com)
 *
 * Generate a keypair with:  npx web-push generate-vapid-keys
 */

// NB: intentionally no `import 'server-only'` — this module is only ever
// imported server-side (notify.ts + API routes), and `server-only` isn't
// resolvable under vitest, which broke the tool-registry tests that reach this
// file transitively through notify.ts. Matches the sibling lib/sms.ts.
import webpush from 'web-push';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT;

/** True only when all three VAPID env vars are present. */
export function isPushConfigured(): boolean {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY && SUBJECT);
}

if (!isPushConfigured()) {
  logger.warn('[push] VAPID keys not fully set — web push notifications will be skipped', {
    publicKeySet: Boolean(PUBLIC_KEY),
    privateKeySet: Boolean(PRIVATE_KEY),
    subjectSet: Boolean(SUBJECT),
  });
}

let vapidReady = false;
function ensureVapid(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidReady) {
    try {
      webpush.setVapidDetails(SUBJECT!, PUBLIC_KEY!, PRIVATE_KEY!);
      vapidReady = true;
    } catch (err) {
      logger.error('[push] failed to set VAPID details', undefined, err);
      return false;
    }
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where to navigate when the notification is clicked. Defaults to the app root in the SW. */
  url?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Send a push notification to every subscribed device for a space.
 * No-ops (and warns) when VAPID env is missing. Never throws.
 *
 * Returns the number of notifications successfully handed to push services.
 */
export async function sendPushToSpace(spaceId: string, payload: PushPayload): Promise<number> {
  if (!ensureVapid()) {
    logger.warn('[push] skipped — VAPID not configured', { spaceId });
    return 0;
  }

  let rows: SubscriptionRow[] = [];
  try {
    const { data, error } = await supabase
      .from('PushSubscription')
      .select('id, endpoint, p256dh, auth')
      .eq('spaceId', spaceId);
    if (error) {
      logger.error('[push] failed to load subscriptions', { spaceId, err: error.message });
      return 0;
    }
    rows = (data ?? []) as SubscriptionRow[];
  } catch (err) {
    logger.error('[push] subscription query threw', { spaceId }, err);
    return 0;
  }

  if (rows.length === 0) {
    logger.debug('[push] no subscriptions for space', { spaceId });
    return 0;
  }

  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url });
  const dead: string[] = [];
  let sent = 0;

  const results = await Promise.allSettled(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
        );
        return true;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        // 404 (Not Found) / 410 (Gone) mean the subscription is dead — prune it.
        if (status === 404 || status === 410) {
          dead.push(row.id);
        } else {
          logger.error('[push] send failed', { spaceId, status }, err);
        }
        throw err;
      }
    }),
  );

  for (const r of results) {
    if (r.status === 'fulfilled') sent += 1;
  }

  if (dead.length > 0) {
    try {
      await supabase.from('PushSubscription').delete().in('id', dead);
      logger.info('[push] pruned dead subscriptions', { spaceId, count: dead.length });
    } catch (err) {
      logger.error('[push] failed to prune dead subscriptions', { spaceId }, err);
    }
  }

  logger.info('[push] dispatch complete', { spaceId, sent, total: rows.length, pruned: dead.length });
  return sent;
}
