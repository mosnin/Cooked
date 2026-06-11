import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { grantTopup, grantPlanMonthly } from '@/lib/billing/grants';
import { PLANS, TOPUPS, type TopupId, planIdForStripePrice } from '@/lib/plans';
import { withObservability } from '@/lib/with-observability';

/** Send a subscription status email to the space owner (non-blocking). */
async function notifySubscriptionChange(subscriptionId: string, newStatus: string) {
  try {
    const { data: space } = await supabase
      .from('Space')
      .select('id, name, slug, ownerId')
      .eq('stripeSubscriptionId', subscriptionId)
      .maybeSingle();
    if (!space) return;

    const { data: owner } = await supabase
      .from('User')
      .select('email, name')
      .eq('id', space.ownerId)
      .maybeSingle();
    if (!owner?.email) return;

    if (!process.env.RESEND_API_KEY) return;
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    const rawFrom = process.env.RESEND_FROM_EMAIL ?? 'notifications@alerts.usechippi.com';
    const FROM = rawFrom.includes('@') ? rawFrom : `notifications@${rawFrom}`;

    const statusMessages: Record<string, { subject: string; body: string }> = {
      active: {
        subject: `Your Chippi subscription is now active`,
        body: `Great news! Your subscription for <strong>${space.name}</strong> is active. You have full access to all features.`,
      },
      past_due: {
        subject: `Payment issue with your Chippi subscription`,
        body: `We had trouble processing your payment for <strong>${space.name}</strong>. Please update your payment method to keep your access.`,
      },
      canceled: {
        subject: `Your Chippi subscription has been canceled`,
        body: `Your subscription for <strong>${space.name}</strong> has been canceled. You can resubscribe anytime from your billing page.`,
      },
      trial_ending: {
        subject: `Your Chippi trial ends in 3 days`,
        body: `Your free trial for <strong>${space.name}</strong> ends in 3 days. Add a payment method to keep your access without interruption.`,
      },
    };

    const msg = statusMessages[newStatus];
    if (!msg) return;

    const domain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'my.usechippi.com';

    const result = await resend.emails.send({
      from: `Chippi <${FROM}>`,
      to: owner.email,
      subject: msg.subject,
      html: `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px 0">
  <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px">Hi ${owner.name || 'there'},</p>
  <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px">${msg.body}</p>
  <a href="https://${domain}/s/${space.slug}/billing" style="display:inline-block;background:#ff964f;color:#fff;font-weight:600;font-size:14px;text-decoration:none;padding:10px 24px;border-radius:8px">View billing</a>
  <p style="font-size:12px;color:#9ca3af;margin-top:20px">— The Chippi team</p>
</div>`,
    });
    if (result.error) {
      logger.error('[stripe-webhook] Resend API error', { resendError: result.error });
    }
  } catch (err) {
    logger.error('[stripe-webhook] subscription email failed', undefined, err);
  }
}

// Disable body parsing — Stripe needs the raw body for signature verification
export const runtime = 'nodejs';

/** Get current_period_end from the first subscription item. Falls back through
 *  the other "when does access end" timestamps before start_date — on a
 *  canceled/past_due sub the item's current_period_end can be absent, and
 *  falling straight to start_date would write a period-end in the PAST, which
 *  strands any "access until period end" grace logic. */
function getPeriodEnd(sub: Stripe.Subscription): string {
  const subAny = sub as unknown as {
    current_period_end?: number; cancel_at?: number; ended_at?: number;
  };
  const ts =
    sub.items.data[0]?.current_period_end ??
    subAny.current_period_end ??
    subAny.cancel_at ??
    subAny.ended_at ??
    sub.start_date;
  return new Date(ts * 1000).toISOString();
}

/** Stripe's `customer` field can be a string id, an expanded object, or null.
 *  Normalize to the id string so ownership comparisons don't silently break:
 *  comparing a stored string id against an expanded object is always unequal
 *  (legit update rejected → account stranded) — or, inverted, always equal
 *  (guard bypassed). */
function customerIdOf(
  customer: string | { id: string } | null | undefined,
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

/**
 * Map a brokerage plan → seat limit, from the single source of truth in
 * lib/plans.ts (team = 5, team_plus = 10). Unknown plans → null (no cap set).
 */
function seatLimitForPlan(plan: string | undefined | null): number | null {
  if (plan === 'team' || plan === 'team_plus') return PLANS[plan].includedUsers;
  return null;
}

/**
 * Extract the subscription id from an invoice across multiple Stripe API shapes.
 */
function extractInvoiceSubscriptionId(invoice: Stripe.Invoice): string | undefined {
  const invoiceAny = invoice as any;
  if (typeof invoiceAny.subscription === 'string') {
    return invoiceAny.subscription;
  }
  if (typeof invoiceAny.subscription === 'object' && invoiceAny.subscription?.id) {
    return invoiceAny.subscription.id;
  }
  const detail = invoice.parent?.subscription_details?.subscription;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') return (detail as any).id;
  return undefined;
}

/**
 * Apply a subscription state update to the matching Brokerage row.
 * Caller must have already determined that subscription.metadata.brokerageId is set.
 * Returns true if a brokerage was updated (and thus Space path should be skipped),
 * false if the brokerage row no longer exists (idempotency: orphaned subscription).
 */
/**
 * Guard against metadata poisoning. A subscription's `metadata.brokerageId`
 * is untrusted — whoever created the sub could point it at any brokerage.
 * Before we write to a Brokerage row based on a webhook, confirm the
 * subscription's Stripe customer matches the brokerage's stored customer
 * (or that the brokerage has no customer yet, which is the legitimate
 * first-subscribe case).
 *
 * Returns one of:
 *   'ok'       — safe to write (either customers match, or brokerage has none)
 *   'missing'  — brokerage row doesn't exist (orphaned subscription)
 *   'mismatch' — customer IDs don't match; treat as handled but DO NOT write
 *
 * Every handler that writes to Brokerage based on subscription.metadata
 * MUST call this first. Duplicating the logic inline is how the
 * customer.subscription.deleted and invoice.payment_failed paths shipped
 * without the check; centralising it closes that door.
 */
async function verifyBrokerageOwnsSubscription(
  brokerageId: string,
  subscription: Stripe.Subscription,
  customerOverride?: string | null,
): Promise<{ status: 'ok' | 'missing' | 'mismatch'; existing: { id: string; stripeCustomerId: string | null } | null }> {
  const { data: existing } = await supabase
    .from('Brokerage')
    .select('id, stripeCustomerId')
    .eq('id', brokerageId)
    .maybeSingle();

  if (!existing) {
    logger.warn('[stripe-webhook] subscription references missing brokerage — ignoring', {
      brokerageId,
      subscriptionId: subscription.id,
    });
    return { status: 'missing', existing: null };
  }

  const webhookCustomer =
    customerOverride ??
    (typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null);

  if (
    existing.stripeCustomerId &&
    webhookCustomer &&
    existing.stripeCustomerId !== webhookCustomer
  ) {
    logger.error(
      '[stripe-webhook] brokerageId metadata mismatch — brokerage belongs to different customer',
      {
        brokerageId,
        brokerageCustomer: existing.stripeCustomerId,
        webhookCustomer,
        subscriptionId: subscription.id,
      },
    );
    return { status: 'mismatch', existing: { id: existing.id, stripeCustomerId: existing.stripeCustomerId } };
  }

  return {
    status: 'ok',
    existing: { id: existing.id, stripeCustomerId: existing.stripeCustomerId ?? null },
  };
}

async function updateBrokerageFromSubscription(
  brokerageId: string,
  subscription: Stripe.Subscription,
  opts: { customerId?: string | null; includePlanFromMetadata?: boolean } = {},
): Promise<boolean> {
  const guard = await verifyBrokerageOwnsSubscription(
    brokerageId,
    subscription,
    opts.customerId,
  );
  if (guard.status === 'missing') return false;
  if (guard.status === 'mismatch') return true; // treat as handled — do NOT fall through to Space
  // Guard returned 'ok'; existing is populated.
  const existing = guard.existing!;

  const webhookCustomer =
    opts.customerId ??
    (typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null);

  const updateData: Record<string, unknown> = {
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionStatus: mapStatus(subscription.status),
    stripePeriodEnd: getPeriodEnd(subscription),
  };

  if (webhookCustomer && !existing.stripeCustomerId) {
    updateData.stripeCustomerId = webhookCustomer;
  }

  if (opts.includePlanFromMetadata) {
    const plan = subscription.metadata?.plan;
    if (plan === 'team' || plan === 'team_plus') {
      updateData.plan = plan;
      updateData.seatLimit = seatLimitForPlan(plan);
    }
  }

  const { error } = await supabase
    .from('Brokerage')
    .update(updateData)
    .eq('id', brokerageId);

  if (error) {
    logger.error('[stripe-webhook] failed to update Brokerage', {
      brokerageId,
      subscriptionId: subscription.id,
      dbError: error.message,
    });
  }

  return true;
}

async function POSTHandler(req: NextRequest) {
  const stripe = getStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('[stripe-webhook] Missing STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Read raw body for signature verification
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err: any) {
    logger.error('[stripe-webhook] signature verification failed', undefined, err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Idempotency check — skip events we've already fully processed. The Redis
  // key is a fast-path optimization, NOT the correctness boundary: it's set
  // only AFTER the handler succeeds (see end of function). Correctness rests on
  // DB-level grant idempotency (CreditLot.sourceId unique index), so a Redis
  // miss can at worst re-run a handler — it can never double-grant.
  const eventKey = `stripe:event:${event.id}`;
  try {
    const alreadyProcessed = await redis.get(eventKey);
    if (alreadyProcessed) {
      return NextResponse.json({ received: true });
    }
  } catch {
    // Redis unavailable — proceed; DB-level idempotency is the real backstop.
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;

        // Top-up purchase (one-time payment, no subscription) — grant credits.
        // Idempotent via the event-ID dedupe above, so a retried delivery won't
        // double-grant. Metadata is set by app/api/billing/credits/checkout.
        const topupId = session.metadata?.topup as TopupId | undefined;
        if (topupId && topupId in TOPUPS) {
          const acctType = session.metadata?.accountType;
          const acctId = session.metadata?.accountId;
          if (acctId && (acctType === 'space' || acctType === 'brokerage')) {
            // Anti-poisoning (mirrors the subscription paths): if the target
            // account already has a Stripe customer, it must match the payer.
            // A brand-new account with no customer yet is allowed — the metadata
            // was server-set from a verified owned space at checkout.
            const acctTable = acctType === 'space' ? 'Space' : 'Brokerage';
            const { data: acct } = await supabase
              .from(acctTable)
              .select('stripeCustomerId')
              .eq('id', acctId)
              .maybeSingle();
            if (acct?.stripeCustomerId && acct.stripeCustomerId !== (session.customer as string)) {
              logger.error('[stripe-webhook] top-up account/customer mismatch — rejecting metadata poisoning', {
                acctType, acctId, sessionCustomer: session.customer,
              });
              break;
            }
            await grantTopup({ type: acctType, id: acctId }, topupId, session.id);
            logger.info('[stripe-webhook] top-up credits granted', { topupId, acctType, acctId });
          } else {
            logger.warn('[stripe-webhook] top-up missing account metadata', { topupId });
          }
          break;
        }

        if (!session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string,
        );

        // Brokerage path: metadata.brokerageId may live on the session or the subscription
        const brokerageId =
          session.metadata?.brokerageId ?? subscription.metadata?.brokerageId;
        if (brokerageId) {
          await updateBrokerageFromSubscription(brokerageId, subscription, {
            customerId: session.customer as string,
            includePlanFromMetadata: true,
          });
          break;
        }

        // ── Existing Space path (unchanged) ──────────────────────────────
        const spaceId = session.metadata?.spaceId;
        if (!spaceId) break;

        const updateData: Record<string, unknown> = {
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionStatus: mapStatus(subscription.status),
          stripePeriodEnd: getPeriodEnd(subscription),
        };

        // Track trial usage — only set once, never reset
        if (subscription.status === 'trialing') {
          const { data: existing } = await supabase
            .from('Space')
            .select('trialUsedAt')
            .eq('id', spaceId)
            .maybeSingle();
          if (!existing?.trialUsedAt) {
            updateData.trialUsedAt = new Date().toISOString();
          }
        }

        // Validate spaceId ownership before updating
        const { data: targetSpace } = await supabase
          .from('Space')
          .select('stripeCustomerId')
          .eq('id', spaceId)
          .maybeSingle();

        if (targetSpace && targetSpace.stripeCustomerId && targetSpace.stripeCustomerId !== customerIdOf(session.customer)) {
          logger.error('[stripe-webhook] checkout spaceId mismatch — rejecting metadata poisoning attempt', {
            spaceId,
            existingCustomer: targetSpace.stripeCustomerId,
            sessionCustomer: session.customer,
          });
          break;
        }

        await supabase
          .from('Space')
          .update(updateData)
          .eq('id', spaceId);
        break;
      }

      // A subscription created outside checkout.session.completed (Stripe
      // Dashboard, API, or trial→paid create) only ever fired `created`, which
      // had no handler — so status/period/customer never got written until the
      // first later event. Share the `updated` handler so creation lands too.
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const newStatus = mapStatus(subscription.status);

        // Brokerage path
        const brokerageId = subscription.metadata?.brokerageId;
        if (brokerageId) {
          await updateBrokerageFromSubscription(brokerageId, subscription, {
            includePlanFromMetadata: true,
          });
          break;
        }

        // ── Existing Space path (unchanged) ──────────────────────────────
        const spaceId = subscription.metadata?.spaceId;
        const updateData = {
          stripeSubscriptionStatus: newStatus,
          stripePeriodEnd: getPeriodEnd(subscription),
        };

        if (spaceId) {
          // Validate spaceId ownership: only update if the space's existing customer matches
          // or if the space has no customer yet (first-time setup)
          const { data: existingSpace } = await supabase
            .from('Space')
            .select('stripeCustomerId')
            .eq('id', spaceId)
            .maybeSingle();

          if (existingSpace && existingSpace.stripeCustomerId && existingSpace.stripeCustomerId !== customerIdOf(subscription.customer)) {
            logger.error('[stripe-webhook] spaceId metadata mismatch — space belongs to different customer', {
              spaceId,
              spaceCustomer: existingSpace.stripeCustomerId,
              webhookCustomer: customerIdOf(subscription.customer),
            });
            break; // Reject update — potential metadata poisoning attack
          }

          await supabase.from('Space').update(updateData).eq('id', spaceId);
        } else {
          // No spaceId metadata (legacy subs): match by subscription id, but
          // also bind to the subscription's customer so a poisoned/duplicated
          // stripeSubscriptionId can't overwrite a different customer's Space.
          const subCustomer = customerIdOf(subscription.customer);
          let q = supabase
            .from('Space')
            .update(updateData)
            .eq('stripeSubscriptionId', subscription.id);
          if (subCustomer) q = q.eq('stripeCustomerId', subCustomer);
          await q;
        }
        // Notify owner of status change
        try { await notifySubscriptionChange(subscription.id, newStatus); } catch (e) { logger.error('[stripe-webhook] subscription notification failed', undefined, e); }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        // Brokerage path: mark canceled but preserve subscription id + seatLimit
        // so the owner has audit context and can resubscribe without losing config.
        // The ownership guard is critical here — without it, an attacker who
        // can set metadata.brokerageId on their OWN subscription could cancel
        // a victim brokerage simply by deleting their sub. (Audit-driven fix.)
        const brokerageId = subscription.metadata?.brokerageId;
        if (brokerageId) {
          const guard = await verifyBrokerageOwnsSubscription(brokerageId, subscription);
          if (guard.status !== 'ok') break; // missing or customer mismatch — swallow
          const { error } = await supabase
            .from('Brokerage')
            .update({
              stripeSubscriptionStatus: 'canceled',
              stripePeriodEnd: getPeriodEnd(subscription),
            })
            .eq('id', brokerageId);
          if (error) {
            logger.error('[stripe-webhook] failed to mark brokerage canceled', {
              brokerageId,
              subscriptionId: subscription.id,
              dbError: error.message,
            });
          }
          break;
        }

        // ── Existing Space path (unchanged) ──────────────────────────────
        await supabase
          .from('Space')
          .update({
            stripeSubscriptionStatus: 'canceled',
            stripePeriodEnd: getPeriodEnd(subscription),
          })
          .eq('stripeSubscriptionId', subscription.id);
        try { await notifySubscriptionChange(subscription.id, 'canceled'); } catch (e) { logger.error('[stripe-webhook] canceled notification failed', undefined, e); }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const paidSubId = extractInvoiceSubscriptionId(invoice);
        if (!paidSubId) break;

        // Fetch live subscription to read authoritative status + metadata
        const paidSub = await stripe.subscriptions.retrieve(paidSubId);
        const paidStatus = mapStatus(paidSub.status);

        // Derive the ACTIVE plan from the live subscription's price, not the
        // checkout-time metadata.plan — that's stamped once and goes STALE on a
        // portal plan change, so a Solo→Pro upgrade was granted Solo credits +
        // relabeled Solo, and Pro→Solo kept granting Pro credits at the Solo
        // price. Falls back to metadata when the price isn't a known plan price.
        const livePlan = planIdForStripePrice(paidSub.items.data[0]?.price?.id);
        // Grant monthly credits ONLY on a genuine new-subscription or renewal
        // invoice. Proration / mid-cycle / manual invoices also fire
        // payment_succeeded and would each mint an extra full month of credits.
        const grantableInvoice =
          invoice.billing_reason === 'subscription_create' ||
          invoice.billing_reason === 'subscription_cycle';

        // Brokerage path
        const brokerageId = paidSub.metadata?.brokerageId;
        if (brokerageId) {
          await updateBrokerageFromSubscription(brokerageId, paidSub, {
            includePlanFromMetadata: true,
          });
          // Monthly credit grant (best-effort — must never break payment
          // processing). Idempotent-per-invoice via the event-ID dedupe above.
          if (grantableInvoice) {
            try {
              await grantPlanMonthly({ type: 'brokerage', id: brokerageId }, livePlan ?? paidSub.metadata?.plan ?? '', invoice.id);
            } catch (e) {
              logger.error('[stripe-webhook] brokerage monthly grant failed', { brokerageId }, e);
            }
          }
          break;
        }

        // ── Existing Space path ───────────────────────────────────────────
        // Verify the subscription's customer owns the target Space before
        // crediting it active — mirrors the customer.subscription.updated guard
        // so a poisoned stripeSubscriptionId can't activate another's space.
        const { data: paidSpace } = await supabase
          .from('Space')
          .select('id, plan, stripeCustomerId')
          .eq('stripeSubscriptionId', paidSubId)
          .maybeSingle();
        if (paidSpace && paidSpace.stripeCustomerId && paidSpace.stripeCustomerId !== customerIdOf(paidSub.customer)) {
          logger.error('[stripe-webhook] invoice.payment_succeeded customer mismatch — subscription belongs to a different customer', {
            paidSubId,
            spaceCustomer: paidSpace.stripeCustomerId,
            webhookCustomer: paidSub.customer,
          });
          break;
        }
        await supabase
          .from('Space')
          .update({
            stripeSubscriptionStatus: paidStatus,
            stripePeriodEnd: getPeriodEnd(paidSub),
          })
          .eq('stripeSubscriptionId', paidSubId);

        // Monthly credit grant (best-effort — never break payment processing).
        // Trust the tier stamped on the subscription metadata (set at checkout);
        // fall back to the current Space.plan, else Solo. Using the metadata
        // avoids mislabeling a downgrade (e.g. Pro→Solo) off a stale Space.plan.
        try {
          if (paidSpace?.id) {
            const planId =
              livePlan ||
              (paidSub.metadata?.plan as string) ||
              (paidSpace.plan && paidSpace.plan !== 'free' ? (paidSpace.plan as string) : 'solo');
            // Keep the plan label in sync even when this invoice isn't grantable
            // (so a portal plan change is reflected immediately).
            if (planId !== paidSpace.plan) {
              await supabase
                .from('Space')
                .update({ plan: planId, planActivatedAt: new Date().toISOString() })
                .eq('id', paidSpace.id);
            }
            if (grantableInvoice) {
              await grantPlanMonthly({ type: 'space', id: paidSpace.id as string }, planId, invoice.id);
            }
          } else {
            logger.error('[stripe-webhook] PAID invoice but no matching space — credits NOT granted', { paidSubId });
          }
        } catch (e) {
          logger.error('[stripe-webhook] space monthly grant failed (paid, credits NOT granted)', { paidSubId }, e);
        }

        // Notify only on active transition (payment recovered past_due subscription)
        if (paidStatus === 'active') {
          try { await notifySubscriptionChange(paidSubId, 'active'); } catch (e) { logger.error('[stripe-webhook] payment_succeeded notification failed', undefined, e); }
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const trialSub = event.data.object as Stripe.Subscription;
        // Brokerage subscriptions don't email via the Space-owner notifier;
        // skip notification for brokerage-scoped trials (owners see dashboard state).
        if (trialSub.metadata?.brokerageId) break;
        try { await notifySubscriptionChange(trialSub.id, 'trial_ending'); } catch (e) { logger.error('[stripe-webhook] trial_will_end notification failed', undefined, e); }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = extractInvoiceSubscriptionId(invoice);
        if (!subId) {
          logger.warn('[stripe-webhook] invoice.payment_failed: could not extract subscription ID', {
            invoiceId: invoice.id,
          });
          break;
        }

        // Fetch live subscription to branch on metadata.brokerageId
        const failedSub = await stripe.subscriptions.retrieve(subId);
        const brokerageId = failedSub.metadata?.brokerageId;
        if (brokerageId) {
          // Same metadata-poisoning guard as subscription.deleted.
          const guard = await verifyBrokerageOwnsSubscription(brokerageId, failedSub);
          if (guard.status !== 'ok') break;
          const { error } = await supabase
            .from('Brokerage')
            .update({ stripeSubscriptionStatus: 'past_due' })
            .eq('id', brokerageId);
          if (error) {
            logger.error('[stripe-webhook] failed to mark brokerage past_due', {
              brokerageId,
              subscriptionId: subId,
              dbError: error.message,
            });
          }
          break;
        }

        // ── Existing Space path ──────────────────────────────────────────
        // Bind to the subscription's customer so a poisoned stripeSubscriptionId
        // can't force a victim Space to past_due (access denial-of-service).
        const failedCustomer = customerIdOf(failedSub.customer);
        let fq = supabase
          .from('Space')
          .update({ stripeSubscriptionStatus: 'past_due' })
          .eq('stripeSubscriptionId', subId);
        if (failedCustomer) fq = fq.eq('stripeCustomerId', failedCustomer);
        await fq;
        try { await notifySubscriptionChange(subId, 'past_due'); } catch (e) { logger.error('[stripe-webhook] past_due notification failed', undefined, e); }
        break;
      }

      default:
        // Unhandled event type — acknowledge receipt
        break;
    }
  } catch (err) {
    logger.error('[stripe-webhook] error processing event', { eventType: event.type }, err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  // Mark processed only AFTER the handler succeeded (every switch case breaks,
  // so reaching here = success). If it had thrown, the catch returned 500 and
  // this never runs → Stripe retries → the retry re-runs the handler and
  // completes the work, with DB-level grant idempotency preventing any
  // double-grant. Setting the key before processing would silently drop the
  // event on a mid-handler crash.
  try {
    await redis.set(eventKey, '1', { ex: 259200 }); // 72h — covers Stripe's retry window
  } catch {
    // Redis unavailable — fine; DB-level idempotency already guards correctness.
  }

  return NextResponse.json({ received: true });
}

export const POST = withObservability(POSTHandler, 'api.webhooks.stripe');

/** Map Stripe subscription status to our DB enum. */
function mapStatus(
  status: Stripe.Subscription.Status,
): 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'inactive' {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    case 'unpaid':
    case 'incomplete_expired' as any:
      return 'unpaid';
    case 'incomplete' as any:
      return 'inactive';
    default:
      return 'inactive';
  }
}
