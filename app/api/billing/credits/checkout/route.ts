import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { requireSpaceOwner } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { TOPUPS, type TopupId } from '@/lib/plans';
import { resolveBillingAccount } from '@/lib/billing/account';

/**
 * Buy-more-credits checkout — a one-time Stripe payment for a top-up pack.
 * On success the webhook (checkout.session.completed, mode=payment) grants the
 * credits via grantTopup. Credits land on the space's billing account, which is
 * the brokerage pool for Team/Team Plus (resolveBillingAccount handles that).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { slug, topup } = body ?? {};
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
    if (!topup || !(topup in TOPUPS)) {
      return NextResponse.json({ error: 'valid topup pack required' }, { status: 400 });
    }
    const pack = TOPUPS[topup as TopupId];
    if (!pack.stripePrice) {
      return NextResponse.json({ error: 'Top-ups are not configured yet.' }, { status: 503 });
    }

    const auth = await requireSpaceOwner(slug);
    if (auth instanceof NextResponse) return auth;
    const { userId, space } = auth;

    const { allowed } = await checkRateLimit(`topup:${userId}`, 5, 60);
    if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    let stripe;
    try {
      stripe = getStripe();
    } catch {
      return NextResponse.json({ error: 'Stripe not configured. Contact support.' }, { status: 500 });
    }

    // Which balance does this space fund? Team/Team Plus pool at the brokerage.
    const { account } = await resolveBillingAccount(space.id);

    // Use the FUNDING account's Stripe customer, not the space's. For a
    // Team/Team Plus space the balance pools at the brokerage, whose customer
    // lives on Brokerage.stripeCustomerId — the space's own customer is usually
    // null. Reading it from the space made checkout mint a brand-new guest
    // customer, which the webhook's anti-poisoning guard (it compares the
    // account's stored customer to session.customer) then rejected → the team
    // was CHARGED but granted ZERO credits.
    const customerTable = account.type === 'brokerage' ? 'Brokerage' : 'Space';
    const { data: custRow } = await supabase
      .from(customerTable)
      .select('stripeCustomerId')
      .eq('id', account.id)
      .single();
    const customerId = custRow?.stripeCustomerId ?? undefined;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://my.usechippi.com';
    // Recorded on both the session and the payment intent so the webhook can
    // read it regardless of which object it inspects.
    const metadata = {
      topup,
      accountType: account.type,
      accountId: account.id,
      spaceId: space.id,
    };

    const session = await stripe.checkout.sessions.create({
      ...(customerId ? { customer: customerId } : {}),
      mode: 'payment',
      line_items: [{ price: pack.stripePrice, quantity: 1 }],
      success_url: `${appUrl}/s/${slug}/billing?topup=success`,
      cancel_url: `${appUrl}/s/${slug}/billing?topup=cancel`,
      metadata,
      payment_intent_data: { metadata },
    });

    return NextResponse.json({ url: session.url });
  } catch (err: unknown) {
    console.error('[topup-checkout]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Checkout failed' }, { status: 500 });
  }
}
