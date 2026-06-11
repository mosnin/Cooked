import { NextRequest, NextResponse } from 'next/server';
import { getStripe, pickSpacePriceId } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { requireSpaceOwner } from '@/lib/api-auth';
import { getManagerContext } from '@/lib/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { PLANS } from '@/lib/plans';

type TeamPlan = 'team' | 'team_plus';

/** Map plan → Stripe price env var. */
function getTeamPriceEnv(plan: TeamPlan): string | undefined {
  switch (plan) {
    case 'team':
      return process.env.STRIPE_PRICE_TEAM;
    case 'team_plus':
      return process.env.STRIPE_PRICE_TEAM_PLUS;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const scope = body?.scope;

    if (scope === 'team') {
      return handleTeamCheckout(req, body);
    }

    // ── Space flow ─────────────────────────────────────────────────────────
    const { slug } = body;
    if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

    // The tier the buyer selected. Default to Solo for backward compatibility
    // (the existing client posts only { slug }). This is the single source of
    // truth for BOTH the price charged and the plan label provisioned, so the
    // two can never disagree the way they did when price came from a lone
    // STRIPE_PRICE_ID env and the label was reverse-derived from it.
    const spacePlan: 'solo' | 'pro' = body?.plan === 'pro' ? 'pro' : 'solo';

    const auth = await requireSpaceOwner(slug);
    if (auth instanceof NextResponse) return auth;
    const { userId, space } = auth;

    const { allowed } = await checkRateLimit(`billing:${userId}`, 5, 60);
    if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

    // Fetch Stripe columns separately (getSpaceFromSlug doesn't include them)
    const { data: stripeData, error: stripeQueryErr } = await supabase
      .from('Space')
      .select('stripeCustomerId, stripeSubscriptionId, stripeSubscriptionStatus, stripePeriodEnd, trialUsedAt, ownerId')
      .eq('id', space.id)
      .single();

    if (stripeQueryErr) {
      console.error('[checkout] Stripe column query failed:', stripeQueryErr.message, stripeQueryErr.code);
      return NextResponse.json({ error: "Couldn't check subscription status — usually temporary." }, { status: 500 });
    }

    // Block if user already has an active or trialing subscription
    const currentStatus = stripeData?.stripeSubscriptionStatus;
    if (currentStatus === 'active' || currentStatus === 'trialing') {
      return NextResponse.json({ error: 'You already have an active subscription.' }, { status: 400 });
    }

    // If they have a failed/past_due subscription, direct them to billing portal instead
    if (stripeData?.stripeSubscriptionId && (currentStatus === 'past_due' || currentStatus === 'unpaid')) {
      return NextResponse.json({
        error: 'You have an existing subscription with a payment issue. Please update your payment method in billing settings.',
        redirect: `/s/${slug}/billing`,
      }, { status: 400 });
    }

    let stripe;
    try {
      stripe = getStripe();
    } catch (err: any) {
      console.error('[checkout] Stripe init failed:', err.message);
      return NextResponse.json({ error: 'Stripe not configured. Contact support.' }, { status: 500 });
    }

    // Resolve the Stripe price from the selected tier via lib/plans.ts (single
    // source of truth). See pickSpacePriceId for the Solo legacy fallback.
    const priceId = pickSpacePriceId(spacePlan, {
      soloMonthly: PLANS.solo.stripePriceMonthly,
      proMonthly: PLANS.pro.stripePriceMonthly,
      legacy: process.env.STRIPE_PRICE_ID ?? null,
    });
    if (!priceId) {
      console.error('[checkout] No Stripe price configured for plan:', spacePlan);
      return NextResponse.json({ error: 'Billing not configured. Contact support.' }, { status: 503 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://my.usekoala.com';

    // Reuse existing Stripe customer or create one
    let customerId = stripeData?.stripeCustomerId;
    if (!customerId) {
      const { data: user } = await supabase
        .from('User')
        .select('email, name')
        .eq('id', space.ownerId)
        .single();

      console.log('[checkout] Creating Stripe customer for space:', space.id);
      // Idempotency key bound to the space — two concurrent checkout
      // requests for the same space hit Stripe with the same key and
      // Stripe returns the SAME customer object on both calls instead
      // of creating two. The DB CAS below is the second layer of
      // protection; the idempotency key prevents the orphan from
      // existing in Stripe at all. Without it, racing creates left
      // unreferenced customers sitting in Stripe's customer list
      // forever (cosmetic bloat, audit confusion).
      const customer = await stripe.customers.create(
        {
          email: user?.email,
          name: user?.name || undefined,
          metadata: { spaceId: space.id, slug: space.slug },
        },
        { idempotencyKey: `customer-create:space:${space.id}` },
      );
      customerId = customer.id;

      // Conditional write: only persist if another request hasn't already set a customer ID.
      // If this update affects 0 rows (stripeCustomerId was already set by a concurrent request),
      // fetch the winner's customer ID and use that instead — abandoning the duplicate we just created.
      const { data: updateResult } = await supabase
        .from('Space')
        .update({ stripeCustomerId: customerId })
        .eq('id', space.id)
        .is('stripeCustomerId', null)
        .select('stripeCustomerId')
        .single();

      if (!updateResult) {
        // Another concurrent request already set a customer ID — fetch and use theirs
        const { data: winner } = await supabase
          .from('Space')
          .select('stripeCustomerId')
          .eq('id', space.id)
          .single();
        if (winner?.stripeCustomerId) {
          customerId = winner.stripeCustomerId;
        }
      }
    }

    // spacePlan (resolved above from the buyer's selection) is stamped on the
    // subscription metadata so the webhook grants the right monthly credits and
    // labels Space.plan to match exactly what was charged.

    // Only grant a 7-day trial if the user has never used one before
    const hasUsedTrial = !!stripeData?.trialUsedAt;
    const subscriptionData: Record<string, unknown> = {
      metadata: { spaceId: space.id, plan: spacePlan },
    };
    if (!hasUsedTrial) {
      subscriptionData.trial_period_days = 7;
    }

    console.log('[checkout] Creating checkout session, customer:', customerId, 'price:', priceId, 'trial:', !hasUsedTrial);
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subscriptionData,
      success_url: `${appUrl}/s/${slug}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/subscribe?slug=${slug}`,
      metadata: { spaceId: space.id, plan: spacePlan },
    });

    console.log('[checkout] Session created:', session.id, 'url:', session.url?.slice(0, 50));
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error('[checkout] FAILED:', err.message, err.stack?.slice(0, 200));
    return NextResponse.json({ error: "Checkout didn't go through — usually temporary." }, { status: 500 });
  }
}

/**
 * Team-scoped checkout: creates/uses a Stripe customer + subscription
 * attached to the Team row (NOT the manager_owner's personal Space).
 */
async function handleTeamCheckout(
  _req: NextRequest,
  body: { plan?: string; scope?: string },
): Promise<NextResponse> {
  // Auth: must be a manager (owner or admin), then enforce manager_owner only
  const ctx = await getManagerContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.membership.role !== 'manager_owner') {
    return NextResponse.json(
      { error: 'Only the team owner can manage billing.' },
      { status: 403 },
    );
  }

  // Rate limit per authenticated DB user
  const { allowed } = await checkRateLimit(`billing:team:${ctx.dbUserId}`, 5, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  // Validate plan input
  const plan = body?.plan as TeamPlan | undefined;
  if (plan !== 'team' && plan !== 'team_plus') {
    return NextResponse.json(
      { error: 'plan must be one of: team, team_plus' },
      { status: 400 },
    );
  }

  const priceId = getTeamPriceEnv(plan);
  if (!priceId) {
    console.error('[checkout:team] Plan not configured:', plan);
    return NextResponse.json({ error: 'Plan not configured' }, { status: 503 });
  }

  // Load live Stripe columns for the Team row (may not be on ctx.team type yet)
  const { data: teamStripe, error: teamQueryErr } = await supabase
    .from('Team')
    .select('id, name, ownerId, stripeCustomerId, stripeSubscriptionId, stripeSubscriptionStatus')
    .eq('id', ctx.team.id)
    .single();

  if (teamQueryErr || !teamStripe) {
    console.error(
      '[checkout:team] Team query failed:',
      teamQueryErr?.message,
      teamQueryErr?.code,
    );
    return NextResponse.json(
      { error: "Couldn't load team — usually temporary." },
      { status: 500 },
    );
  }

  // Block if the team already has an active or trialing subscription
  const currentStatus = teamStripe.stripeSubscriptionStatus;
  if (currentStatus === 'active' || currentStatus === 'trialing') {
    return NextResponse.json(
      { error: 'Your team already has an active subscription.' },
      { status: 400 },
    );
  }
  if (
    teamStripe.stripeSubscriptionId &&
    (currentStatus === 'past_due' || currentStatus === 'unpaid')
  ) {
    return NextResponse.json(
      {
        error:
          'Your team has an existing subscription with a payment issue. Please update your payment method in billing settings.',
        redirect: `/manager/billing`,
      },
      { status: 400 },
    );
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch (err: any) {
    console.error('[checkout:team] Stripe init failed:', err.message);
    return NextResponse.json({ error: 'Stripe not configured. Contact support.' }, { status: 500 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://my.usekoala.com';

  // Reuse existing Stripe customer or create one (concurrency-safe)
  let customerId = teamStripe.stripeCustomerId ?? null;
  if (!customerId) {
    const { data: owner } = await supabase
      .from('User')
      .select('email, name')
      .eq('id', teamStripe.ownerId)
      .single();

    console.log('[checkout:team] Creating Stripe customer for team:', ctx.team.id);
    // Idempotency key bound to the team — see the space-flow note
    // above. Concurrent create calls return the same Stripe customer
    // instead of leaving orphans in Stripe's customer list.
    const customer = await stripe.customers.create(
      {
        email: owner?.email,
        name: owner?.name || teamStripe.name || undefined,
        metadata: { teamId: ctx.team.id },
      },
      { idempotencyKey: `customer-create:team:${ctx.team.id}` },
    );
    customerId = customer.id;

    // Conditional write: only persist if not already set by a concurrent request.
    const { data: updateResult } = await supabase
      .from('Team')
      .update({ stripeCustomerId: customerId })
      .eq('id', ctx.team.id)
      .is('stripeCustomerId', null)
      .select('stripeCustomerId')
      .single();

    if (!updateResult) {
      const { data: winner } = await supabase
        .from('Team')
        .select('stripeCustomerId')
        .eq('id', ctx.team.id)
        .single();
      if (winner?.stripeCustomerId) {
        customerId = winner.stripeCustomerId;
      }
    }
  }

  try {
    console.log(
      '[checkout:team] Creating checkout session, customer:',
      customerId,
      'price:',
      priceId,
      'plan:',
      plan,
    );
    const session = await stripe.checkout.sessions.create({
      customer: customerId as string,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { teamId: ctx.team.id, plan },
      },
      success_url: `${appUrl}/manager/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/manager/billing?canceled=1`,
      metadata: { teamId: ctx.team.id, plan },
    });

    console.log(
      '[checkout:team] Session created:',
      session.id,
      'url:',
      session.url?.slice(0, 50),
    );
    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error(
      '[checkout:team] session create failed:',
      err?.message,
      err?.stack?.slice(0, 200),
    );
    return NextResponse.json({ error: "Checkout didn't go through — usually temporary." }, { status: 500 });
  }
}
