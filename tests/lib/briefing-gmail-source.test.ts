import { describe, expect, it } from 'vitest';
import {
  classifyQuietThread,
  daysBetween,
  evidenceForQuiet,
  evidenceForSkippedInbound,
  parseEmailAddress,
} from '@/lib/briefing/signal-sources/gmail';
import { HOT_LEAD_THRESHOLD } from '@/lib/constants';

describe('briefing — gmail signal source (pure helpers)', () => {
  describe('parseEmailAddress', () => {
    it('pulls the address out of a "Name <addr>" header', () => {
      expect(parseEmailAddress('Sarah Chen <sarah@example.com>')).toBe('sarah@example.com');
    });

    it('lower-cases the address so cross-walk is case-insensitive', () => {
      expect(parseEmailAddress('Marco <Marco.Reyes@Example.COM>')).toBe('marco.reyes@example.com');
    });

    it('accepts a bare address', () => {
      expect(parseEmailAddress('jenna@pak.dev')).toBe('jenna@pak.dev');
    });

    it('returns null for empty, undefined, or malformed input', () => {
      expect(parseEmailAddress(null)).toBeNull();
      expect(parseEmailAddress(undefined)).toBeNull();
      expect(parseEmailAddress('')).toBeNull();
      expect(parseEmailAddress('   ')).toBeNull();
      expect(parseEmailAddress('no-at-sign')).toBeNull();
    });
  });

  describe('daysBetween', () => {
    it('returns whole-day delta floored', () => {
      const from = new Date('2026-05-20T08:00:00Z');
      const to = new Date('2026-05-24T07:00:00Z');
      // 3.96 days → 3 (floored). We use ints to match user-facing copy.
      expect(daysBetween(from, to)).toBe(3);
    });

    it('returns 0 for same instant', () => {
      const d = new Date('2026-05-20T08:00:00Z');
      expect(daysBetween(d, d)).toBe(0);
    });
  });

  describe('classifyQuietThread', () => {
    it('surfaces a hot-tier thread quiet for 2+ days at urgency 1, 0.90', () => {
      const result = classifyQuietThread({
        leadScore: HOT_LEAD_THRESHOLD,
        daysSinceLastRealtorMessage: 2,
        lastRealtorMessageChars: 30, // hot tier doesn't need the >100 floor
      });
      expect(result).toEqual({ urgency: 1, confidence: 0.9 });
    });

    it('still surfaces a hot-tier thread on day 4 at the hot calibration', () => {
      // The hot rule wins before the any-tier rule even has a chance.
      const result = classifyQuietThread({
        leadScore: HOT_LEAD_THRESHOLD + 5,
        daysSinceLastRealtorMessage: 4,
        lastRealtorMessageChars: 200,
      });
      expect(result).toEqual({ urgency: 1, confidence: 0.9 });
    });

    it('skips a hot-tier thread quiet only 1 day (under the 2-day threshold)', () => {
      expect(
        classifyQuietThread({
          leadScore: HOT_LEAD_THRESHOLD,
          daysSinceLastRealtorMessage: 1,
          lastRealtorMessageChars: 250,
        }),
      ).toBeNull();
    });

    it('surfaces an any-tier thread quiet 4+ days with a >100-char realtor message at urgency 2, 0.85', () => {
      const result = classifyQuietThread({
        leadScore: HOT_LEAD_THRESHOLD - 30,
        daysSinceLastRealtorMessage: 4,
        lastRealtorMessageChars: 101,
      });
      expect(result).toEqual({ urgency: 2, confidence: 0.85 });
    });

    it('skips an any-tier thread when the last realtor message was a 99-char drive-by', () => {
      // The 100-char floor is the cheap proxy for "real touch vs trivia."
      // A "got it, thanks" doesn't earn a follow-up nag.
      expect(
        classifyQuietThread({
          leadScore: 20,
          daysSinceLastRealtorMessage: 5,
          lastRealtorMessageChars: 99,
        }),
      ).toBeNull();
    });

    it('skips an any-tier thread quiet only 3 days (under the 4-day threshold)', () => {
      expect(
        classifyQuietThread({
          leadScore: 20,
          daysSinceLastRealtorMessage: 3,
          lastRealtorMessageChars: 500,
        }),
      ).toBeNull();
    });

    it('treats null leadScore as cold (any-tier rule still applies)', () => {
      // A contact with no score isn't hot — must clear the any-tier bar.
      expect(
        classifyQuietThread({
          leadScore: null,
          daysSinceLastRealtorMessage: 4,
          lastRealtorMessageChars: 150,
        }),
      ).toEqual({ urgency: 2, confidence: 0.85 });
      expect(
        classifyQuietThread({
          leadScore: null,
          daysSinceLastRealtorMessage: 2,
          lastRealtorMessageChars: 150,
        }),
      ).toBeNull();
    });
  });

  describe('evidence copy', () => {
    it('names the contact and the day — calm, no emoji', () => {
      const text = evidenceForQuiet({
        contactName: 'Sarah Chen',
        daysSinceLastRealtorMessage: 4,
        isHot: false,
      });
      expect(text).toContain('Sarah Chen');
      expect(text).toContain('4 days ago');
      expect(text).not.toMatch(/[!]/);
      expect(text).not.toContain('Hot tier');
    });

    it('adds the "Hot tier." tag when the contact is hot', () => {
      const text = evidenceForQuiet({
        contactName: 'Marco Reyes',
        daysSinceLastRealtorMessage: 2,
        isHot: true,
      });
      expect(text).toContain('Marco Reyes');
      expect(text).toContain('Hot tier');
    });

    it('uses "yesterday" rather than "1 days ago"', () => {
      const text = evidenceForQuiet({
        contactName: 'Sam',
        daysSinceLastRealtorMessage: 1,
        isHot: false,
      });
      expect(text).toContain('yesterday');
      expect(text).not.toContain('1 days');
    });

    it('skipped-inbound evidence names the contact and explains the silence', () => {
      const text = evidenceForSkippedInbound({ contactName: 'Jenna Pak' });
      expect(text).toContain('Jenna Pak');
      expect(text.toLowerCase()).toContain("didn't draft");
      expect(text).not.toMatch(/[!]/);
    });
  });
});
