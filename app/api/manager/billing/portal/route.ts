import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getManagerContext } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';

/**
 * Manager-scoped Stripe Billing Portal session.
 *
 * The rep portal route (/api/billing/portal) is keyed to a Space the caller
 * OWNS — a manager managing the team subscription needs the TEAM's
 * Stripe customer instead. Auth mirrors the team checkout branch:
 * getManagerContext() + manager_owner only.
 */
export async function POST() {
  const ctx = await getManagerContext();
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (ctx.membership.role !== 'manager_owner') {
    return NextResponse.json(
      { error: 'Only the team owner can manage billing.' },
      { status: 403 },
    );
  }

  const { allowed } = await checkRateLimit(`billing:team:${ctx.dbUserId}`, 5, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // Prefer the Team's own Stripe customer (team-scoped checkout writes
  // it). Legacy teams that subscribed through the owner's personal Space
  // fall back to that customer so the portal still opens for them.
  const { data: team } = await supabase
    .from('Team')
    .select('stripeCustomerId')
    .eq('id', ctx.team.id)
    .maybeSingle();

  let customerId = (team?.stripeCustomerId as string | null) ?? null;
  if (!customerId) {
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('stripeCustomerId')
      .eq('ownerId', ctx.team.ownerId)
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://my.usekoala.com';

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/manager/billing`,
  });

  return NextResponse.json({ url: session.url });
}
