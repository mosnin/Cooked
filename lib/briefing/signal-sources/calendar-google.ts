/**
 * Google Calendar signal source — reads what the realtor scheduled
 * OUTSIDE Chippi (listing presentations, lender meetings, coffee with
 * referral sources). The internal `calendar` source covers Chippi-native
 * Tour rows; this one covers everything else.
 *
 * The brief's rule: only name people the realtor recognizes. We drop
 * any event whose attendees don't cross-walk to a Contact by email.
 * No matched contact, no card — the calendar exists for the full list.
 *
 * Three signals (urgency / confidence / kind):
 *   1. Event today within next 4h, matched contact          prep · 1 · 0.92
 *   2. Event tomorrow with matched contact (no recent thread) prep · 2 · 0.82
 *   3. Matched-contact attendee declined an event today
 *      AND the attendee-response trigger fired in last 24h    reply · 1 · 0.88
 *
 * One Composio call per gather() — GOOGLECALENDAR_EVENTS_LIST with
 * timeMin=now / timeMax=now+36h. 3s timeout; on timeout/error/missing
 * connection, return []. The brief should never be blocked by a slow
 * external API.
 */

import { supabase } from '@/lib/supabase';
import { executeToolForEntity, composioConfigured } from '@/lib/integrations/composio';
import type { Signal, SignalGatherer } from '../types';

const MS_PER_HOUR = 1000 * 60 * 60;
const COMPOSIO_TIMEOUT_MS = 3000;
const LOOKAHEAD_HOURS = 36;
const ATTENDEE_TRIGGER_SLUG = 'GOOGLECALENDAR_ATTENDEE_RESPONSE_CHANGED_TRIGGER';

interface CalendarEventAttendee {
  email?: string | null;
  responseStatus?: string | null;
  displayName?: string | null;
  self?: boolean | null;
}

interface CalendarEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: CalendarEventAttendee[] | null;
}

interface ContactLite {
  id: string;
  name: string;
  email: string | null;
}

export type TimeWindow = 'within-4h' | 'today-later' | 'tomorrow' | 'outside';

/**
 * Classify an event start time into one of the three windows the brief
 * cares about, or 'outside' if it doesn't earn a card.
 *
 * 'within-4h' covers right now → 4h from now.
 * 'today-later' covers >4h from now but still on today's local date.
 * 'tomorrow' covers tomorrow's local date.
 * Everything else is 'outside'.
 *
 * Pure function — drives the test suite. The composer doesn't see it.
 */
export function classifyWindow(eventStart: Date, now: Date): TimeWindow {
  const hoursAway = (eventStart.getTime() - now.getTime()) / MS_PER_HOUR;
  if (hoursAway < 0) return 'outside';
  if (hoursAway <= 4) return 'within-4h';
  const startDay = startOfLocalDay(eventStart);
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (startDay.getTime() === today.getTime()) return 'today-later';
  if (startDay.getTime() === tomorrow.getTime()) return 'tomorrow';
  return 'outside';
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Match the first attendee on an event to a known Contact by email
 * (case-insensitive). Returns null when no attendee matches — the brief
 * drops the signal in that case.
 *
 * `self`-flagged attendees (the realtor's own account) are skipped: the
 * realtor isn't the subject of their own brief card.
 */
export function matchAttendeeToContact(
  attendees: CalendarEventAttendee[] | null | undefined,
  contactsByEmail: Map<string, ContactLite>,
): ContactLite | null {
  if (!Array.isArray(attendees)) return null;
  for (const a of attendees) {
    if (a.self) continue;
    const email = (a.email ?? '').trim().toLowerCase();
    if (!email) continue;
    const match = contactsByEmail.get(email);
    if (match) return match;
  }
  return null;
}

/** Find the attendee marked declined, if any matched a known Contact. */
export function findDeclinedContact(
  attendees: CalendarEventAttendee[] | null | undefined,
  contactsByEmail: Map<string, ContactLite>,
): ContactLite | null {
  if (!Array.isArray(attendees)) return null;
  for (const a of attendees) {
    if (a.self) continue;
    if ((a.responseStatus ?? '').toLowerCase() !== 'declined') continue;
    const email = (a.email ?? '').trim().toLowerCase();
    if (!email) continue;
    const match = contactsByEmail.get(email);
    if (match) return match;
  }
  return null;
}

function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Best-effort wrapper around the Composio call. 3s timeout, never throws. */
async function listEventsWithTimeout(
  userId: string,
  now: Date,
): Promise<CalendarEvent[]> {
  if (!composioConfigured()) return [];
  const timeMax = new Date(now.getTime() + LOOKAHEAD_HOURS * MS_PER_HOUR);

  const exec = executeToolForEntity({
    entityId: userId,
    slug: 'GOOGLECALENDAR_EVENTS_LIST',
    arguments: {
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    },
  });

  const timeout = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), COMPOSIO_TIMEOUT_MS),
  );

  let res: unknown;
  try {
    res = await Promise.race([exec, timeout]);
  } catch {
    return [];
  }
  if (!res) return [];

  const data = (res as { data?: unknown }).data;
  if (data && typeof data === 'object') {
    const items = (data as { items?: unknown; events?: unknown }).items
      ?? (data as { events?: unknown }).events;
    if (Array.isArray(items)) return items as CalendarEvent[];
  }
  // V3 responses sometimes nest under `output` or return items at the top
  const items = (res as { items?: unknown }).items;
  if (Array.isArray(items)) return items as CalendarEvent[];
  return [];
}

/** Did the realtor's attendee-response trigger fire within the last 24h? */
async function attendeeTriggerFiredRecently(connectionId: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - 24 * MS_PER_HOUR).toISOString();
  const { data } = await supabase
    .from('IntegrationTrigger')
    .select('lastFiredAt')
    .eq('connectionId', connectionId)
    .eq('triggerSlug', ATTENDEE_TRIGGER_SLUG)
    .eq('status', 'active')
    .maybeSingle();
  const fired = (data as { lastFiredAt?: string | null } | null)?.lastFiredAt ?? null;
  return Boolean(fired && fired >= cutoff);
}

export const calendarGoogleSource: SignalGatherer = {
  source: 'calendar_google',
  async gather(spaceId: string): Promise<Signal[]> {
    // 1. Find an active Calendar connection. No connection → return [].
    //    The toolkit is 'googlecalendar' per Composio; we accept the rare
    //    'calendar' alias defensively (older catalog rows).
    const { data: connRows } = await supabase
      .from('IntegrationConnection')
      .select('id, userId, toolkit, status')
      .eq('spaceId', spaceId)
      .in('toolkit', ['googlecalendar', 'calendar'])
      .eq('status', 'active')
      .limit(1);
    const connection = (connRows ?? [])[0] as
      | { id: string; userId: string; toolkit: string; status: string }
      | undefined;
    if (!connection) return [];

    // 2. Pull events (Composio) and the realtor's contacts (Supabase) in
    //    parallel — both are independent and the brief budget is tight.
    const now = new Date();
    const [events, contactRows] = await Promise.all([
      listEventsWithTimeout(connection.userId, now),
      supabase
        .from('Contact')
        .select('id, name, email')
        .eq('spaceId', spaceId)
        .not('email', 'is', null),
    ]);
    if (events.length === 0) return [];

    const contactsByEmail = new Map<string, ContactLite>();
    for (const c of (contactRows.data ?? []) as ContactLite[]) {
      const email = (c.email ?? '').trim().toLowerCase();
      if (email) contactsByEmail.set(email, c);
    }
    if (contactsByEmail.size === 0) return [];

    // 3. Only check the attendee-response trigger if any candidate is a
    //    decline (saves a DB hit on the typical no-declines case).
    let declinedTriggerChecked = false;
    let declinedTriggerFired = false;

    const signals: Signal[] = [];

    for (const event of events) {
      const startIso = event.start?.dateTime ?? event.start?.date ?? null;
      if (!startIso) continue;
      const startDate = new Date(startIso);
      if (isNaN(startDate.getTime())) continue;

      const window = classifyWindow(startDate, now);
      if (window === 'outside') continue;

      // Decline path — runs first because it's a different verb (reply vs
      // prep) and only competes with the "today" windows.
      if (window === 'within-4h' || window === 'today-later') {
        const declined = findDeclinedContact(event.attendees, contactsByEmail);
        if (declined) {
          if (!declinedTriggerChecked) {
            declinedTriggerFired = await attendeeTriggerFiredRecently(connection.id);
            declinedTriggerChecked = true;
          }
          if (declinedTriggerFired) {
            const time = formatLocalTime(startDate);
            const eventLabel = event.summary?.trim() || 'the meeting';
            signals.push({
              source: 'calendar_google',
              kind: 'reply',
              urgency: 1,
              confidence: 0.88,
              subject: {
                id: declined.id,
                name: declined.name,
                href: `/contacts/${declined.id}`,
              },
              evidence: `${declined.name} declined ${eventLabel} at ${time}.`,
              draftedAction: { kind: 'open', href: `/contacts/${declined.id}` },
            });
            continue;
          }
        }
      }

      // Prep path — needs a matched (non-declined) attendee.
      const matched = matchAttendeeToContact(event.attendees, contactsByEmail);
      if (!matched) continue;

      const eventLabel = event.summary?.trim() || 'Meeting';
      const time = formatLocalTime(startDate);

      if (window === 'within-4h') {
        signals.push({
          source: 'calendar_google',
          kind: 'prep',
          urgency: 1,
          confidence: 0.92,
          subject: {
            id: matched.id,
            name: matched.name,
            href: `/contacts/${matched.id}`,
          },
          evidence: `${eventLabel} with ${matched.name} at ${time}.`,
          draftedAction: { kind: 'open', href: `/contacts/${matched.id}` },
        });
        continue;
      }

      if (window === 'tomorrow') {
        signals.push({
          source: 'calendar_google',
          kind: 'prep',
          urgency: 2,
          confidence: 0.82,
          subject: {
            id: matched.id,
            name: matched.name,
            href: `/contacts/${matched.id}`,
          },
          evidence: `${eventLabel} with ${matched.name} tomorrow ${time}.`,
          draftedAction: { kind: 'open', href: `/contacts/${matched.id}` },
        });
      }
      // 'today-later' (>4h out, same day) without a decline produces no
      // signal — by design. The within-4h window is the actionable one;
      // anything later today the realtor will see in their calendar.
    }

    return signals;
  },
};
