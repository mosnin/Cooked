import { describe, expect, it } from 'vitest';
import { buildBriefSms } from '@/lib/briefing/sms-template';

const ORIGIN = 'https://my.usechippi.com';

describe('briefing — SMS template builder', () => {
  it('produces a single-segment body for a short headline', () => {
    const { body, truncated } = buildBriefSms({
      headline: 'Sarah Chen replied.',
      spaceSlug: 'patel-realty',
      briefDate: '2026-05-30',
      appOrigin: ORIGIN,
    });
    expect(body.startsWith('Chippi: ')).toBe(true);
    expect(body).toContain('Sarah Chen replied.');
    expect(body).toContain(`${ORIGIN}/s/patel-realty/chippi?brief=2026-05-30`);
    expect(body.length).toBeLessThanOrEqual(160);
    expect(truncated).toBe(false);
  });

  it('strips newlines and tabs from the headline', () => {
    const { body } = buildBriefSms({
      headline: 'Sarah\nChen\treplied.',
      spaceSlug: 'x',
      briefDate: '2026-05-30',
      appOrigin: ORIGIN,
    });
    expect(body).not.toContain('\n');
    expect(body).not.toContain('\t');
    expect(body).toContain('Sarah Chen replied.');
  });

  it('truncates long headlines on a word boundary with an ellipsis', () => {
    const long =
      'Sarah Chen replied with detailed questions about the inspection report and the closing schedule and the wire transfer instructions for the Friday close';
    const { body, truncated } = buildBriefSms({
      headline: long,
      spaceSlug: 'x',
      briefDate: '2026-05-30',
      appOrigin: ORIGIN,
    });
    expect(body.length).toBeLessThanOrEqual(160);
    expect(truncated).toBe(true);
    expect(body).toContain('…');
    // Verify it ends with ellipsis + space + the URL — no mid-word cut.
    expect(body).toMatch(/[^\s]+…\s+https/);
  });

  it('never produces a body longer than 160 chars', () => {
    const veryLong = 'A'.repeat(500);
    const { body } = buildBriefSms({
      headline: veryLong,
      spaceSlug: 'x',
      briefDate: '2026-05-30',
      appOrigin: ORIGIN,
    });
    expect(body.length).toBeLessThanOrEqual(160);
  });

  it('handles a long URL by aggressively truncating the headline', () => {
    const longishHeadline = 'Sarah Chen finally replied to your follow-up about the disclosure';
    const longishSlug = 'patel-realty-of-greater-boston-llc';
    const { body, truncated } = buildBriefSms({
      headline: longishHeadline,
      spaceSlug: longishSlug,
      briefDate: '2026-05-30',
      appOrigin: ORIGIN,
    });
    expect(body.length).toBeLessThanOrEqual(160);
    expect(body).toContain(longishSlug);
    if (truncated) {
      expect(body).toContain('…');
    }
  });
});
