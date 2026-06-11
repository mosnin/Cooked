import { describe, expect, it } from 'vitest';
import { __momentumInternals } from '@/lib/briefing/momentum';
import { __tomorrowInternals } from '@/lib/briefing/tomorrow';

const { renderCounts } = __momentumInternals;
const { renderForward } = __tomorrowInternals;

describe('momentum — the yesterday line', () => {
  it('returns null when nothing happened — the right to say nothing', () => {
    expect(renderCounts({ sent: 0, calls: 0, notes: 0, meetings: 0 })).toBeNull();
  });

  it('singularizes counts of one cleanly', () => {
    const line = renderCounts({ sent: 1, calls: 0, notes: 0, meetings: 0 });
    expect(line).toBe('Yesterday: 1 send.');
  });

  it('pluralizes counts greater than one', () => {
    const line = renderCounts({ sent: 4, calls: 0, notes: 0, meetings: 0 });
    expect(line).toBe('Yesterday: 4 sends.');
  });

  it('combines categories with commas and ends with a period', () => {
    const line = renderCounts({ sent: 4, calls: 2, notes: 1, meetings: 0 });
    expect(line).toBe('Yesterday: 4 sends, 2 calls, 1 note.');
  });

  it('caps at three categories so the sentence reads cleanly', () => {
    const line = renderCounts({ sent: 4, calls: 2, notes: 1, meetings: 3 });
    // Order: sends → calls → meetings (notes drops off the tail).
    expect(line).toBe('Yesterday: 4 sends, 2 calls, 3 meetings.');
    expect(line?.split(',').length).toBe(3);
  });
});

describe('tomorrow — the forward look', () => {
  it('returns null when nothing is scheduled — the right to say nothing', () => {
    expect(
      renderForward({
        closingDeal: null,
        closingDealsCount: 0,
        tourCount: 0,
        followUpCount: 0,
      }),
    ).toBeNull();
  });

  it('names a single closing deal explicitly', () => {
    const line = renderForward({
      closingDeal: { name: 'Riverside' },
      closingDealsCount: 1,
      tourCount: 0,
      followUpCount: 0,
    });
    expect(line).toBe('Tomorrow: Riverside closes.');
  });

  it('counts when multiple deals close — names would crowd the sentence', () => {
    const line = renderForward({
      closingDeal: { name: 'Riverside' },
      closingDealsCount: 3,
      tourCount: 0,
      followUpCount: 0,
    });
    expect(line).toBe('Tomorrow: 3 deals close.');
  });

  it('combines closing + tours under a two-piece cap', () => {
    const line = renderForward({
      closingDeal: { name: 'Riverside' },
      closingDealsCount: 1,
      tourCount: 2,
      followUpCount: 0,
    });
    expect(line).toBe('Tomorrow: Riverside closes. 2 tours.');
  });

  it('drops follow-ups when the cap is hit — closings + tours win the slots', () => {
    const line = renderForward({
      closingDeal: { name: 'Riverside' },
      closingDealsCount: 1,
      tourCount: 2,
      followUpCount: 5,
    });
    // Two pieces max — the follow-up count would push the sentence to three.
    expect(line).toBe('Tomorrow: Riverside closes. 2 tours.');
  });

  it('singularizes tour + follow-up correctly', () => {
    expect(
      renderForward({
        closingDeal: null,
        closingDealsCount: 0,
        tourCount: 1,
        followUpCount: 1,
      }),
    ).toBe('Tomorrow: 1 tour. 1 follow-up due.');
  });
});
