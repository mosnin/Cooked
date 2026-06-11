/**
 * Per-realtor brief timing — translates the cron's UTC tick into "is it
 * this realtor's briefing hour right now, in their own timezone."
 *
 * The cron at /api/cron/daily-briefing runs hourly (UTC). Each tick,
 * every space's `briefHour` is compared against the local hour in that
 * space's timezone. Match → the space gets a brief generated for today's
 * local date. No match → skip; the next hour will check again.
 *
 * Why per-realtor local time: a 7am brief at UTC is 2am in Pacific time.
 * The realtor wakes up to a brief from yesterday. The Vitruvian principle
 * for time: the realtor's morning is the unit, not the server's clock.
 */

/**
 * Returns the hour-of-day (0-23) at `at` in the given IANA timezone.
 * Falls back to UTC if the timezone string is invalid.
 */
export function localHourIn(at: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour12: false,
      hour: '2-digit',
    });
    const parsed = parseInt(formatter.format(at), 10);
    if (Number.isNaN(parsed)) return at.getUTCHours();
    // Intl.DateTimeFormat can return '24' for midnight in some locales —
    // map that back to 0.
    return parsed % 24;
  } catch {
    return at.getUTCHours();
  }
}

/**
 * Returns the local date (YYYY-MM-DD) at `at` in the given IANA timezone.
 * Used as the `forDate` key on Brief rows so the realtor's "today's brief"
 * matches the date they see on their phone, not the server's UTC date.
 *
 * Falls back to UTC date if the timezone is invalid.
 */
export function localDateIn(at: Date, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(at); // en-CA yields YYYY-MM-DD
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Decide whether to generate a brief for this space right now.
 *
 * Match rule: the current UTC `at` lands in the space's `briefHour` when
 * translated to its local timezone. So the cron's hourly tick at 12:00 UTC
 * generates briefs for:
 *   - America/New_York spaces with briefHour=7 or 8 (depending on DST)
 *   - America/Los_Angeles spaces with briefHour=4 or 5
 *   - Europe/London spaces with briefHour=12
 *   - Etc.
 *
 * Returns the `forDate` to use if it matches, or null if not.
 */
export function shouldGenerateFor(
  at: Date,
  timezone: string,
  briefHour: number,
): string | null {
  if (briefHour < 0 || briefHour > 23) return null;
  const hour = localHourIn(at, timezone);
  if (hour !== briefHour) return null;
  return localDateIn(at, timezone);
}
