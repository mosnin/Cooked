/**
 * Gmail signal source — surfaces the threads the trigger pipeline doesn't.
 *
 * Why this exists alongside `drafts`:
 *   - The `drafts` source already shows everything the autonomous agent
 *     drafted in response to the GMAIL_NEW_GMAIL_MESSAGE trigger. Those
 *     are the "Chippi did this overnight, approve or edit" cards.
 *   - Gmail (this source) covers the gaps the trigger feed never sees:
 *       1. Sent threads gone QUIET — the realtor wrote, the lead didn't
 *          come back. Trigger fires on inbound only.
 *       2. Inbound that landed but the agent DECIDED not to draft for
 *          (low-signal judgment). The realtor still wants to see them.
 *   - Together: drafts = "ready to approve", gmail = "needs a human eye."
 *
 * Confidence calibration:
 *   - Hot-tier sent thread, no reply in 2+ days: 0.90 (urgency 1)
 *   - Any-tier sent thread, no reply in 4+ days, last msg >100 chars: 0.85 (urgency 2)
 *   - Inbound ≤6h ago from known contact, no agent draft produced: 0.82 (urgency 1)
 *
 * Cross-walk: thread participant email ↔ Contact.email (case-insensitive).
 * Unknown senders are dropped — this source is about people the realtor
 * has a relationship with, not a generic inbox replacement.
 *
 * Scope discipline (Musk lens): one Composio call per brief generation,
 * 4s timeout, return [] on any failure. The brief composer fans out all
 * sources in parallel; this one staying tight protects the per-space budget.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { HOT_LEAD_THRESHOLD } from '@/lib/constants';
import type { Signal, SignalGatherer } from '../types';

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

const FETCH_TIMEOUT_MS = 4_000;
const FETCH_LOOKBACK_DAYS = 7;

const QUIET_HOT_DAYS = 2;          // hot lead: 2 days of silence is loud
const QUIET_ANY_DAYS = 4;          // any tier: 4 days before we surface it
const QUIET_MIN_REALTOR_CHARS = 100; // a "hi" doesn't deserve a follow-up nag

const INBOUND_RECENT_HOURS = 6;    // freshness window for the "agent skipped" signal
const DRAFT_LOOKBACK_HOURS = 12;   // window we check for a matching AgentDraft

/**
 * Minimal shape of one message returned by GMAIL_FETCH_EMAILS. Composio's
 * response wraps a list under `messages`; each item carries the parts we
 * actually need to reason about a thread. Anything we don't read is left
 * out of the type to keep the contract honest about what we depend on.
 */
type GmailMessage = {
  messageId?: string;
  threadId?: string;
  sender?: string;        // "Name <email@host>" — we extract the address
  to?: string | string[]; // the realtor's address for inbound; recipient for sent
  subject?: string;
  messageText?: string;   // best-available plain body
  preview?: { body?: string } | string;
  messageTimestamp?: string; // ISO; we tolerate epoch ms as a fallback
  labelIds?: string[];    // 'SENT' / 'INBOX' lives here
};

type ContactRow = {
  id: string;
  name: string;
  email: string | null;
  leadScore: number | null;
};

type ConnectionRow = {
  id: string;
  userId: string;
};

/**
 * Extract the bare email address from a "Name <addr@host>" header value
 * Gmail returns. Returns null when the value is empty or malformed past
 * trivial cases — strict matching is fine for the lookup, exotic edge
 * cases drop out and become "unknown sender" (which we silently skip).
 */
export function parseEmailAddress(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null;
  const value = String(headerValue).trim();
  if (value.length === 0) return null;
  // "Name <addr@host>" — grab inside the brackets.
  const angled = value.match(/<([^>]+)>/);
  if (angled?.[1]) return angled[1].trim().toLowerCase();
  // Bare address.
  if (value.includes('@')) return value.toLowerCase();
  return null;
}

/**
 * Whole-days delta between two instants, floored. We use whole days for
 * the user-facing evidence ("hasn't replied for 4 days") and for the
 * threshold checks so a 3.9-day-old thread doesn't slip past the 4-day rule.
 */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Should this sent-but-quiet thread surface? Pure helper — no I/O. Returns
 * the matching urgency/confidence tuple, or null to skip.
 *
 * Encodes the two rules from the spec:
 *   - Hot tier (leadScore >= HOT_LEAD_THRESHOLD): 2+ days of silence → urgency 1, 0.90
 *   - Any tier: 4+ days of silence + last realtor msg >100 chars → urgency 2, 0.85
 *
 * The 100-char floor is the cheap proxy for "was this a real touch?"
 * A one-line "got it, thanks" doesn't earn a follow-up nag — that's the
 * conversation ending naturally, not a thread going cold.
 */
export function classifyQuietThread(args: {
  leadScore: number | null;
  daysSinceLastRealtorMessage: number;
  lastRealtorMessageChars: number;
}): { urgency: 1 | 2; confidence: number } | null {
  const isHot = (args.leadScore ?? 0) >= HOT_LEAD_THRESHOLD;
  if (isHot && args.daysSinceLastRealtorMessage >= QUIET_HOT_DAYS) {
    return { urgency: 1, confidence: 0.9 };
  }
  if (
    args.daysSinceLastRealtorMessage >= QUIET_ANY_DAYS &&
    args.lastRealtorMessageChars > QUIET_MIN_REALTOR_CHARS
  ) {
    return { urgency: 2, confidence: 0.85 };
  }
  return null;
}

/** Build the evidence string for a quiet thread. Voice rule: name the
 *  contact, name when, no exclamation, no emoji. */
export function evidenceForQuiet(args: {
  contactName: string;
  daysSinceLastRealtorMessage: number;
  isHot: boolean;
}): string {
  const dayPhrase =
    args.daysSinceLastRealtorMessage === 1
      ? 'yesterday'
      : `${args.daysSinceLastRealtorMessage} days ago`;
  const tier = args.isHot ? ' Hot tier.' : '';
  return `${args.contactName} hasn't replied since ${dayPhrase}.${tier}`;
}

/** Build the evidence string for the "agent skipped this inbound" signal. */
export function evidenceForSkippedInbound(args: { contactName: string }): string {
  return `${args.contactName} emailed recently. Chippi didn't draft — worth a look.`;
}

/** Look up the active Gmail connection for the space. Returns null when
 *  no Gmail is connected — caller short-circuits to []. */
async function activeGmailConnection(spaceId: string): Promise<ConnectionRow | null> {
  const { data, error } = await supabase
    .from('IntegrationConnection')
    .select('id, userId')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'gmail')
    .eq('status', 'active')
    .maybeSingle();
  if (error || !data) return null;
  return data as ConnectionRow;
}

/** Race the Composio call against a 4s timer. On timeout / throw, return
 *  null — the source falls through to []. */
async function fetchRecentMessages(args: {
  entityId: string;
}): Promise<GmailMessage[] | null> {
  const { executeToolForEntity } = await import('@/lib/integrations/composio');
  const since = Math.floor((Date.now() - FETCH_LOOKBACK_DAYS * MS_PER_DAY) / 1000);
  // Gmail's `q` syntax — `newer_than:7d` is server-side and cheaper than
  // post-filtering a full inbox. `in:anywhere` keeps both INBOX and SENT
  // since we care about both directions of the thread.
  const query = `newer_than:${FETCH_LOOKBACK_DAYS}d in:anywhere -in:spam -in:trash`;

  const composioCall = executeToolForEntity({
    entityId: args.entityId,
    slug: 'GMAIL_FETCH_EMAILS',
    arguments: {
      query,
      // One page is enough — a hot inbox tops out around 200 messages/wk
      // and our matching scopes down to known contacts anyway.
      max_results: 50,
      // Lift the lookback as a backup if `query` is ignored by an older
      // composio action version.
      after_timestamp: since,
      include_payload: false,
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([composioCall, timeout]);
    if (res === null) {
      logger.warn('[briefing.gmail] Composio fetch timed out', { entityId: args.entityId });
      return null;
    }
    const r = res as { successful?: boolean; data?: unknown; error?: string | null };
    if (r.successful === false) return null;
    const data = r.data as { messages?: unknown } | undefined;
    const list = Array.isArray(data?.messages) ? (data!.messages as GmailMessage[]) : [];
    return list;
  } catch (err) {
    logger.warn('[briefing.gmail] Composio fetch threw', {
      entityId: args.entityId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Look up the realtor's contacts so we can cross-walk participant emails. */
async function contactsByEmail(spaceId: string): Promise<Map<string, ContactRow>> {
  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, email, leadScore')
    .eq('spaceId', spaceId)
    .is('brokerageId', null)
    .not('email', 'is', null);
  if (error || !data) return new Map();
  const map = new Map<string, ContactRow>();
  for (const c of data as ContactRow[]) {
    if (!c.email) continue;
    map.set(c.email.toLowerCase(), c);
  }
  return map;
}

/** Look up the set of contactIds with a pending/recent AgentDraft. This is
 *  the dedupe gate for signal 3 — if the agent already drafted a response
 *  for the contact, the drafts source covers it. */
async function recentlyDraftedContactIds(spaceId: string): Promise<Set<string>> {
  const since = new Date(Date.now() - DRAFT_LOOKBACK_HOURS * MS_PER_HOUR).toISOString();
  const { data, error } = await supabase
    .from('AgentDraft')
    .select('contactId')
    .eq('spaceId', spaceId)
    .gte('createdAt', since)
    .not('contactId', 'is', null);
  if (error || !data) return new Set();
  const ids = new Set<string>();
  for (const r of data as Array<{ contactId: string | null }>) {
    if (r.contactId) ids.add(r.contactId);
  }
  return ids;
}

/** Group messages by threadId, ordered by timestamp ascending so the last
 *  element is the most recent message in the thread. Skips messages we
 *  can't anchor on a threadId — better to drop than misattribute. */
function bucketByThread(messages: GmailMessage[]): Map<string, GmailMessage[]> {
  const buckets = new Map<string, GmailMessage[]>();
  for (const m of messages) {
    if (!m.threadId) continue;
    const arr = buckets.get(m.threadId) ?? [];
    arr.push(m);
    buckets.set(m.threadId, arr);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => msgInstant(a) - msgInstant(b));
  }
  return buckets;
}

function msgInstant(m: GmailMessage): number {
  const v = m.messageTimestamp;
  if (!v) return 0;
  const n = typeof v === 'string' ? Date.parse(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isSentByRealtor(m: GmailMessage): boolean {
  return Array.isArray(m.labelIds) && m.labelIds.includes('SENT');
}

function bodyChars(m: GmailMessage): number {
  if (typeof m.messageText === 'string' && m.messageText.length > 0) {
    return m.messageText.trim().length;
  }
  const p = m.preview;
  if (typeof p === 'string') return p.trim().length;
  if (p && typeof p.body === 'string') return p.body.trim().length;
  return 0;
}

export const gmailSource: SignalGatherer = {
  source: 'gmail',
  async gather(spaceId: string): Promise<Signal[]> {
    const conn = await activeGmailConnection(spaceId);
    if (!conn) return [];

    const [messages, contactMap, draftedContactIds] = await Promise.all([
      fetchRecentMessages({ entityId: conn.userId }),
      contactsByEmail(spaceId),
      recentlyDraftedContactIds(spaceId),
    ]);
    if (!messages || messages.length === 0) return [];

    const now = new Date();
    const buckets = bucketByThread(messages);
    const signals: Signal[] = [];
    const seenContactIds = new Set<string>();

    for (const thread of buckets.values()) {
      const last = thread[thread.length - 1];
      if (!last) continue;

      // The "other side" of the thread — the participant who isn't the realtor.
      // For a sent message, that's the `to`. For an inbound, it's the `sender`.
      // Either way, we test both fields so a thread with mixed direction still
      // resolves to one contact.
      const candidateAddresses: Array<string | null> = [];
      for (const m of thread) {
        candidateAddresses.push(parseEmailAddress(m.sender));
        const tos = Array.isArray(m.to) ? m.to : m.to ? [m.to] : [];
        for (const t of tos) candidateAddresses.push(parseEmailAddress(t));
      }

      let contact: ContactRow | undefined;
      for (const addr of candidateAddresses) {
        if (!addr) continue;
        const hit = contactMap.get(addr);
        if (hit) {
          contact = hit;
          break;
        }
      }
      if (!contact) continue; // unknown sender — out of scope for this source
      if (seenContactIds.has(contact.id)) continue; // one signal per contact, per source
      seenContactIds.add(contact.id);

      const subject = {
        id: contact.id,
        name: contact.name,
        href: `/contacts/${contact.id}`,
      };

      // ── Signals 1 + 2: realtor sent the most recent message, lead quiet.
      if (isSentByRealtor(last)) {
        const lastSentInstant = msgInstant(last);
        if (lastSentInstant === 0) continue;
        const daysQuiet = daysBetween(new Date(lastSentInstant), now);
        const classification = classifyQuietThread({
          leadScore: contact.leadScore,
          daysSinceLastRealtorMessage: daysQuiet,
          lastRealtorMessageChars: bodyChars(last),
        });
        if (!classification) continue;
        signals.push({
          source: 'gmail',
          kind: 'reply',
          urgency: classification.urgency,
          confidence: classification.confidence,
          subject,
          evidence: evidenceForQuiet({
            contactName: contact.name,
            daysSinceLastRealtorMessage: daysQuiet,
            isHot: (contact.leadScore ?? 0) >= HOT_LEAD_THRESHOLD,
          }),
          draftedAction: { kind: 'open', href: subject.href },
        });
        continue;
      }

      // ── Signal 3: inbound recently, agent decided NOT to draft.
      // The drafts source covers the case where the agent DID draft a
      // response; this surfaces the silence (which is also a signal).
      const lastInstant = msgInstant(last);
      if (lastInstant === 0) continue;
      const hoursSince = (now.getTime() - lastInstant) / MS_PER_HOUR;
      if (hoursSince < 0 || hoursSince > INBOUND_RECENT_HOURS) continue;
      if (draftedContactIds.has(contact.id)) continue;

      signals.push({
        source: 'gmail',
        kind: 'reply',
        urgency: 1,
        confidence: 0.82,
        subject,
        evidence: evidenceForSkippedInbound({ contactName: contact.name }),
        draftedAction: { kind: 'open', href: subject.href },
      });
    }

    return signals;
  },
};
