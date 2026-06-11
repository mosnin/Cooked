/**
 * Workflow metering (docs/PRICING_V2_PLAN.md §4.4).
 *
 * Two small guards the workflow entry points call: `assertCanSpend` up front
 * (refuse when the account can't afford it) and `chargeWorkflow` on success
 * (debit). Split so we only charge for work that actually completed.
 *
 * ⚠️ Gated by CREDITS_ENFORCED (default OFF). Until credits are live — Stripe
 * products created + monthly grants flowing + existing accounts backfilled —
 * enforcement stays off so workflows run free and nobody is blocked for having
 * a zero balance. Flip CREDITS_ENFORCED=true once grants are in place.
 */

import { resolveBillingAccount } from '@/lib/billing/account';
import { getCreditBalance, spendCredits, workflowCost } from '@/lib/billing/credits';
import type { Workflow } from '@/lib/plans';

export const CREDITS_ENFORCED = process.env.CREDITS_ENFORCED === 'true';

export class CreditsExhaustedError extends Error {
  readonly workflow: Workflow;
  readonly balance: number;
  constructor(workflow: Workflow, balance: number) {
    super(`Insufficient credits for ${workflow} (balance ${balance})`);
    this.name = 'CreditsExhaustedError';
    this.workflow = workflow;
    this.balance = balance;
  }
}

/**
 * Refuse a workflow up front when the funding account can't afford it.
 * No-op unless enforcement is on. Throws CreditsExhaustedError when short —
 * callers translate that to a 402 / an "out of credits" result.
 */
export async function assertCanSpend(spaceId: string, workflow: Workflow, units = 1): Promise<void> {
  if (!CREDITS_ENFORCED) return;
  const { account } = await resolveBillingAccount(spaceId);
  const balance = await getCreditBalance(account);
  if (balance < workflowCost(workflow, units)) {
    throw new CreditsExhaustedError(workflow, balance);
  }
}

/**
 * Charge for a workflow that completed successfully. No-op unless enforcement
 * is on. Best-effort: never throws — a metering miss must not fail real work
 * (the up-front assertCanSpend is what guarantees the account could afford it).
 */
export async function chargeWorkflow(
  spaceId: string,
  workflow: Workflow,
  opts?: { units?: number; userId?: string },
): Promise<void> {
  if (!CREDITS_ENFORCED) return;
  try {
    const { account } = await resolveBillingAccount(spaceId);
    await spendCredits(account, workflow, {
      units: opts?.units,
      spaceId,
      userId: opts?.userId,
    });
  } catch {
    /* metering must never break the workflow */
  }
}
