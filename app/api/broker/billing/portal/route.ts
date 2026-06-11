import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getBrokerContext } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Broker-scoped Stripe Billing Portal session.
 *
 * The realtor portal route (/api/billing/portal) is keyed to a Space the caller
 * OWNS — a broker managing the brokerage subscription needs the BROKERAGE's
 * Stripe customer instead. Auth mirrors the brokerage checkout branch:
 * getBrokerContext() + broker_owner only.
 */
export async function POST() {
  const ctx = await getBrokerContext();
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (ctx.membership.role !== 'broker_owner') {
    return NextResponse.json(
      { error: 'Only the brokerage owner can manage billing.' },
      { status: 403 },
    );
  }

  const { allowed } = await checkRateLimit(`billing:brokerage:${ctx.dbUserId}`, 5, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // Prefer the Brokerage's own Stripe customer (brokerage-scoped checkout writes
  // it). Legacy brokerages that subscribed through the owner's personal Space
  // fall back to that customer so the portal still opens for them.
  const { data: brokerage } = await supabase
    .from('Brokerage')
    .select('stripeCustomerId')
    .eq('id', ctx.brokerage.id)
    .maybeSingle();

  let customerId = (brokerage?.stripeCustomerId as string | null) ?? null;
  if (!customerId) {
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('stripeCustomerId')
      .eq('ownerId', ctx.brokerage.ownerId)
      .maybeSingle();
    customerId = (ownerSpace?.stripeCustomerId as string | null) ?? null;
  }

  if (!customerId) {
    return NextResponse.json(
      { error: 'No billing account found. Subscribe first.' },
      { status: 400 },
    );
  }

  const stripe = getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://my.usechippi.com';

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/broker/billing`,
  });

  return NextResponse.json({ url: session.url });
}
