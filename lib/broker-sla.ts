/**
 * Speed-to-lead enforcement — the agentic half of brokerage lead routing.
 *
 * Routing already puts a lead in a realtor's hands (auto-assign + DealRoutingRule
 * → a Contact clone tagged `assigned-by-broker` in the realtor's space). This is
 * the part that makes sure it's actually WORKED: a sweep that finds routed leads
 * sitting un-touched past the brokerage's SLA and acts on the broker's behalf —
 * nudging the realtor first, escalating to the broker if it stays cold.
 *
 * Detection needs no extra schema:
 *   - a routed lead  = Contact in a member space tagged `assigned-by-broker`
 *   - un-worked      = `lastContactedAt IS NULL`
 *   - the clock      = the clone's `createdAt` (= assignment time)
 *
 * Idempotency is carried on the contact's own tags: once Chippi nudges it gets
 * `sla-nudged`; once it escalates it gets `sla-escalated`. The sweep skips a
 * lead it has already acted on at that level, so running every 15 minutes never
 * double-pings.
 */

import { supabase } from '@/lib/supabase';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { notifyBroker } from '@/lib/broker-notify';
import { sendPushToSpace } from '@/lib/push';
import { logger } from '@/lib/logger';

export interface BrokerageSlaPolicy {
  id: string;
  name: string;
  slaFirstResponseMinutes: number;
  slaEscalateMinutes: number;
}

export interface SlaSweepResult {
  brokerageId: string;
  breached: number;
  nudged: number;
  escalated: number;
}

const NUDGED_TAG = 'sla-nudged';
const ESCALATED_TAG = 'sla-escalated';

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/**
 * Run the speed-to-lead sweep for one brokerage. Best-effort throughout — a
 * single contact failing never aborts the rest. Returns what Chippi did.
 */
export async function sweepBrokerageSla(brokerage: BrokerageSlaPolicy): Promise<SlaSweepResult> {
  const result: SlaSweepResult = { brokerageId: brokerage.id, breached: 0, nudged: 0, escalated: 0 };

  // ── Member spaces + realtor names ──────────────────────────────────────────
  const members = await getBrokerageMembers(brokerage.id, { includeSpaceName: true });
  const spaceIds: string[] = [];
  const spaceToRealtor = new Map<string, string>();
  for (const m of members) {
    const sid = m.Space?.id;
    if (!sid) continue;
    spaceIds.push(sid);
    spaceToRealtor.set(sid, m.User?.name ?? m.User?.email ?? 'a realtor');
  }
  if (spaceIds.length === 0) return result;

  // First-response threshold: any routed lead created before this has now sat
  // longer than the brokerage allows.
  const firstThreshold = new Date(Date.now() - brokerage.slaFirstResponseMinutes * 60000).toISOString();

  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, spaceId, tags, createdAt, lastContactedAt')
    .in('spaceId', spaceIds)
    .contains('tags', ['assigned-by-broker'])
    .is('lastContactedAt', null)
    .lte('createdAt', firstThreshold)
    .limit(2000);
  if (error) {
    logger.error('[broker-sla] breach query failed', { brokerageId: brokerage.id }, error);
    return result;
  }

  const rows = (data ?? []) as {
    id: string;
    name: string;
    spaceId: string;
    tags: string[] | null;
    createdAt: string;
  }[];

  for (const c of rows) {
    const tags = c.tags ?? [];
    const waited = minutesSince(c.createdAt);
    const realtor = spaceToRealtor.get(c.spaceId) ?? 'a realtor';
    result.breached += 1;

    try {
      // Past the escalation window → the realtor has had their chance; pull in
      // the broker (their decision whether to reassign — nothing fires without
      // a human's name on it).
      if (waited >= brokerage.slaEscalateMinutes) {
        if (tags.includes(ESCALATED_TAG)) continue;
        await notifyBroker({
          brokerageId: brokerage.id,
          type: 'review_requested',
          title: `${c.name} still hasn't been contacted`,
          body: `Assigned to ${realtor} ${waited} minutes ago and still no first response. Reassign or step in.`,
          metadata: { kind: 'lead_sla_breach', contactId: c.id, spaceId: c.spaceId, realtor, waitedMinutes: waited },
        });
        await supabase
          .from('Contact')
          .update({ tags: [...tags, ESCALATED_TAG] })
          .eq('id', c.id);
        result.escalated += 1;
        continue;
      }

      // Past first-response but inside the escalation window → nudge the realtor.
      if (tags.includes(NUDGED_TAG)) continue;
      await sendPushToSpace(c.spaceId, {
        title: 'A lead is waiting on you',
        body: `${c.name} has been waiting ${waited} minutes. Reach out now.`,
      }).catch(() => 0);
      await supabase
        .from('Contact')
        .update({ tags: [...tags, NUDGED_TAG] })
        .eq('id', c.id);
      result.nudged += 1;
    } catch (err) {
      logger.warn('[broker-sla] action failed for contact', { brokerageId: brokerage.id, contactId: c.id }, err);
    }
  }

  return result;
}

/**
 * Run the sweep for every brokerage that has SLA enforcement on. Used by the
 * cron route.
 */
export async function sweepAllBrokerages(): Promise<SlaSweepResult[]> {
  const { data, error } = await supabase
    .from('Brokerage')
    .select('id, name, slaFirstResponseMinutes, slaEscalateMinutes')
    .eq('slaEnabled', true)
    .limit(5000);
  if (error) {
    logger.error('[broker-sla] failed to load brokerages', {}, error);
    return [];
  }
  const policies = (data ?? []) as BrokerageSlaPolicy[];
  const out: SlaSweepResult[] = [];
  for (const p of policies) {
    try {
      out.push(await sweepBrokerageSla(p));
    } catch (err) {
      logger.error('[broker-sla] brokerage sweep threw', { brokerageId: p.id }, err);
    }
  }
  return out;
}
