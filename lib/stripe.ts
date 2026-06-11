import Stripe from 'stripe';

let _stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('Missing STRIPE_SECRET_KEY environment variable');
  }

  _stripe = new Stripe(key);
  return _stripe;
}

/**
 * Pick the Stripe price id for a space tier. Pure (prices injected) so the
 * money-mapping is unit-testable and can't silently regress.
 * - Solo: its own monthly price, falling back to the legacy single-price env
 *   (STRIPE_PRICE_ID) so existing prod keeps charging the right Solo price
 *   until STRIPE_PRICE_SOLO is set.
 * - Pro: its own monthly price only — there was never a legacy Pro price, so a
 *   missing one returns null (the caller refuses checkout rather than silently
 *   charging the Solo price, the bug this replaces).
 */
export function pickSpacePriceId(
  plan: 'solo' | 'pro',
  prices: { soloMonthly: string | null; proMonthly: string | null; legacy: string | null },
): string | null {
  const direct = plan === 'pro' ? prices.proMonthly : prices.soloMonthly;
  if (direct) return direct;
  return plan === 'solo' ? prices.legacy : null;
}
