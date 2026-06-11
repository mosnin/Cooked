/**
 * Calendar signal source — reads today's Tour rows from the realtor's
 * Chippi-internal calendar.
 *
 * Phase B adds the external Google Calendar source as a sibling file
 * (`calendar-google.ts`). Both produce the same shape of signal; the
 * composer doesn't know or care which source contributed.
 *
 * Confidence calibration:
 *   - Tour within next 4 hours: 0.92 (prep)
 *   - Tour later today: 0.85 (prep)
 */

import { supabase } from '@/lib/supabase';
import type { Signal, SignalGatherer } from '../types';

const MS_PER_HOUR = 1000 * 60 * 60;

type TourRow = {
  id: string;
  startsAt: string;
  contactId: string | null;
  guestName: string | null;
  propertyAddress: string | null;
  status: string;
};

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export const calendarSource: SignalGatherer = {
  source: 'calendar',
  async gather(spaceId: string): Promise<Signal[]> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('Tour')
      .select('id, startsAt, contactId, guestName, propertyAddress, status')
      .eq('spaceId', spaceId)
      .gte('startsAt', now.toISOString())
      .lt('startsAt', tomorrow.toISOString())
      .neq('status', 'cancelled');

    if (error || !data) return [];

    const signals: Signal[] = [];

    for (const tour of data as TourRow[]) {
      const startDate = new Date(tour.startsAt);
      if (isNaN(startDate.getTime())) continue;

      const hoursAway = (startDate.getTime() - now.getTime()) / MS_PER_HOUR;
      const guestName = tour.guestName?.trim() || 'A guest';
      const time = formatLocalTime(tour.startsAt);
      const address = tour.propertyAddress?.trim();
      const evidencePieces = [`${time}`, address ? `${address}` : null].filter(Boolean);

      const href = tour.contactId ? `/contacts/${tour.contactId}` : `/calendar`;

      signals.push({
        source: 'calendar',
        kind: 'prep',
        urgency: hoursAway <= 4 ? 1 : 2,
        confidence: hoursAway <= 4 ? 0.92 : 0.85,
        subject: {
          id: tour.id,
          name: `${guestName} · tour`,
          href,
        },
        evidence: evidencePieces.join(' · '),
        draftedAction: { kind: 'open', href },
      });
    }

    return signals;
  },
};
