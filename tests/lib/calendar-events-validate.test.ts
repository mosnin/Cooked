/**
 * Manual-event creation — validator + date-helper unit tests.
 *
 * Composio + Supabase live behind network/auth and aren't worth mocking
 * here. What IS worth locking in:
 *
 *   - The validator rejects every wrong-shape input the UI could send
 *     (missing title, end-before-start, malformed email, etc.) and
 *     normalizes a correct payload to the exact shape `writeEventThrough`
 *     expects. If this drifts, the POST handler bleeds 500s into the
 *     realtor's UI from inside Composio.
 *
 *   - The month-grid helper always returns 42 days (6 weeks × 7) so the
 *     calendar surface doesn't relayout when months have different
 *     starting days. If this changes the grid jumps a row, which feels
 *     broken regardless of why.
 */

import { describe, expect, it } from 'vitest';
import { validateCreatePayload } from '@/lib/calendar/event-validation';
import {
  monthGridDays,
  startOfMonth,
  startOfWeek,
  weekDays,
  addDays,
  localDayKey,
} from '@/lib/calendar/date';

describe('validateCreatePayload', () => {
  const baseTimed = {
    title: 'Tour @ 456 Oak',
    startDate: '2026-06-10',
    startTime: '09:00',
    endDate: '2026-06-10',
    endTime: '10:00',
  };

  it('accepts a clean timed payload', () => {
    const res = validateCreatePayload(baseTimed);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.title).toBe('Tour @ 456 Oak');
    expect(res.value.allDay).toBe(false);
    expect(res.value.startsAt).toMatch(/^2026-06-10T09:00:00/);
    expect(res.value.endsAt).toMatch(/^2026-06-10T10:00:00/);
    expect(res.value.attendees).toEqual([]);
  });

  it('rejects missing title', () => {
    const res = validateCreatePayload({ ...baseTimed, title: '   ' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/title/i);
  });

  it('rejects end-before-start', () => {
    const res = validateCreatePayload({
      ...baseTimed,
      startTime: '10:00',
      endTime: '09:00',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/end/i);
  });

  it('rejects end equal to start (zero-length event)', () => {
    const res = validateCreatePayload({
      ...baseTimed,
      startTime: '10:00',
      endTime: '10:00',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed start date', () => {
    const res = validateCreatePayload({ ...baseTimed, startDate: 'tomorrow' });
    expect(res.ok).toBe(false);
  });

  it('rejects malformed time', () => {
    const res = validateCreatePayload({ ...baseTimed, startTime: '9am' });
    expect(res.ok).toBe(false);
  });

  it('accepts and bumps end to next-day midnight for all-day single-day event', () => {
    const res = validateCreatePayload({
      title: 'Open house',
      allDay: true,
      startDate: '2026-06-10',
      endDate: '2026-06-10',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.allDay).toBe(true);
    // All-day is modeled as a 24h timed event for the Composio wrapper.
    expect(res.value.startsAt).toMatch(/^2026-06-10T00:00:00/);
    expect(res.value.endsAt).toMatch(/^2026-06-11T00:00:00/);
  });

  it('validates attendee emails', () => {
    const good = validateCreatePayload({
      ...baseTimed,
      attendees: ['sam@example.com', 'jordan@example.com'],
    });
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.value.attendees).toHaveLength(2);

    const bad = validateCreatePayload({
      ...baseTimed,
      attendees: ['sam@example.com', 'not-an-email'],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toMatch(/email/i);
  });

  it('strips empty attendee strings without erroring', () => {
    const res = validateCreatePayload({
      ...baseTimed,
      attendees: ['', '  ', 'sam@example.com'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.attendees).toEqual([{ email: 'sam@example.com' }]);
  });

  it('rejects non-array attendees coming as garbage', () => {
    const res = validateCreatePayload({
      ...baseTimed,
      attendees: ['ok@example.com', 42 as unknown as string],
    });
    expect(res.ok).toBe(false);
  });
});

describe('month grid helpers', () => {
  it('monthGridDays always returns 42 cells (6 weeks)', () => {
    // February 2026 starts on a Sunday — the tight-fit case.
    const feb = new Date(2026, 1, 1);
    expect(monthGridDays(feb)).toHaveLength(42);
    // November 2026 starts on a Sunday, ends on a Monday.
    const nov = new Date(2026, 10, 1);
    expect(monthGridDays(nov)).toHaveLength(42);
    // June 2026 starts on a Monday — needs leading prev-month day.
    const jun = new Date(2026, 5, 1);
    expect(monthGridDays(jun)).toHaveLength(42);
  });

  it('first cell is the Sunday on or before the 1st of the month', () => {
    // June 1, 2026 is a Monday → grid starts May 31 (Sunday).
    const grid = monthGridDays(new Date(2026, 5, 15));
    const first = grid[0];
    expect(first.getDay()).toBe(0);
    expect(localDayKey(first)).toBe('2026-05-31');
  });

  it('weekDays returns 7 Sunday-anchored days', () => {
    // Wed June 10, 2026 → week starts Sun June 7.
    const week = weekDays(new Date(2026, 5, 10));
    expect(week).toHaveLength(7);
    expect(week[0].getDay()).toBe(0);
    expect(localDayKey(week[0])).toBe('2026-06-07');
    expect(localDayKey(week[6])).toBe('2026-06-13');
  });

  it('startOfMonth anchors to the 1st at local midnight', () => {
    const d = startOfMonth(new Date(2026, 5, 15, 14, 30));
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('startOfWeek + addDays round-trip a week', () => {
    const some = new Date(2026, 5, 11);
    const start = startOfWeek(some);
    expect(addDays(start, 7).getTime()).toBe(addDays(some, 7 - some.getDay()).getTime());
  });
});
