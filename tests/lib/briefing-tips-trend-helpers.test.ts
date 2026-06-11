import { describe, expect, it } from 'vitest';
import {
  replyRate,
  rateDropPoints,
  isReplyRateSampleStable,
  replyRateConfidence,
  stageStagnationConfidence,
  tourConversionConfidence,
  median,
  interArrivalDays,
} from '@/lib/briefing/tips/tip-categories';
import { coolDownDaysFor } from '@/lib/briefing/tips/cool-down';

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

describe('trend tips — pure rate math', () => {
  it('replyRate returns 0 for zero sends — caller decides if 0 is meaningful', () => {
    expect(replyRate(0, 0)).toBe(0);
    expect(replyRate(0, 5)).toBe(0); // defensive: still zero, no NaN
  });

  it('replyRate is replies / sends', () => {
    expect(replyRate(10, 5)).toBeCloseTo(0.5);
    expect(replyRate(14, 7)).toBeCloseTo(0.5);
    expect(replyRate(100, 31)).toBeCloseTo(0.31);
  });

  it('rateDropPoints reports the rounded percentage-point gap, prior minus current', () => {
    expect(rateDropPoints(0.52, 0.31)).toBe(21);
    expect(rateDropPoints(0.5, 0.5)).toBe(0);
    expect(rateDropPoints(0.3, 0.5)).toBe(-20); // rose — not a decline
  });

  it('rateDropPoints rounds half-cases consistently with Math.round', () => {
    // 0.155 prior, 0.0 current → 15.5pt drop → Math.round → 16
    expect(rateDropPoints(0.155, 0)).toBe(16);
  });
});

describe('trend tips — denominator stability', () => {
  it('rejects prior weeks below the 10-send floor — too small to compare', () => {
    expect(isReplyRateSampleStable(0)).toBe(false);
    expect(isReplyRateSampleStable(9)).toBe(false);
  });

  it('accepts 10+ sends as a stable denominator', () => {
    expect(isReplyRateSampleStable(10)).toBe(true);
    expect(isReplyRateSampleStable(100)).toBe(true);
  });
});

describe('trend tips — confidence ladders match the spec', () => {
  it('replyRateConfidence ramps to 0.90 only at 25+pt drop AND 20+ sends', () => {
    expect(replyRateConfidence(15, 10)).toBe(0.8);
    expect(replyRateConfidence(24, 30)).toBe(0.8); // big sample but small drop
    expect(replyRateConfidence(30, 19)).toBe(0.8); // big drop but small sample
    expect(replyRateConfidence(25, 20)).toBe(0.9);
    expect(replyRateConfidence(40, 50)).toBe(0.9);
  });

  it('stageStagnationConfidence ramps to 0.92 only at 5+ deals AND 30+ days', () => {
    expect(stageStagnationConfidence(3, 21)).toBe(0.85);
    expect(stageStagnationConfidence(4, 60)).toBe(0.85); // size short
    expect(stageStagnationConfidence(6, 29)).toBe(0.85); // age short
    expect(stageStagnationConfidence(5, 30)).toBe(0.92);
    expect(stageStagnationConfidence(10, 90)).toBe(0.92);
  });

  it('tourConversionConfidence steps up at 6 tours', () => {
    expect(tourConversionConfidence(4)).toBe(0.78);
    expect(tourConversionConfidence(5)).toBe(0.78);
    expect(tourConversionConfidence(6)).toBe(0.88);
    expect(tourConversionConfidence(12)).toBe(0.88);
  });
});

describe('trend tips — source dry spell math', () => {
  it('median of an empty array is 0 — safe default for "no history"', () => {
    expect(median([])).toBe(0);
  });

  it('median of an odd-length array is the middle value', () => {
    expect(median([1, 5, 9])).toBe(5);
    expect(median([3])).toBe(3);
  });

  it('median of an even-length array is the mean of the two middles', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20])).toBe(15);
  });

  it('median is order-independent — sorts internally', () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([4, 3, 2, 1])).toBe(2.5);
  });

  it('interArrivalDays returns an empty list for fewer than two timestamps', () => {
    expect(interArrivalDays([])).toEqual([]);
    expect(interArrivalDays([Date.now()])).toEqual([]);
  });

  it('interArrivalDays computes gaps in days between consecutive timestamps', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z');
    const t1 = t0 + 3 * ONE_DAY_MS;
    const t2 = t1 + 10 * ONE_DAY_MS;
    expect(interArrivalDays([t0, t1, t2])).toEqual([3, 10]);
  });
});

describe('trend tips — cool-down policy', () => {
  it('all four C2 trend categories get a 14-day cool-down', () => {
    expect(coolDownDaysFor('reply_rate_decline', 'shown')).toBe(14);
    expect(coolDownDaysFor('stage_stagnation', 'shown')).toBe(14);
    expect(coolDownDaysFor('tour_conversion_drop', 'shown')).toBe(14);
    expect(coolDownDaysFor('source_dry_spell', 'shown')).toBe(14);
  });

  it('C2 trend categories still get 60 days when dismissed', () => {
    expect(coolDownDaysFor('reply_rate_decline', 'dismissed')).toBe(60);
    expect(coolDownDaysFor('stage_stagnation', 'dismissed')).toBe(60);
    expect(coolDownDaysFor('tour_conversion_drop', 'dismissed')).toBe(60);
    expect(coolDownDaysFor('source_dry_spell', 'dismissed')).toBe(60);
  });

  it('acted resets all trend cool-downs to 0 — fresh trigger fires again', () => {
    expect(coolDownDaysFor('reply_rate_decline', 'acted')).toBe(0);
    expect(coolDownDaysFor('stage_stagnation', 'acted')).toBe(0);
    expect(coolDownDaysFor('tour_conversion_drop', 'acted')).toBe(0);
    expect(coolDownDaysFor('source_dry_spell', 'acted')).toBe(0);
  });
});
