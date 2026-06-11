/**
 * Slack signal source — polled at gather() time via Composio actions.
 *
 * Two signals only. Slack is thin for realtors — it's the brokerage
 * team's surface, not the client surface — so we resist surfacing every
 * channel message and reaction. The two that genuinely matter on a
 * realtor's morning:
 *
 *   1. Unread @-mention of the realtor in any channel, ≤18h old → reply
 *      urgency 1, confidence 0.88. A teammate explicitly tagged them;
 *      this is the only channel noise that earns a slot.
 *   2. Unread DM from a brokerage teammate, ≤18h old → reply urgency 2,
 *      confidence 0.80. DMs from strangers are dropped (cold outreach).
 *
 * Polled, not webhook-cached. Composio's `slack` triggers fire on every
 * channel post — too noisy to mirror locally. We pull at gather() time
 * with a 3s hard timeout. If Slack is slow or down, the brief skips
 * Slack rather than blocking the cron's per-space budget.
 *
 * The original design proposed a `SlackInboxItem` worker table cached
 * from webhooks. Skipped for v1 — polled is simpler and shippable now.
 * If Slack adoption justifies it later, the table becomes its own PR.
 *
 * Skip entirely if no active `slack` IntegrationConnection — return [].
 */

import { supabase } from '@/lib/supabase';
import { executeToolForEntity, composioConfigured } from '@/lib/integrations/composio';
import { logger } from '@/lib/logger';
import type { Signal, SignalGatherer } from '../types';

const TIMEOUT_MS = 3_000;
const STALE_HOURS = 18;
const STALE_MS = STALE_HOURS * 60 * 60 * 1000;
const MENTION_RE = /<@([A-Z0-9]+)>/g;

interface SlackConnection {
  userId: string;
  composioConnectionId: string;
}

interface SlackChannel {
  id: string;
  name?: string;
  is_im?: boolean;
  user?: string;
}

interface SlackMessage {
  ts?: string;
  user?: string;
  text?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: { real_name?: string; display_name?: string };
}

/**
 * Pull every `<@USERID>` token from a message body. Slack-rendered
 * mentions wrap the id in angle brackets with an @-prefix; bare `@name`
 * in the message body is just rendered text and means nothing here.
 */
export function extractMentions(text: string | undefined | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) out.push(m[1]);
  return out;
}

/**
 * Is the message addressed to the realtor? True only when the realtor's
 * own slackUserId appears in the mention tokens. Prevents surfacing
 * mentions of other teammates that happen to land in shared channels.
 */
export function mentionsRealtor(
  text: string | undefined | null,
  realtorSlackId: string | null,
): boolean {
  if (!realtorSlackId) return false;
  return extractMentions(text).includes(realtorSlackId);
}

/**
 * Does the DM sender belong to the realtor's known team? In Slack, every
 * user inside the realtor's workspace shows up in `users.list` — that's
 * "the team." DMs from anyone outside (Slack Connect cross-org DMs,
 * external bots) are dropped to avoid surfacing cold outreach.
 */
export function isTeammate(
  senderSlackId: string | undefined | null,
  teamUserIds: Set<string>,
): boolean {
  if (!senderSlackId) return false;
  return teamUserIds.has(senderSlackId);
}

/** Look up active slack connection for this space. Returns null when none. */
async function findSlackConnection(spaceId: string): Promise<SlackConnection | null> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('userId, composioConnectionId')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'slack')
    .eq('status', 'active')
    .maybeSingle();
  return (data as SlackConnection | null) ?? null;
}

/**
 * Wrap a Composio call in a hard 3s timeout. Slack polling is slow; if
 * the API doesn't respond fast enough, the brief skips Slack rather than
 * holding the gather() phase past the cron's budget. Returns null on
 * timeout or error — caller treats null as "no data, move on."
 */
async function callWithTimeout(
  entityId: string,
  slug: string,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
  try {
    return await Promise.race([executeToolForEntity({ entityId, slug, arguments: args }), timeout]);
  } catch (err) {
    logger.warn('[briefing.slack] composio call failed', {
      slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Composio's response shape varies (`data` flat vs nested under `data.data`)
 * depending on toolkit version. Try both, return whatever shape matches.
 */
function unwrap<T>(resp: unknown, key: string): T[] {
  if (!resp || typeof resp !== 'object') return [];
  const r = resp as { data?: unknown };
  const inner = (r.data ?? {}) as Record<string, unknown>;
  const directOuter = (resp as Record<string, unknown>)[key];
  const direct = inner[key];
  const nested = (inner.data as Record<string, unknown> | undefined)?.[key];
  for (const v of [direct, nested, directOuter]) {
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

function teammateDisplayName(user: SlackUser | undefined): string {
  if (!user) return 'A teammate';
  return (
    user.profile?.display_name?.trim() ||
    user.profile?.real_name?.trim() ||
    user.real_name?.trim() ||
    user.name?.trim() ||
    'A teammate'
  );
}

function formatLocalTime(ts: string): string {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds)) return '';
  const d = new Date(seconds * 1000);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export const slackSource: SignalGatherer = {
  source: 'slack',
  async gather(spaceId: string): Promise<Signal[]> {
    if (!composioConfigured()) return [];
    const conn = await findSlackConnection(spaceId);
    if (!conn) return [];

    const entityId = conn.userId;
    const cutoffMs = Date.now() - STALE_MS;
    const oldestTs = (cutoffMs / 1000).toFixed(6);

    const [channelsResp, usersResp, authResp] = await Promise.all([
      callWithTimeout(entityId, 'SLACK_LIST_ALL_CHANNELS', {
        types: 'public_channel,private_channel,im',
        limit: 200,
        exclude_archived: true,
      }),
      callWithTimeout(entityId, 'SLACK_LIST_ALL_USERS', { limit: 200 }),
      callWithTimeout(entityId, 'SLACK_AUTH_TEST', {}),
    ]);

    if (!channelsResp || !usersResp) return [];

    const channels = unwrap<SlackChannel>(channelsResp, 'channels');
    const users = unwrap<SlackUser>(usersResp, 'members');
    const userById = new Map(users.map((u) => [u.id, u]));
    const teamUserIds = new Set(users.map((u) => u.id));

    const realtorSlackId = (() => {
      if (!authResp || typeof authResp !== 'object') return null;
      const a = authResp as { data?: { user_id?: string; data?: { user_id?: string } } };
      return a.data?.user_id ?? a.data?.data?.user_id ?? null;
    })();

    const signals: Signal[] = [];

    for (const ch of channels) {
      const history = await callWithTimeout(entityId, 'SLACK_FETCH_CONVERSATION_HISTORY', {
        channel: ch.id,
        oldest: oldestTs,
        limit: 20,
      });
      if (!history) continue;
      const messages = unwrap<SlackMessage>(history, 'messages');

      for (const msg of messages) {
        if (!msg.ts || !msg.user) continue;
        const ageMs = Date.now() - Number.parseFloat(msg.ts) * 1000;
        if (!Number.isFinite(ageMs) || ageMs > STALE_MS || ageMs < 0) continue;
        if (realtorSlackId && msg.user === realtorSlackId) continue;

        if (ch.is_im) {
          if (!isTeammate(msg.user, teamUserIds)) continue;
          const sender = userById.get(msg.user);
          const name = teammateDisplayName(sender);
          signals.push({
            source: 'slack',
            kind: 'reply',
            urgency: 2,
            confidence: 0.8,
            subject: {
              id: `slack-dm-${ch.id}`,
              name: `DM from ${name}`,
              href: `/chippi/today`,
            },
            evidence: `DM from ${name} at ${formatLocalTime(msg.ts)}.`,
            draftedAction: { kind: 'open', href: `/chippi/today` },
          });
        } else if (mentionsRealtor(msg.text, realtorSlackId)) {
          const sender = userById.get(msg.user);
          const name = teammateDisplayName(sender);
          const channelLabel = ch.name ? `#${ch.name}` : 'a channel';
          const snippet = (msg.text ?? '').replace(MENTION_RE, '@you').trim().slice(0, 120);
          signals.push({
            source: 'slack',
            kind: 'reply',
            urgency: 1,
            confidence: 0.88,
            subject: {
              id: `slack-mention-${ch.id}-${msg.ts}`,
              name: `${name} in ${channelLabel}`,
              href: `/chippi/today`,
            },
            evidence: snippet
              ? `${name} in ${channelLabel}: "${snippet}".`
              : `${name} mentioned you in ${channelLabel}.`,
            draftedAction: { kind: 'open', href: `/chippi/today` },
          });
        }
      }
    }

    return signals;
  },
};
