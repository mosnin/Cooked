/**
 * Drafts signal source — surfaces pending AgentDraft rows the autonomous
 * agent has produced (from Gmail triggers, routine runs, calendar event
 * handlers, etc.).
 *
 * Why this is in Phase B and not Phase A: AgentDraft is the OUTPUT of
 * the agent's autonomous work. Surfacing drafts in the brief gives the
 * realtor "what Chippi did overnight, ready for your approve" — the
 * single highest-value card type for a working realtor whose agent
 * actually ran.
 *
 * Why this is its own source (not folded into pipeline/leads): drafts
 * are concrete + actionable — the work is already done, just needs a
 * yes/no — while pipeline/leads signals are abstract ("this deal sat
 * too long"). Different confidence ceilings, different verb.
 *
 * Confidence calibration:
 *   - High-priority draft for hot lead:        0.95
 *   - High-priority draft for any lead tier:   0.90
 *   - Standard draft for hot lead:             0.88
 *   - Standard draft, any tier:                0.83
 *
 * The brief shows the top drafts as REPLY cards; the rest stay in the
 * FocusCard queue on /chippi/today. The two surfaces complement: the
 * brief is the morning curated view, the focus card is the working queue.
 */

import { supabase } from '@/lib/supabase';
import { HOT_LEAD_THRESHOLD } from '@/lib/constants';
import type { Signal, SignalGatherer, SignalKind } from '../types';

type DraftRow = {
  id: string;
  contactId: string | null;
  channel: 'sms' | 'email' | 'note';
  subject: string | null;
  priority: number;
  Contact: { id: string; name: string; leadScore: number | null } | null;
};

const HIGH_PRIORITY_THRESHOLD = 5;

function kindForChannel(channel: DraftRow['channel']): SignalKind {
  switch (channel) {
    case 'sms':
      return 'reply';
    case 'email':
      return 'reply';
    case 'note':
      return 'review';
  }
}

function evidenceFor(channel: DraftRow['channel']): string {
  switch (channel) {
    case 'sms':
      return 'Chippi drafted a text. Approve or edit.';
    case 'email':
      return 'Chippi drafted an email. Approve or edit.';
    case 'note':
      return 'Chippi flagged a note for your review.';
  }
}

export const draftsSource: SignalGatherer = {
  // 'drafts' tag is origin-agnostic — these rows are produced by the
  // autonomous agent regardless of what triggered the run (Gmail webhook,
  // routine cron, calendar handler, manual quick-draft). The brief surface
  // shows the realtor "Chippi did this overnight, ready for your approve."
  // Provenance per draft lives on AgentDraft.triggerSource for the rare
  // case the surface wants to attribute (Phase C breadcrumbs).
  source: 'drafts',
  async gather(spaceId: string): Promise<Signal[]> {
    const { data, error } = await supabase
      .from('AgentDraft')
      .select(
        'id, contactId, channel, subject, priority, Contact:contactId(id, name, leadScore)',
      )
      .eq('spaceId', spaceId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('createdAt', { ascending: false })
      .limit(10);

    if (error || !data) return [];

    const signals: Signal[] = [];

    for (const draft of data as unknown as DraftRow[]) {
      // Drafts without a contact link don't surface on the brief — they're
      // working state for the agent, not actionable for the realtor's
      // morning. They still appear in the FocusCard queue if relevant.
      if (!draft.Contact) continue;

      const isHigh = draft.priority >= HIGH_PRIORITY_THRESHOLD;
      const isHot = (draft.Contact.leadScore ?? 0) >= HOT_LEAD_THRESHOLD;

      const confidence = isHigh
        ? isHot
          ? 0.95
          : 0.9
        : isHot
          ? 0.88
          : 0.83;

      signals.push({
        source: 'drafts',
        kind: kindForChannel(draft.channel),
        urgency: isHigh || isHot ? 1 : 2,
        confidence,
        subject: {
          id: draft.Contact.id,
          name: draft.Contact.name,
          href: `/contacts/${draft.Contact.id}`,
        },
        evidence: evidenceFor(draft.channel),
        // Open the contact page where the draft surfaces in context. The
        // brief intentionally doesn't carry the draft body inline — that's
        // the FocusCard's job, where the realtor has the editing UI ready.
        draftedAction: {
          kind: 'open',
          href: `/contacts/${draft.Contact.id}?draftId=${draft.id}`,
        },
      });
    }

    return signals;
  },
};
