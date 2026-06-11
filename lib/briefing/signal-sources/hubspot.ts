/**
 * HubSpot signal source — Phase D1.
 *
 * Three signals, each cross-walked back to a Chippi entity so the brief
 * only names people the realtor recognises. The new-contact tip is the
 * one exception — its whole point is "this person isn't in Chippi yet."
 *
 *   review (1 / 0.85)  HubSpot deal closedate within 7 days, matched to
 *                      a Chippi Deal NOT already in the `closing` stage.
 *                      The realtor's pipeline is out of sync; surface it
 *                      before the close date arrives.
 *
 *   review (2 / 0.82)  HubSpot deal stage advanced in the last 24h, but
 *                      Chippi Deal stage is earlier. HubSpot is ahead;
 *                      Chippi needs to catch up.
 *
 *   reply  (2 / 0.78)  HubSpot Contact created in the last 24h, no
 *                      matching Chippi Contact by email. A lead landed
 *                      somewhere else; the realtor should pull them in.
 *
 * Data source: hybrid.
 *
 *   - Poll HUBSPOT_DEAL_LIST for the closedate + stage-mismatch signals.
 *     One Composio call, ~1s.
 *   - Use IntegrationTrigger.lastFiredAt as a short-circuit for the
 *     trigger-driven signals — when neither
 *     HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER nor
 *     HUBSPOT_CONTACT_CREATED_TRIGGER fired in the last 24h, skip those
 *     polls entirely. The trigger row is the "delivery cache".
 *
 * Cross-walk is by email (Contact.email ↔ HubSpot contact.email,
 * case-insensitive) and by deal title for deals. Cross-ID storage
 * (IntegrationExternalId) is deferred — when a HubSpot deal can't match
 * a Chippi Deal by title, the signal is dropped rather than guessed at.
 * The brief stays honest.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { listTriggersForConnection } from '@/lib/integrations/triggers';
import type { Signal, SignalGatherer } from '../types';

const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;
const COMPOSIO_TIMEOUT_MS = 3000;

const CLOSING_STAGE_KIND = 'closing';
const CLOSE_DATE_WINDOW_DAYS = 7;
const TRIGGER_WINDOW_HOURS = 24;

type ChippiDealRow = {
  id: string;
  title: string;
  closeDate: string | null;
  stageId: string;
  DealStage: { kind: string | null; position: number } | null;
};

type ChippiContactRow = {
  id: string;
  name: string;
  email: string | null;
};

interface HubspotDeal {
  id: string;
  name: string | null;
  closedate: string | null;
  dealstage: string | null;
  hs_lastmodifieddate: string | null;
}

interface HubspotContact {
  id: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  createdate: string | null;
}

/**
 * Find the Chippi Deal that best matches a HubSpot deal. Case-insensitive
 * title match — the simplest cross-walk that works without an external-id
 * table. When titles drift between systems, the signal silently drops
 * (correct behaviour — we won't name a deal the realtor won't recognise).
 */
export function matchDealByTitle(
  hubspotDealName: string | null,
  chippiDeals: ChippiDealRow[],
): ChippiDealRow | null {
  if (!hubspotDealName) return null;
  const needle = hubspotDealName.trim().toLowerCase();
  if (needle.length === 0) return null;
  return chippiDeals.find((d) => d.title.trim().toLowerCase() === needle) ?? null;
}

/**
 * Find the Chippi Contact whose email matches a HubSpot contact's email,
 * case-insensitively. Whitespace-trimmed.
 */
export function matchContactByEmail(
  email: string | null,
  chippiContacts: ChippiContactRow[],
): ChippiContactRow | null {
  if (!email) return null;
  const needle = email.trim().toLowerCase();
  if (needle.length === 0) return null;
  return chippiContacts.find((c) => c.email?.trim().toLowerCase() === needle) ?? null;
}

/**
 * Is the Chippi Deal already in the `closing` stage? The closedate
 * signal only fires when Chippi is BEHIND HubSpot — if the realtor has
 * already moved the deal to closing, the systems agree and we say nothing.
 */
export function isAlreadyClosing(deal: ChippiDealRow): boolean {
  return deal.DealStage?.kind === CLOSING_STAGE_KIND;
}

/** Days from now to the given ISO date. Negative when the date has passed. */
export function daysFromNow(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - today.getTime()) / MS_PER_DAY);
}

/** Was this ISO timestamp within the last N hours? */
export function withinLastHours(iso: string | null | undefined, hours: number): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= hours * MS_PER_HOUR;
}

/**
 * Build the "first last" name for a HubSpot contact, falling back to
 * email local-part when both names are blank. Returns null when nothing
 * usable exists — the signal is then dropped.
 */
export function contactDisplayName(contact: HubspotContact): string | null {
  const first = contact.firstname?.trim() ?? '';
  const last = contact.lastname?.trim() ?? '';
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full.length > 0) return full;
  const email = contact.email?.trim() ?? '';
  if (email.length === 0) return null;
  const local = email.split('@')[0];
  return local.length > 0 ? local : null;
}

/** Did the given trigger fire within the last 24h? Helper used twice. */
export function triggersFiredRecently(
  rows: Array<{ triggerSlug: string; lastFiredAt: string | null }>,
  slug: string,
): boolean {
  const row = rows.find((r) => r.triggerSlug === slug);
  return withinLastHours(row?.lastFiredAt ?? null, TRIGGER_WINDOW_HOURS);
}

/**
 * Run a Composio tool call with a hard timeout. The composer wraps
 * gather() in Promise.allSettled, so a thrown error doesn't break other
 * sources — but a 30-second hang would. 3s is enough for a list call,
 * fast enough that the cron's per-space budget isn't blown.
 */
async function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      fn(),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error(`hubspot tool timed out after ${ms}ms`)), ms),
      ),
    ]);
  } catch (err) {
    logger.warn('[briefing.hubspot] composio call failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Pull HubSpot deals that have a close date inside the 7-day window.
 * Composio's HUBSPOT_DEAL_LIST returns the canonical HubSpot list shape;
 * we normalise to a flat HubspotDeal[] tolerant of nested `properties`.
 */
async function fetchHubspotDeals(entityId: string): Promise<HubspotDeal[]> {
  const { executeToolForEntity } = await import('@/lib/integrations/composio');
  const sevenDaysOut = new Date(Date.now() + CLOSE_DATE_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
    .split('T')[0];
  const result = await withTimeout(
    () =>
      executeToolForEntity({
        entityId,
        slug: 'HUBSPOT_DEAL_LIST',
        arguments: {
          properties: ['dealname', 'dealstage', 'closedate', 'hs_lastmodifieddate'],
          limit: 100,
          // HubSpot list endpoints accept a `filters` array. If the
          // underlying tool ignores the filter (older Composio version),
          // we still filter client-side on closedate + lastmodified below.
          filters: [{ propertyName: 'closedate', operator: 'LTE', value: sevenDaysOut }],
        },
      }),
    COMPOSIO_TIMEOUT_MS,
  );
  if (!result || !('successful' in result) || !result.successful) return [];
  return normalizeHubspotDeals((result as { data?: unknown }).data);
}

async function fetchHubspotContacts(entityId: string): Promise<HubspotContact[]> {
  const { executeToolForEntity } = await import('@/lib/integrations/composio');
  const result = await withTimeout(
    () =>
      executeToolForEntity({
        entityId,
        slug: 'HUBSPOT_CONTACT_LIST',
        arguments: {
          properties: ['email', 'firstname', 'lastname', 'createdate'],
          limit: 100,
        },
      }),
    COMPOSIO_TIMEOUT_MS,
  );
  if (!result || !('successful' in result) || !result.successful) return [];
  return normalizeHubspotContacts((result as { data?: unknown }).data);
}

function normalizeHubspotDeals(data: unknown): HubspotDeal[] {
  const results = pickResults(data);
  return results
    .map((r) => {
      const props = (r.properties ?? r) as Record<string, unknown>;
      return {
        id: String(r.id ?? props.hs_object_id ?? ''),
        name: asString(props.dealname),
        dealstage: asString(props.dealstage),
        closedate: asString(props.closedate),
        hs_lastmodifieddate: asString(props.hs_lastmodifieddate),
      };
    })
    .filter((d) => d.id.length > 0);
}

function normalizeHubspotContacts(data: unknown): HubspotContact[] {
  const results = pickResults(data);
  return results
    .map((r) => {
      const props = (r.properties ?? r) as Record<string, unknown>;
      return {
        id: String(r.id ?? props.hs_object_id ?? ''),
        email: asString(props.email),
        firstname: asString(props.firstname),
        lastname: asString(props.lastname),
        createdate: asString(props.createdate),
      };
    })
    .filter((c) => c.id.length > 0);
}

function pickResults(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  for (const c of [d.results, d.items, d.data]) {
    if (Array.isArray(c)) return c as Array<Record<string, unknown>>;
  }
  return [];
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export const hubspotSource: SignalGatherer = {
  source: 'hubspot',
  async gather(spaceId: string): Promise<Signal[]> {
    // 1. Skip entirely without an active HubSpot connection. The realtor
    //    hasn't connected; we don't poll Composio for nothing.
    const connection = await findActiveConnection(spaceId);
    if (!connection) return [];

    // 2. Pull Chippi-side rows ONCE — the cross-walk references — and
    //    the trigger rows in parallel.
    const [chippiDeals, chippiContacts, triggerRows] = await Promise.all([
      loadChippiDeals(spaceId),
      loadChippiContacts(spaceId),
      listTriggersForConnection(connection.id).catch(() => []),
    ]);

    const contactTriggerFired = triggersFiredRecently(
      triggerRows,
      'HUBSPOT_CONTACT_CREATED_TRIGGER',
    );
    const stageTriggerFired = triggersFiredRecently(
      triggerRows,
      'HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER',
    );

    // 3. Fetch from HubSpot in parallel. Each call is wrapped in
    //    withTimeout — if Composio is slow or down, the brief still
    //    composes. The contact list is only fetched when its trigger
    //    fired recently (cache hit on lastFiredAt).
    const [hubspotDeals, hubspotContacts] = await Promise.all([
      fetchHubspotDeals(connection.userId),
      contactTriggerFired ? fetchHubspotContacts(connection.userId) : Promise.resolve([]),
    ]);

    const signals: Signal[] = [];

    // ── Closedate mismatch + stage-advance: both read from the deal list.
    for (const hsDeal of hubspotDeals) {
      const matched = matchDealByTitle(hsDeal.name, chippiDeals);
      if (!matched) continue; // can't name it — drop

      // Closedate mismatch: HubSpot says closing soon, Chippi isn't in
      // closing yet. Highest urgency in this source.
      const closeDays = daysFromNow(hsDeal.closedate);
      if (
        closeDays !== null &&
        closeDays >= 0 &&
        closeDays <= CLOSE_DATE_WINDOW_DAYS &&
        !isAlreadyClosing(matched)
      ) {
        signals.push({
          source: 'hubspot',
          kind: 'review',
          urgency: 1,
          confidence: 0.85,
          subject: {
            id: matched.id,
            name: matched.title,
            href: `/deals/${matched.id}`,
          },
          evidence: `${matched.title} closes ${formatCloseDate(hsDeal.closedate, closeDays)} in HubSpot — still '${describeChippiStage(matched)}' in Chippi.`,
          draftedAction: { kind: 'open', href: `/deals/${matched.id}` },
        });
        continue;
      }

      // Stage-advance: HubSpot moved the deal recently, Chippi's stage
      // is earlier. Only fires when the stage-updated trigger has
      // actually delivered in the last 24h (trigger row is the cache).
      if (!stageTriggerFired) continue;
      if (!withinLastHours(hsDeal.hs_lastmodifieddate, TRIGGER_WINDOW_HOURS)) continue;
      const hubspotStage = hsDeal.dealstage;
      if (!hubspotStage) continue;
      const chippiStage = describeChippiStage(matched);
      // Lossy comparison — Chippi and HubSpot use different stage labels,
      // but the realtor knows their own pipeline. Surface the mismatch
      // and let them confirm.
      if (hubspotStage.toLowerCase() === chippiStage.toLowerCase()) continue;
      signals.push({
        source: 'hubspot',
        kind: 'review',
        urgency: 2,
        confidence: 0.82,
        subject: {
          id: matched.id,
          name: matched.title,
          href: `/deals/${matched.id}`,
        },
        evidence: `HubSpot moved the ${matched.title} to '${hubspotStage}'. Chippi still has it at '${chippiStage}'.`,
        draftedAction: { kind: 'open', href: `/deals/${matched.id}` },
      });
    }

    // ── New contact: a HubSpot contact created in the last 24h with no
    //    matching Chippi Contact. The one signal where we name someone
    //    NOT in Chippi — its whole point is "pull them in."
    for (const hsContact of hubspotContacts) {
      if (!withinLastHours(hsContact.createdate, TRIGGER_WINDOW_HOURS)) continue;
      if (matchContactByEmail(hsContact.email, chippiContacts)) continue;
      const name = contactDisplayName(hsContact);
      if (!name) continue;
      signals.push({
        source: 'hubspot',
        kind: 'reply',
        urgency: 2,
        confidence: 0.78,
        subject: {
          // The hubspot id is the only stable handle we have for a
          // contact that isn't in Chippi yet. Deduplication in the
          // composer is by subject.id — prefixing prevents collision
          // with any Chippi-side card.
          id: `hubspot:contact:${hsContact.id}`,
          name,
          href: '/contacts',
        },
        evidence: `New HubSpot contact: ${name}. Not in Chippi.`,
        draftedAction: { kind: 'open', href: '/contacts' },
      });
    }

    return signals;
  },
};

// ─── DB helpers ─────────────────────────────────────────────────────────

async function findActiveConnection(spaceId: string): Promise<{
  id: string;
  userId: string;
} | null> {
  const { data } = await supabase
    .from('IntegrationConnection')
    .select('id, userId')
    .eq('spaceId', spaceId)
    .eq('toolkit', 'hubspot')
    .eq('status', 'active')
    .maybeSingle();
  return (data ?? null) as { id: string; userId: string } | null;
}

async function loadChippiDeals(spaceId: string): Promise<ChippiDealRow[]> {
  const { data, error } = await supabase
    .from('Deal')
    .select('id, title, closeDate, stageId, DealStage:stageId(kind, position)')
    .eq('spaceId', spaceId)
    .eq('status', 'active');
  if (error || !data) return [];
  return data as unknown as ChippiDealRow[];
}

async function loadChippiContacts(spaceId: string): Promise<ChippiContactRow[]> {
  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, email')
    .eq('spaceId', spaceId)
    .not('email', 'is', null);
  if (error || !data) return [];
  return data as ChippiContactRow[];
}

function describeChippiStage(deal: ChippiDealRow): string {
  return deal.DealStage?.kind ?? 'open';
}

function formatCloseDate(iso: string | null, days: number): string {
  if (!iso) return `in ${days} days`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return `in ${days} days`;
  // "Friday" reads warmer than "in 4 days" — the design pass called for
  // a weekday name when the close is inside the week.
  if (days <= 6) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
