import { describe, it, expect, vi, afterEach } from 'vitest';

// PLANS reads price ids from env at module load, so stub them and re-import.
afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('planIdForStripePrice', () => {
  it('maps a live Stripe price id back to its plan (monthly + annual)', async () => {
    vi.stubEnv('STRIPE_PRICE_SOLO', 'price_solo_m');
    vi.stubEnv('STRIPE_PRICE_SOLO_ANNUAL', 'price_solo_y');
    vi.stubEnv('STRIPE_PRICE_PRO', 'price_pro_m');
    vi.stubEnv('STRIPE_PRICE_TEAM', 'price_team_m');
    const { planIdForStripePrice } = await import('@/lib/plans');
    expect(planIdForStripePrice('price_solo_m')).toBe('solo');
    expect(planIdForStripePrice('price_solo_y')).toBe('solo'); // annual maps too
    expect(planIdForStripePrice('price_pro_m')).toBe('pro');
    expect(planIdForStripePrice('price_team_m')).toBe('team');
  });

  it('returns null for an unknown id or when price ids are unset (caller falls back)', async () => {
    const { planIdForStripePrice } = await import('@/lib/plans');
    expect(planIdForStripePrice('price_nope')).toBeNull();
    expect(planIdForStripePrice(null)).toBeNull();
    expect(planIdForStripePrice(undefined)).toBeNull();
  });
});
