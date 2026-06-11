import { describe, it, expect } from 'vitest';
import { pickSpacePriceId } from '@/lib/stripe';

/**
 * Guards the space-checkout money-mapping. The bug this replaces charged a
 * single STRIPE_PRICE_ID for everyone and reverse-derived the plan label from
 * it, so Pro was unpurchasable and a buyer could be charged for the wrong tier.
 * Now price and label both come from the selected plan.
 */
describe('pickSpacePriceId', () => {
  const P = (soloMonthly: string | null, proMonthly: string | null, legacy: string | null) =>
    ({ soloMonthly, proMonthly, legacy });

  it('Solo uses its own monthly price when set', () => {
    expect(pickSpacePriceId('solo', P('price_solo', 'price_pro', 'price_legacy'))).toBe('price_solo');
  });

  it('Solo falls back to the legacy STRIPE_PRICE_ID when its own price is unset', () => {
    expect(pickSpacePriceId('solo', P(null, 'price_pro', 'price_legacy'))).toBe('price_legacy');
  });

  it('Solo returns null when neither its price nor the legacy price is set', () => {
    expect(pickSpacePriceId('solo', P(null, 'price_pro', null))).toBeNull();
  });

  it('Pro uses its own monthly price when set', () => {
    expect(pickSpacePriceId('pro', P('price_solo', 'price_pro', 'price_legacy'))).toBe('price_pro');
  });

  it('Pro does NOT fall back to the legacy Solo price — returns null instead of mischarging', () => {
    expect(pickSpacePriceId('pro', P('price_solo', null, 'price_legacy'))).toBeNull();
  });
});
