import { describe, it, expect } from 'vitest';
import { TOPUPS, PLANS } from '@/lib/plans';

/**
 * Margin guardrail. Every credit can cost up to this much model COGS at
 * worst-case burn (the model-aware metering budget). A credit must therefore
 * retail at >= BUDGET / 0.40 to clear a 60% gross margin. This test fails if a
 * future pack/plan edit prices credits below the 60% floor — a direct money leak.
 */
const CREDIT_COGS_BUDGET_USD = 0.013;
const MIN_MARGIN = 0.6;

function margin(priceUsd: number, credits: number): number {
  const cogs = credits * CREDIT_COGS_BUDGET_USD;
  return (priceUsd - cogs) / priceUsd;
}

describe('top-up packs hold >= 60% margin at worst-case burn', () => {
  for (const pack of Object.values(TOPUPS)) {
    it(`${pack.id}: ${pack.credits} credits @ $${pack.price} clears 60%`, () => {
      expect(margin(pack.price, pack.credits)).toBeGreaterThanOrEqual(MIN_MARGIN);
    });
  }

  it('larger packs are a better per-credit deal (monotonic bulk discount)', () => {
    const byCredits = Object.values(TOPUPS).sort((a, b) => a.credits - b.credits);
    const perCredit = byCredits.map((p) => p.price / p.credits);
    for (let i = 1; i < perCredit.length; i++) {
      expect(perCredit[i]).toBeLessThanOrEqual(perCredit[i - 1]);
    }
  });
});

describe('paid subscription tiers hold >= 60% margin at worst-case burn', () => {
  for (const plan of Object.values(PLANS)) {
    if (plan.priceMonthly <= 0 || plan.monthlyCredits <= 0) continue; // skip Free
    it(`${plan.id}: ${plan.monthlyCredits} credits @ $${plan.priceMonthly}/mo clears 60%`, () => {
      expect(margin(plan.priceMonthly, plan.monthlyCredits)).toBeGreaterThanOrEqual(MIN_MARGIN);
    });
    if (plan.addUser) {
      it(`${plan.id} seat add-on: ${plan.addUser.credits} credits @ $${plan.addUser.priceMonthly} clears 60%`, () => {
        expect(margin(plan.addUser!.priceMonthly, plan.addUser!.credits)).toBeGreaterThanOrEqual(MIN_MARGIN);
      });
    }
  }
});
