/**
 * Tomorrow line — the one-sentence forward look at the bottom of the brief.
 *
 * The realtor reads the brief, sees what today needs, and looks one day
 * out. Not a calendar, not a schedule — one sentence naming the one or
 * two loudest things on the horizon so they finish today with the next
 * day already framed.
 *
 * The rule, same as momentum: only one sentence, only render when there's
 * something concrete to name, return null otherwise. Filler kills trust.
 *
 * What we name (priority order, top two win):
 *   - Deals closing tomorrow (named subject)
 *   - Tours scheduled tomorrow (named or counted, depending on quantity)
 *   - Follow-ups due tomorrow (counted)
 */

import { supabase } from '@/lib/supabase';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function tomorrowBounds(): { start: string; end: string; dateOnly: string } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + MS_PER_DAY);
  const endOfTomorrow = new Date(startOfTomorrow.getTime() + MS_PER_DAY);
  const dateOnly = startOfTomorrow.toISOString().slice(0, 10);
  return {
    start: startOfTomorrow.toISOString(),
    end: endOfTomorrow.toISOString(),
    dateOnly,
  };
}

interface ForwardItems {
  closingDeal: { name: string } | null;
  closingDealsCount: number;
  tourCount: number;
  followUpCount: number;
}

function renderForward(items: ForwardItems): string | null {
  const pieces: string[] = [];

  // Closing deals come first — money on the line, biggest signal.
  if (items.closingDeal && items.closingDealsCount === 1) {
    pieces.push(`${items.closingDeal.name} closes`);
  } else if (items.closingDealsCount > 1) {
    pieces.push(`${items.closingDealsCount} deals close`);
  }

  if (items.tourCount > 0) {
    pieces.push(items.tourCount === 1 ? '1 tour' : `${items.tourCount} tours`);
  }

  if (items.followUpCount > 0) {
    pieces.push(
      items.followUpCount === 1
        ? '1 follow-up due'
        : `${items.followUpCount} follow-ups due`,
    );
  }

  if (pieces.length === 0) return null;

  // Two-piece cap. Mirror momentum's "one breath of prose" rule.
  const shown = pieces.slice(0, 2);
  return `Tomorrow: ${shown.join('. ')}.`;
}

export async function composeTomorrow(spaceId: string): Promise<string | null> {
  const { start, end, dateOnly } = tomorrowBounds();

  const [closingRes, toursRes, followUpsRes] = await Promise.all([
    supabase
      .from('Deal')
      .select('id, title')
      .eq('spaceId', spaceId)
      .eq('status', 'active')
      .eq('closeDate', dateOnly),
    supabase
      .from('Tour')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', spaceId)
      .gte('startsAt', start)
      .lt('startsAt', end)
      .neq('status', 'cancelled'),
    supabase
      .from('Contact')
      .select('id', { count: 'exact', head: true })
      .eq('spaceId', spaceId)
      .is('brokerageId', null)
      .gte('followUpAt', start)
      .lt('followUpAt', end),
  ]);

  const closingRows = (closingRes.data ?? []) as { id: string; title: string }[];
  const items: ForwardItems = {
    closingDeal: closingRows.length > 0 ? { name: closingRows[0].title } : null,
    closingDealsCount: closingRows.length,
    tourCount: toursRes.count ?? 0,
    followUpCount: followUpsRes.count ?? 0,
  };

  return renderForward(items);
}

export const __tomorrowInternals = { renderForward };
