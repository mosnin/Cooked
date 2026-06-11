/**
 * Billing-account resolution (docs/PRICING_V2_PLAN.md §4.1).
 *
 * One question, one answer: for a given space, which entity owns the plan +
 * credit balance? Solo/Pro draw from the Space; Team/Team Plus pool credits at
 * the Brokerage. Every metering/grant call site goes through here so the
 * space-vs-brokerage choice lives in exactly one place.
 *
 * Service-role bypasses RLS — callers must pass a `spaceId` resolved from a
 * trusted server context (the authed workspace), never raw client input.
 */

import { supabase } from '@/lib/supabase';
import type { PlanId } from '@/lib/plans';
import type { BillingAccount } from '@/lib/billing/credits';

export interface BillingContext {
  account: BillingAccount;
  /** The plan that governs grants/limits for this account. */
  plan: PlanId;
}

const BROKERAGE_PLANS = new Set<string>(['team', 'team_plus']);

/**
 * Resolve the billing account funding a space's credit spend.
 * - If the space belongs to a brokerage on a pooled (team) plan → that
 *   brokerage's pool.
 * - Otherwise → the space's own balance (free/solo/pro).
 */
export async function resolveBillingAccount(spaceId: string): Promise<BillingContext> {
  const { data: space, error } = await supabase
    .from('Space')
    .select('id, plan, brokerageId, ownerId')
    .eq('id', spaceId)
    .maybeSingle();
  if (error) throw error;
  if (!space) throw new Error(`resolveBillingAccount: space ${spaceId} not found`);

  if (space.brokerageId) {
    const { data: brokerage } = await supabase
      .from('Brokerage')
      .select('id, plan')
      .eq('id', space.brokerageId)
      .maybeSingle();
    if (brokerage && BROKERAGE_PLANS.has(brokerage.plan as string)) {
      // SECURITY (money routing): only pool at the brokerage if the space's
      // owner is a VERIFIED member of it. `Space.brokerageId` is a loosely-set
      // field — without this check a realtor could point their space at any
      // team brokerage and drain its shared credit pool through metered work.
      const { data: membership } = await supabase
        .from('BrokerageMembership')
        .select('userId')
        .eq('brokerageId', space.brokerageId)
        .eq('userId', space.ownerId)
        .maybeSingle();
      if (membership) {
        return {
          account: { type: 'brokerage', id: brokerage.id as string },
          plan: brokerage.plan as PlanId,
        };
      }
    }
  }

  return {
    account: { type: 'space', id: space.id as string },
    plan: ((space.plan as string) ?? 'free') as PlanId,
  };
}
