/**
 * Tiny date helpers for the calendar surface.
 *
 * We deliberately don't pull `date-fns` for this — every operation we need
 * (start-of-week, start-of-month, addDays, hour grid) is a few lines of
 * vanilla `Date` math. Lighter bundle, one less dep to update, and the
 * logic is right here for the next person to debug.
 *
 * All helpers operate in the realtor's LOCAL timezone — the calendar grid
 * shows wall-clock days/hours, matching how Google Calendar renders.
 */

/** YYYY-MM-DD in the local timezone — stable string key for day grouping/identity. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse "YYYY-MM-DD" back into a local-noon Date (noon avoids DST edge cases). */
export function parseLocalDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Calendar day at local midnight — for math, not display. */
export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Add `n` days; negative subtracts. */
export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Add `n` months; negative subtracts. JS rolls overflow correctly. */
export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setMonth(out.getMonth() + n);
  return out;
}

/** Sunday-anchored start of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const out = startOfLocalDay(d);
  out.setDate(out.getDate() - out.getDay()); // Sunday = 0
  return out;
}

/** First-of-the-month at local midnight. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * The 6×7 grid of days a month view shows — pads with previous month's
 * trailing days and next month's leading days. 42 cells covers every month
 * uniformly (Feb starting on a Sunday is the only month that fits in 28
 * cells; pinning to 42 keeps row count stable so chips don't jump).
 */
export function monthGridDays(monthAnchor: Date): Date[] {
  const first = startOfMonth(monthAnchor);
  const gridStart = startOfWeek(first);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(addDays(gridStart, i));
  }
  return days;
}

/** 7 days starting Sunday-of(`d`). */
export function weekDays(d: Date): Date[] {
  const start = startOfWeek(d);
  const out: Date[] = [];
  for (let i = 0; i < 7; i++) out.push(addDays(start, i));
  return out;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Build an ISO 8601 timestamp WITH the realtor's local timezone offset.
 * Used when posting to Google Calendar — Google needs the offset so the
 * event lands on the wall-clock the realtor picked, not UTC midnight.
 *
 * Inputs are the form's raw "YYYY-MM-DD" and "HH:MM" strings.
 */
export function isoFromLocal(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const localDate = new Date(y, mo - 1, d, hh, mm, 0, 0);
  const offsetMin = -localDate.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offH = pad(Math.floor(abs / 60));
  const offM = pad(abs % 60);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${sign}${offH}:${offM}`;
}

/**
 * All-day ISO date (YYYY-MM-DD) — Google Calendar wants date-only for
 * `start.date` / `end.date`. End is EXCLUSIVE in Google's all-day shape
 * (an all-day event on the 7th has start.date=7th, end.date=8th).
 */
export function allDayDate(dateStr: string): string {
  return dateStr;
}
