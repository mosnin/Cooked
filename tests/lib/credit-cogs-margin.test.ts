import { describe, it, expect } from 'vitest';
import { PLANS, CREDIT_COGS_BUDGET_USD, creditsForCostUsd } from '@/lib/plans';

/**
 * Locks the margin guarantee behind model-aware credit metering: consuming a
 * plan's FULL monthly credit allotment (each credit = CREDIT_COGS_BUDGET_USD of
 * token COGS) must leave >= 60% gross margin on every paid tier, including the
 * per-seat add-ons (the binding constraint). If someone lowers a plan price,
 * raises monthlyCredits, or bumps CREDIT_COGS_BUDGET_USD past the safe point,
 * this fails before margin erodes in production.
 */
describe('credit COGS budget holds >=60% margin at full utilization', () => {
  const marginAtFull = (priceMonthly: number, credits: number) =>
    1 - (credits * CREDIT_COGS_BUDGET_USD) / priceMonthly;

  for (const id of ['solo', 'pro', 'team', 'team_plus'] as const) {
    const p = PLANS[id];
    it(`${id} base plan >= 60% margin`, () => {
      expect(marginAtFull(p.priceMonthly, p.monthlyCredits)).toBeGreaterThanOrEqual(0.6);
    });
    if (p.addUser) {
      it(`${id} add-on seat >= 60% margin`, () => {
        expect(marginAtFull(p.addUser!.priceMonthly, p.addUser!.credits)).toBeGreaterThanOrEqual(0.6);
      });
    }
  }
});

describe('creditsForCostUsd', () => {
  it('floors at 1 credit for a near-free turn', () => {
    expect(creditsForCostUsd(0)).toBe(1);
    expect(creditsForCostUsd(0.0001)).toBe(1);
  });
  it('scales with cost (ceil of cost / budget)', () => {
    expect(creditsForCostUsd(0.0175)).toBe(2);   // grok turn
    expect(creditsForCostUsd(0.175)).toBe(14);   // Claude Opus turn
    expect(creditsForCostUsd(0.30)).toBe(24);    // gpt-5.5 turn
  });
});
