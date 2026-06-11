import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getBrokerContext } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Broker-scoped subscription cancel (at period end).
 *
 * Mirrors /api/billing/cancel but targets the BROKERAGE's subscription, not a
 * Space the caller owns. Same auth as the brokerage checkout branch:
 * getBrokerContext() + broker_owner only. The webhook keeps DB status in sync
 * when the cancellation lands.
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

  // Brokerage subscription first; legacy owner-space subscription as fallback.
  const { data: brokerage } = await supabase
    .from('Brokerage')
    .select('stripeSubscriptionId')
    .eq('id', ctx.brokerage.id)
    .maybeSingle();

  let subscriptionId = (brokerage?.stripeSubscriptionId as string | null) ?? null;
  if (!subscriptionId) {
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('stripeSubscriptionId')
      .eq('ownerId', ctx.brokerage.ownerId)
      .maybeSingle();
    subscriptionId = (ownerSpace?.stripeSubscriptionId as string | null) ?? null;
  }

  if (!subscriptionId) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  const stripe = getStripe();

  // Cancel at end of billing period (not immediately) — same policy as the
  // realtor cancel route.
  await stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });

  return NextResponse.json({ ok: true });
}
