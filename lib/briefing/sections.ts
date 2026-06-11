/**
 * Command-center section data — PIPELINE + OVERNIGHT for the redesigned
 * /chippi/brief surface.
 *
 * The brief.cards array (ON DECK) and brief.momentum / brief.tomorrow
 * lines come from compose.ts. These two helpers add the two new section
 * shapes the surface needs but the composer doesn't produce because they
 * aren't ranked signals — they're state-of-the-business roll-ups.
 *
 * PIPELINE: active deal counts (active / closing this week / at risk).
 * OVERNIGHT: what the autonomous agent did in the last 12h, grouped by
 *            actionType into 3-5 buckets.
 *
 * Both return null when there's nothing to show — the surface omits the
 * section silently. Calm beats filler.
 */

import { supabase } from '@/lib/supabase';
import { dealHealth } from '@/lib/deals/health';
import type { Deal } from '@/lib/types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const OVERNIGHT_WINDOW_HOURS = 12;

export interface PipelineSummary {
  active: number;
  closingThisWeek: number;
  atRisk: number;
}

export interface OvernightSummary {
  buckets: { label: string; count: number }[];
  total: number;
}

/* ─── PIPELINE ─────────────────────────────────────────────────────────── */

type DealRow = Pick<
  Deal,
  | 'id'
  | 'status'
  | 'stageChangedAt'
  | 'updatedAt'
  | 'closeDate'
  | 'followUpAt'
  | 'nextAction'
  | 'nextActionDueAt'
>;

/**
 * Count active deals, deals closing in the next 7 days, and deals
 * flagged at-risk or stuck by the shared dealHealth function. One read,
 * three numbers. Returns null when there are zero active deals — the
 * surface omits the PIPELINE section on day-one realtors.
 */
export async function composePipelineSummary(
  spaceId: string,
): Promise<PipelineSummary | null> {
  const { data, error } = await supabase
    .from('Deal')
    .select(
      'id, status, stageChangedAt, updatedAt, closeDate, followUpAt, nextAction, nextActionDueAt',
    )
    .eq('spaceId', spaceId)
    .eq('status', 'active');

  if (error || !data || data.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekOut = new Date(today.getTime() + 7 * MS_PER_DAY);

  let closingThisWeek = 0;
  let atRisk = 0;

  for (const deal of data as DealRow[]) {
    if (deal.closeDate) {
      const close = new Date(deal.closeDate);
      if (
        !isNaN(close.getTime()) &&
        close.getTime() >= today.getTime() &&
        close.getTime() <= weekOut.getTime()
      ) {
        closingThisWeek += 1;
      }
    }
    const { state } = dealHealth(deal);
    if (state === 'at-risk' || state === 'stuck') atRisk += 1;
  }

  return { active: data.length, closingThisWeek, atRisk };
}

/* ─── OVERNIGHT ────────────────────────────────────────────────────────── */

/**
 * Action-type → human-readable bucket label. Same vocabulary as the
 * activity feed (`what-i-did.tsx`'s ACTION_META) but condensed to
 * past-tense plural nouns the brief reads as a one-glance summary.
 *
 * Anything not mapped here falls into 'updates' so the bucket count is
 * bounded — Jobs cut, 5 max.
 */
const BUCKET_OF: Record<string, string> = {
  // Drafts the realtor can review / approve
  create_draft_message: 'drafts ready',
  message_drafted: 'drafts ready',
  packet_drafted: 'drafts ready',
  // Outbound the agent sent on its own
  send_sms: 'messages sent',
  send_email: 'messages sent',
  // Deal-level movement
  update_deal_probability: 'deals advanced',
  set_deal_follow_up: 'deals advanced',
  // Contact-level work
  set_contact_follow_up: 'contacts updated',
  update_lead_score: 'contacts updated',
  log_note: 'contacts updated',
  log_observation: 'contacts updated',
  log_agent_observation: 'contacts updated',
  store_memory: 'contacts updated',
  // Reminders
  create_follow_up_reminder: 'reminders set',
  // Tasks
  task_completed: 'tasks done',
};

/**
 * Bucket order — when multiple buckets are present, render in this
 * sequence so the realtor's eye lands on the most actionable item
 * (drafts they can approve) first.
 */
const BUCKET_ORDER = [
  'drafts ready',
  'messages sent',
  'deals advanced',
  'contacts updated',
  'reminders set',
  'tasks done',
  'updates',
];

const MAX_BUCKETS = 5;

interface ActivityRow {
  actionType: string;
}

/**
 * Roll up the last 12h of completed autonomous agent actions into 3-5
 * buckets. Returns null when there's no overnight activity at all — the
 * surface omits the OVERNIGHT section so day-one realtors don't see a
 * confusing "0 things happened" header.
 */
export async function composeOvernight(
  spaceId: string,
): Promise<OvernightSummary | null> {
  const since = new Date(
    Date.now() - OVERNIGHT_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from('AgentActivityLog')
    .select('actionType')
    .eq('spaceId', spaceId)
    .eq('outcome', 'completed')
    .gte('createdAt', since);

  if (error || !data || data.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of data as ActivityRow[]) {
    const label = BUCKET_OF[row.actionType] ?? 'updates';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const ordered = BUCKET_ORDER
    .filter((label) => counts.has(label))
    .slice(0, MAX_BUCKETS)
    .map((label) => ({ label, count: counts.get(label)! }));

  if (ordered.length === 0) return null;
  return { buckets: ordered, total: data.length };
}

export const __sectionsInternals = { BUCKET_OF, BUCKET_ORDER, MAX_BUCKETS };
