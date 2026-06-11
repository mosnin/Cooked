/**
 * Leads signal source — reads the realtor's Contact rows for hot leads
 * that haven't been touched and overdue follow-ups.
 *
 * Brokerage-routed contacts (brokerageId !== null) are excluded — those
 * are the brokerage's queue, not on this realtor's desk. Mirrors the
 * morning-route convention.
 *
 * Confidence calibration:
 *   - Overdue follow-up + hot leadScore: 0.92
 *   - Overdue follow-up (any tier): 0.82
 *   - Hot lead (leadScore ≥ 70) not contacted in 5+ days: 0.85
 *   - New lead under 24h old (untouched): 0.78
 */

import { supabase } from '@/lib/supabase';
import { HOT_LEAD_THRESHOLD } from '@/lib/constants';
import type { Signal, SignalGatherer, SignalKind } from '../types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const STALE_HOT_LEAD_DAYS = 5;

type ContactRow = {
  id: string;
  name: string;
  leadScore: number | null;
  followUpAt: string | null;
  lastContactedAt: string | null;
  phone: string | null;
  email: string | null;
  type: string;
  tags: string[] | null;
};

function daysSince(dateString: string | null): number | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - date.getTime()) / MS_PER_DAY);
}

export const leadsSource: SignalGatherer = {
  source: 'leads',
  async gather(spaceId: string): Promise<Signal[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fiveDaysAgo = new Date(today.getTime() - STALE_HOT_LEAD_DAYS * MS_PER_DAY);

    const { data, error } = await supabase
      .from('Contact')
      .select('id, name, leadScore, followUpAt, lastContactedAt, phone, email, type, tags')
      .eq('spaceId', spaceId)
      .is('brokerageId', null)
      .in('type', ['QUALIFICATION', 'TOUR', 'APPLICATION', 'LEASE_REVIEW']);

    if (error || !data) return [];

    const signals: Signal[] = [];

    for (const contact of data as ContactRow[]) {
      const subject = {
        id: contact.id,
        name: contact.name,
        href: `/contacts/${contact.id}`,
      };

      const isHot = (contact.leadScore ?? 0) >= HOT_LEAD_THRESHOLD;
      const followUpDays = daysSince(contact.followUpAt);
      const followUpOverdue = followUpDays !== null && followUpDays > 0;
      const lastContactDays = daysSince(contact.lastContactedAt);
      const isNewLead = Array.isArray(contact.tags) && contact.tags.includes('new-lead');

      const preferredChannel: 'call' | 'reply' =
        contact.phone && (isHot || followUpOverdue) ? 'call' : 'reply';

      // Most actionable: overdue follow-up + hot. Both signals stack.
      if (followUpOverdue && isHot) {
        signals.push({
          source: 'leads',
          kind: preferredChannel as SignalKind,
          urgency: 1,
          confidence: 0.92,
          subject,
          evidence: `Follow-up was ${followUpDays} day${followUpDays === 1 ? '' : 's'} ago. Hot tier.`,
          draftedAction: { kind: 'open', href: `/contacts/${contact.id}` },
        });
        continue;
      }

      if (followUpOverdue) {
        signals.push({
          source: 'leads',
          kind: preferredChannel as SignalKind,
          urgency: followUpDays !== null && followUpDays >= 3 ? 1 : 2,
          confidence: 0.82,
          subject,
          evidence: `Follow-up was ${followUpDays} day${followUpDays === 1 ? '' : 's'} ago.`,
          draftedAction: { kind: 'open', href: `/contacts/${contact.id}` },
        });
        continue;
      }

      if (isHot && (lastContactDays === null || lastContactDays >= STALE_HOT_LEAD_DAYS)) {
        const phrase =
          lastContactDays === null
            ? 'Hot tier, no contact logged.'
            : `Hot tier, last touch ${lastContactDays} days ago.`;
        signals.push({
          source: 'leads',
          kind: preferredChannel as SignalKind,
          urgency: 2,
          confidence: 0.85,
          subject,
          evidence: phrase,
          draftedAction: { kind: 'open', href: `/contacts/${contact.id}` },
        });
        continue;
      }

      if (isNewLead && (lastContactDays === null || lastContactDays === 0)) {
        signals.push({
          source: 'leads',
          kind: 'reply',
          urgency: 2,
          confidence: 0.78,
          subject,
          evidence: 'New lead, not yet contacted.',
          draftedAction: { kind: 'open', href: `/contacts/${contact.id}` },
        });
      }
    }

    return signals;
  },
};
