import { describe, it, expect } from 'vitest';
import { isSubscriptionDelinquent } from '@/lib/api-auth';

/**
 * Dunning gate decision: which subscription states pause premium AI. The danger
 * is over-blocking — if 'inactive'/'trialing'/'active' ever slipped into the
 * delinquent set, free, trial, or paying customers would be locked out of the
 * AI. This pins the exact, narrow set that gets gated.
 */
describe('isSubscriptionDelinquent', () => {
  it('gates only a lapsed PAID subscription', () => {
    expect(isSubscriptionDelinquent('past_due')).toBe(true);
    expect(isSubscriptionDelinquent('canceled')).toBe(true);
    expect(isSubscriptionDelinquent('unpaid')).toBe(true);
  });

  it('never gates free / trial / active / unknown', () => {
    expect(isSubscriptionDelinquent('inactive')).toBe(false); // free / never subscribed
    expect(isSubscriptionDelinquent('trialing')).toBe(false);
    expect(isSubscriptionDelinquent('active')).toBe(false);
    expect(isSubscriptionDelinquent(null)).toBe(false);
    expect(isSubscriptionDelinquent(undefined)).toBe(false);
  });
});
