/**
 * Calendar-Google signal source — unit tests for the pure helpers.
 *
 * The Composio call itself is integration territory (network + auth) and
 * isn't worth mocking for value. What IS worth locking in:
 *
 *   - Time-window classification matches the design's three buckets
 *     (within-4h, today-later, tomorrow) and rejects everything else.
 *     A drift here means the brief surfaces meetings it shouldn't, or
 *     misses meetings it should — both feel like the product is broken.
 *
 *   - Attendee → Contact crosswalk is case-insensitive on email and skips
 *     self-flagged attendees (the realtor's own account). Without these,
 *     the brief would either name nobody (cards drop) or name the realtor
 *     as the subject of their own card.
 *
 *   - Decline detection finds the matched-contact decliner; absent any
 *     matched decliner, returns null (no card).
 */

import { describe, expect, it } from 'vitest';
import {
  classifyWindow,
  matchAttendeeToContact,
  findDeclinedContact,
} from '@/lib/briefing/signal-sources/calendar-google';

const HOUR_MS = 60 * 60 * 1000;

describe('calendar-google source — time-window classification', () => {
  // Fixed 10am-local reference so all the offsets are easy to reason about.
  const now = new Date(2026, 4, 30, 10, 0, 0);

  it('classifies an event two hours from now as within-4h', () => {
    const eventAt = new Date(now.getTime() + 2 * HOUR_MS);
    expect(classifyWindow(eventAt, now)).toBe('within-4h');
  });

  it('classifies an event exactly at the 4h boundary as within-4h', () => {
    const eventAt = new Date(now.getTime() + 4 * HOUR_MS);
    expect(classifyWindow(eventAt, now)).toBe('within-4h');
  });

  it('classifies an event 6h out, same day, as today-later', () => {
    const eventAt = new Date(now.getTime() + 6 * HOUR_MS);
    expect(classifyWindow(eventAt, now)).toBe('today-later');
  });

  it('classifies an event tomorrow morning as tomorrow', () => {
    const eventAt = new Date(2026, 4, 31, 10, 0, 0);
    expect(classifyWindow(eventAt, now)).toBe('tomorrow');
  });

  it('classifies an event the day after tomorrow as outside', () => {
    const eventAt = new Date(2026, 5, 1, 10, 0, 0);
    expect(classifyWindow(eventAt, now)).toBe('outside');
  });

  it('classifies a past event as outside (the brief is forward-looking)', () => {
    const eventAt = new Date(now.getTime() - HOUR_MS);
    expect(classifyWindow(eventAt, now)).toBe('outside');
  });

  it('still treats late-evening today as today-later, not tomorrow', () => {
    // 9pm local today, when "now" is 10am — 11h out, but same date.
    const eventAt = new Date(2026, 4, 30, 21, 0, 0);
    expect(classifyWindow(eventAt, now)).toBe('today-later');
  });

  it('treats an event tomorrow at 1am as within-4h when now is 10pm', () => {
    // Edge: a 1am-next-day event is < 4 hours away from a 10pm now.
    // Proximity wins over the day boundary, by design: the brief cares
    // about how soon, not which calendar day.
    const lateNow = new Date(2026, 4, 30, 22, 0, 0);
    const earlyTomorrow = new Date(2026, 4, 31, 1, 0, 0);
    expect(classifyWindow(earlyTomorrow, lateNow)).toBe('within-4h');
  });
});

describe('calendar-google source — attendee crosswalk', () => {
  const contactsByEmail = new Map([
    ['dani@example.com', { id: 'c-dani', name: 'Dani Ortega', email: 'dani@example.com' }],
    ['marco@example.com', { id: 'c-marco', name: 'Marco Reyes', email: 'marco@example.com' }],
  ]);

  it('matches an attendee whose email is in the contacts map', () => {
    const match = matchAttendeeToContact(
      [{ email: 'dani@example.com', responseStatus: 'accepted' }],
      contactsByEmail,
    );
    expect(match?.id).toBe('c-dani');
  });

  it('matches case-insensitively on the email', () => {
    const match = matchAttendeeToContact(
      [{ email: 'Dani@Example.com', responseStatus: 'accepted' }],
      contactsByEmail,
    );
    expect(match?.id).toBe('c-dani');
  });

  it('skips the self-flagged attendee (the realtor themselves)', () => {
    const match = matchAttendeeToContact(
      [
        { email: 'realtor@brokerage.com', self: true, responseStatus: 'accepted' },
        { email: 'dani@example.com', responseStatus: 'accepted' },
      ],
      contactsByEmail,
    );
    expect(match?.id).toBe('c-dani');
  });

  it('returns null when no attendee matches a known contact', () => {
    const match = matchAttendeeToContact(
      [{ email: 'stranger@elsewhere.com', responseStatus: 'accepted' }],
      contactsByEmail,
    );
    expect(match).toBeNull();
  });

  it('returns null on missing / empty attendees', () => {
    expect(matchAttendeeToContact(null, contactsByEmail)).toBeNull();
    expect(matchAttendeeToContact([], contactsByEmail)).toBeNull();
    expect(matchAttendeeToContact(undefined, contactsByEmail)).toBeNull();
  });

  it('returns the first matching attendee when several are present', () => {
    // The brief surfaces one card per event. When two known contacts are
    // on the same invite, the first match wins — deterministic by source
    // order so the test is stable.
    const match = matchAttendeeToContact(
      [
        { email: 'marco@example.com', responseStatus: 'accepted' },
        { email: 'dani@example.com', responseStatus: 'accepted' },
      ],
      contactsByEmail,
    );
    expect(match?.id).toBe('c-marco');
  });
});

describe('calendar-google source — decline detection', () => {
  const contactsByEmail = new Map([
    ['marco@example.com', { id: 'c-marco', name: 'Marco Reyes', email: 'marco@example.com' }],
    ['dani@example.com', { id: 'c-dani', name: 'Dani Ortega', email: 'dani@example.com' }],
  ]);

  it('returns the contact whose responseStatus is declined', () => {
    const declined = findDeclinedContact(
      [
        { email: 'dani@example.com', responseStatus: 'accepted' },
        { email: 'marco@example.com', responseStatus: 'declined' },
      ],
      contactsByEmail,
    );
    expect(declined?.id).toBe('c-marco');
  });

  it('is case-insensitive on responseStatus', () => {
    const declined = findDeclinedContact(
      [{ email: 'marco@example.com', responseStatus: 'DECLINED' }],
      contactsByEmail,
    );
    expect(declined?.id).toBe('c-marco');
  });

  it('returns null when the decliner is not a known contact', () => {
    const declined = findDeclinedContact(
      [{ email: 'stranger@elsewhere.com', responseStatus: 'declined' }],
      contactsByEmail,
    );
    expect(declined).toBeNull();
  });

  it('returns null when no attendee declined', () => {
    const declined = findDeclinedContact(
      [
        { email: 'dani@example.com', responseStatus: 'accepted' },
        { email: 'marco@example.com', responseStatus: 'tentative' },
      ],
      contactsByEmail,
    );
    expect(declined).toBeNull();
  });

  it('skips a self-flagged declining attendee (the realtor declined their own meeting)', () => {
    const declined = findDeclinedContact(
      [{ email: 'realtor@brokerage.com', self: true, responseStatus: 'declined' }],
      contactsByEmail,
    );
    expect(declined).toBeNull();
  });
});
