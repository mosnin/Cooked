/**
 * Momentum line — the one-sentence summary of what the realtor did
 * yesterday. Rendered as plain prose at the bottom of the brief.
 *
 * The rule: only one sentence, only render when there was real movement,
 * return null otherwise. The right to say nothing applies here too — a
 * realtor who didn't act yesterday doesn't need a momentum line that
 * sounds like a tiny disappointment.
 *
 * Counted today:
 *   - AgentDrafts that flipped to 'sent' yesterday (the agent + realtor
 *     loop's main output)
 *   - ContactActivity rows authored yesterday by type (call, email logged
 *     manually, note, meeting)
 *
 * Future (Phase C, when Gmail thread visibility lands):
 *   - Opens, replies, thread health changes
 */

import { supabase } from '@/lib/supabase';

interface Counts {
  sent: number;
  calls: number;
  notes: number;
  meetings: number;
}

function yesterdayBounds(): { start: string; end: string } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setUTCDate(startOfYesterday.getUTCDate() - 1);
  return { start: startOfYesterday.toISOString(), end: startOfToday.toISOString() };
}

function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`;
  return `${count} ${plural ?? `${singular}s`}`;
}

function renderCounts(counts: Counts): string | null {
  const pieces: string[] = [];
  if (counts.sent > 0) pieces.push(pluralize(counts.sent, 'send'));
  if (counts.calls > 0) pieces.push(pluralize(counts.calls, 'call'));
  if (counts.meetings > 0) pieces.push(pluralize(counts.meetings, 'meeting'));
  if (counts.notes > 0) pieces.push(pluralize(counts.notes, 'note'));

  if (pieces.length === 0) return null;

  // Cap to three so the sentence reads cleanly. The fourth slot is the
  // tail of a long day; surfacing it would push past one breath of prose.
  const shown = pieces.slice(0, 3);
  return `Yesterday: ${shown.join(', ')}.`;
}

export async function composeMomentum(spaceId: string): Promise<string | null> {
  const { start, end } = yesterdayBounds();

  const [sentRes, activityRes] = await Promise.all([
    supabase
      .from('AgentDraft')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', spaceId)
      .eq('status', 'sent')
      .gte('updatedAt', start)
      .lt('updatedAt', end),
    supabase
      .from('ContactActivity')
      .select('type')
      .eq('spaceId', spaceId)
      .gte('createdAt', start)
      .lt('createdAt', end),
  ]);

  const counts: Counts = { sent: sentRes.count ?? 0, calls: 0, notes: 0, meetings: 0 };

  if (activityRes.data) {
    for (const row of activityRes.data as { type: string }[]) {
      switch (row.type) {
        case 'call':
          counts.calls += 1;
          break;
        case 'email':
          counts.sent += 1;
          break;
        case 'meeting':
          counts.meetings += 1;
          break;
        case 'note':
          counts.notes += 1;
          break;
      }
    }
  }

  return renderCounts(counts);
}

export const __momentumInternals = { renderCounts };
