import { describe, expect, it } from 'vitest';
import { localHourIn, localDateIn, shouldGenerateFor } from '@/lib/briefing/timing';

describe('briefing — per-realtor timing', () => {
  describe('localHourIn', () => {
    it('converts a UTC noon to local hour in New York (EST is UTC-5)', () => {
      // 2026-01-15 12:00 UTC = 07:00 EST (no DST in January)
      const at = new Date('2026-01-15T12:00:00Z');
      expect(localHourIn(at, 'America/New_York')).toBe(7);
    });

    it('converts a UTC noon to local hour in Los Angeles (PST is UTC-8)', () => {
      // 2026-01-15 12:00 UTC = 04:00 PST
      const at = new Date('2026-01-15T12:00:00Z');
      expect(localHourIn(at, 'America/Los_Angeles')).toBe(4);
    });

    it('respects DST offsets for the same UTC instant', () => {
      // 2026-07-15 12:00 UTC = 08:00 EDT (DST)
      // 2026-01-15 12:00 UTC = 07:00 EST (no DST)
      // The local hour changes even though briefHour=7 stays the same —
      // the cron will fire one UTC hour earlier in summer.
      const summerNoon = new Date('2026-07-15T12:00:00Z');
      const winterNoon = new Date('2026-01-15T12:00:00Z');
      expect(localHourIn(summerNoon, 'America/New_York')).toBe(8);
      expect(localHourIn(winterNoon, 'America/New_York')).toBe(7);
    });

    it('handles midnight wraparound (returns 0, not 24)', () => {
      // 2026-01-15 05:00 UTC = 00:00 EST
      const at = new Date('2026-01-15T05:00:00Z');
      expect(localHourIn(at, 'America/New_York')).toBe(0);
    });

    it('falls back to UTC hour when timezone is invalid', () => {
      const at = new Date('2026-01-15T12:00:00Z');
      expect(localHourIn(at, 'Not/A_Real_Timezone')).toBe(12);
    });
  });

  describe('localDateIn', () => {
    it('returns the local YYYY-MM-DD date in the given timezone', () => {
      // 2026-01-15 03:00 UTC = 22:00 PST on 2026-01-14
      const at = new Date('2026-01-15T03:00:00Z');
      expect(localDateIn(at, 'America/Los_Angeles')).toBe('2026-01-14');
    });

    it('falls back to UTC date when timezone is invalid', () => {
      const at = new Date('2026-01-15T12:00:00Z');
      expect(localDateIn(at, 'Not/A_Real_Timezone')).toBe('2026-01-15');
    });
  });

  describe('shouldGenerateFor', () => {
    it('returns the local forDate when the hour matches', () => {
      // 2026-01-15 12:00 UTC = 07:00 EST. briefHour=7 → match.
      const at = new Date('2026-01-15T12:00:00Z');
      expect(shouldGenerateFor(at, 'America/New_York', 7)).toBe('2026-01-15');
    });

    it('returns null when the hour does not match', () => {
      const at = new Date('2026-01-15T12:00:00Z');
      // briefHour=8, but local is 7 — skip this tick.
      expect(shouldGenerateFor(at, 'America/New_York', 8)).toBeNull();
    });

    it('rejects an out-of-range briefHour', () => {
      const at = new Date('2026-01-15T12:00:00Z');
      expect(shouldGenerateFor(at, 'America/New_York', -1)).toBeNull();
      expect(shouldGenerateFor(at, 'America/New_York', 24)).toBeNull();
    });

    it('uses the local date — Pacific realtor at briefHour=7 gets the right day', () => {
      // 2026-01-15 15:00 UTC = 07:00 PST on 2026-01-15
      const at = new Date('2026-01-15T15:00:00Z');
      expect(shouldGenerateFor(at, 'America/Los_Angeles', 7)).toBe('2026-01-15');
    });
  });
});
