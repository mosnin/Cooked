/**
 * Tip cool-down policy.
 *
 * Each tip category has a default cool-down window after the tip
 * fires (gets `outcome='shown'`). The same (category, subject) pair
 * doesn't fire again within the window. Dismissed tips get longer
 * silence; acted-on tips reset (if the trigger fires fresh, the tip
 * is allowed back).
 *
 * Per-category windows are tuned to the cadence of the signal:
 *   - Single-subject tips (hot lead dormant, deal closing): 7 days
 *   - Past-client / unworked-tag (segments need time to work): 30 days
 *   - Trend tips (overdue pileup, reply rate, stage stagnation,
 *     tour conversion, source dry spell): 14 days — week-over-week
 *     stability needs a real new week before re-firing.
 */

import { supabase } from '@/lib/supabase';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

const COOL_DOWN_DAYS: Record<string, number> = {
  hot_lead_dormant: 7,
  deal_closing_soon: 7,
  won_deal_review_ask: 7,
  past_client_referral: 30,
  unworked_tag: 30,
  overdue_pileup: 14,
  // Phase C2 trends — week-over-week needs a real new week before
  // re-firing. Stage and source variants use a per-segment subjectId so
  // two stages stagnating in parallel produce two independent cool-downs.
  reply_rate_decline: 14,
  stage_stagnation: 14,
  tour_conversion_drop: 14,
  source_dry_spell: 14,
};

const DEFAULT_COOL_DOWN_DAYS = 7;
const DISMISSED_COOL_DOWN_DAYS = 60;

export function coolDownDaysFor(tipCategory: string, outcome: 'shown' | 'acted' | 'dismissed'): number {
  if (outcome === 'dismissed') return DISMISSED_COOL_DOWN_DAYS;
  if (outcome === 'acted') return 0; // Reset — if the trigger fires fresh, allow it back.
  return COOL_DOWN_DAYS[tipCategory] ?? DEFAULT_COOL_DOWN_DAYS;
}

/**
 * Check whether a (category, subject) pair is currently cooled down.
 * Returns true if the tip CAN fire (cool-down has passed or never fired).
 */
export async function canFireTip(
  spaceId: string,
  tipCategory: string,
  subjectId: string | null,
): Promise<boolean> {
  const query = supabase
    .from('BriefTipHistory')
    .select('firedAt, outcome')
    .eq('spaceId', spaceId)
    .eq('tipCategory', tipCategory)
    .order('firedAt', { ascending: false })
    .limit(1);

  // Postgres treats `is null` and `eq null` differently — explicit null check.
  if (subjectId === null) {
    query.is('subjectId', null);
  } else {
    query.eq('subjectId', subjectId);
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data) return true;

  const firedAt = new Date((data as { firedAt: string }).firedAt);
  if (isNaN(firedAt.getTime())) return true;

  const outcome = (data as { outcome: 'shown' | 'acted' | 'dismissed' }).outcome;
  const coolDownMs = coolDownDaysFor(tipCategory, outcome) * MS_PER_DAY;
  return Date.now() - firedAt.getTime() >= coolDownMs;
}

/**
 * Record that a tip fired. Called by the composer after a tip wins the
 * slot in a brief that's about to be persisted.
 */
export async function recordTipFired(
  spaceId: string,
  tipCategory: string,
  subjectId: string | null,
): Promise<void> {
  await supabase.from('BriefTipHistory').insert({
    spaceId,
    tipCategory,
    subjectId,
    outcome: 'shown',
  });
}
