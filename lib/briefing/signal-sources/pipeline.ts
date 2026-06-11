/**
 * Pipeline signal source — reads the realtor's active Deal rows and
 * surfaces stuck deals, at-risk deals, and deals closing this week.
 *
 * Confidence calibration:
 *   - Stuck (≥30 days in stage OR ≥3 days past close): 0.95
 *   - Closing within 3 days: 0.90
 *   - At-risk (overdue follow-up): 0.80
 *   - Other at-risk (15-29 days in stage): 0.72 — just above the floor
 *
 * The floor is 0.7. Below that signals don't compete for slots; this
 * matters when a realtor with a quiet pipeline shouldn't get a brief
 * padded with "this deal has been sitting 16 days" filler.
 */

import { supabase } from '@/lib/supabase';
import { dealHealth } from '@/lib/deals/health';
import type { Deal } from '@/lib/types';
import type { Signal, SignalGatherer, SignalKind, SignalUrgency } from '../types';

type DealRow = Pick<
  Deal,
  | 'id'
  | 'title'
  | 'status'
  | 'stageChangedAt'
  | 'updatedAt'
  | 'closeDate'
  | 'followUpAt'
  | 'nextAction'
  | 'nextActionDueAt'
>;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysUntil(dateInput: string | Date | null): number | null {
  if (!dateInput) return null;
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - today.getTime()) / MS_PER_DAY);
}

export const pipelineSource: SignalGatherer = {
  source: 'pipeline',
  async gather(spaceId: string): Promise<Signal[]> {
    const { data, error } = await supabase
      .from('Deal')
      .select('id, title, status, stageChangedAt, updatedAt, closeDate, followUpAt, nextAction, nextActionDueAt')
      .eq('spaceId', spaceId)
      .eq('status', 'active');

    if (error || !data) return [];

    const signals: Signal[] = [];

    for (const deal of data as DealRow[]) {
      const health = dealHealth(deal);
      const dealHref = `/deals/${deal.id}`;
      const subject = { id: deal.id, name: deal.title, href: dealHref };

      if (health.state === 'stuck') {
        signals.push({
          source: 'pipeline',
          kind: 'review' as SignalKind,
          urgency: 1 as SignalUrgency,
          confidence: 0.95,
          subject,
          evidence: health.reason,
          draftedAction: { kind: 'open', href: dealHref },
        });
        continue;
      }

      const closeDays = daysUntil(deal.closeDate);
      if (closeDays !== null && closeDays >= 0 && closeDays <= 3) {
        const phrase =
          closeDays === 0
            ? 'Closes today'
            : closeDays === 1
              ? 'Closes tomorrow'
              : `Closes in ${closeDays} days`;
        signals.push({
          source: 'pipeline',
          kind: 'review',
          urgency: 1,
          confidence: 0.9,
          subject,
          evidence: phrase,
          draftedAction: { kind: 'open', href: dealHref },
        });
        continue;
      }

      if (health.state === 'at-risk') {
        // Follow-up overdue is the most actionable at-risk variant — surface it
        // with stronger confidence than the "just slow" 15-day case.
        const followUpOverdue = health.reason === 'follow-up overdue' || health.reason === 'next action overdue';
        signals.push({
          source: 'pipeline',
          kind: 'review',
          urgency: 2,
          confidence: followUpOverdue ? 0.8 : 0.72,
          subject,
          evidence: health.reason,
          draftedAction: { kind: 'open', href: dealHref },
        });
      }
    }

    return signals;
  },
};
