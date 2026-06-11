/**
 * Credit ledger — Pricing V2 (docs/PRICING_V2_PLAN.md §4.3).
 *
 * Model: append-only credit *lots* (a grant or top-up that can expire) +
 * *transactions* (every debit / refund, for audit). Balance = Σ remaining over
 * non-expired lots. Debits are FIFO, oldest-expiring first, so granted credits
 * are spent before they lapse.
 *
 * The actual spend/grant run inside atomic Postgres functions (`spend_credits`,
 * `grant_credits`, `refund_credit_txn`) with row locking — the same race-safe
 * RPC pattern as `book_tour_atomic` / `reorder_deal`. The pure helpers below
 * (`availableBalance`, `planDebit`) mirror the FIFO rule for read-only balance
 * display and are unit-tested so the algorithm can't drift from the SQL.
 *
 * Service-role bypasses RLS, so the `account` passed here is the ONLY tenant
 * boundary — always resolve it from a trusted server context (never client
 * input). See lib/billing/account.ts.
 */

import { supabase } from '@/lib/supabase';
import { WORKFLOW_CREDIT_COST, type Workflow, type AccountType } from '@/lib/plans';

export interface BillingAccount {
  type: AccountType;
  id: string;
}

export interface CreditLot {
  id: string;
  remaining: number;
  /** ISO timestamp, or null = never expires (Free tier's one-time grant). */
  expiresAt: string | null;
}

// ── Pure helpers (unit-tested; mirror the SQL) ──────────────────────────────

/** A lot is expired when it has an expiry that is at or before `now`. */
export function lotExpired(lot: CreditLot, now: Date): boolean {
  return lot.expiresAt !== null && new Date(lot.expiresAt).getTime() <= now.getTime();
}

/** Spendable balance = sum of `remaining` over non-expired lots with credits left. */
export function availableBalance(lots: CreditLot[], now: Date = new Date()): number {
  return lots.reduce(
    (sum, lot) => (!lotExpired(lot, now) && lot.remaining > 0 ? sum + lot.remaining : sum),
    0,
  );
}

export interface DebitPlan {
  ok: boolean;
  /** Which lots to decrement and by how much, oldest-expiring first. */
  debits: { lotId: string; take: number }[];
  /** Credits still needed when `ok` is false. */
  shortfall: number;
}

/**
 * Compute the FIFO debit plan for `amount` credits across `lots`.
 * Order: non-expired lots, expiring soonest first (a `null` expiry sorts last
 * so never-expiring Free credits are spent only after dated grants). Lots with
 * the same expiry fall back to oldest-issued via `id`-stable input order.
 */
export function planDebit(lots: CreditLot[], amount: number, now: Date = new Date()): DebitPlan {
  if (amount <= 0) return { ok: true, debits: [], shortfall: 0 };

  const spendable = lots
    .filter((l) => !lotExpired(l, now) && l.remaining > 0)
    .sort((a, b) => {
      if (a.expiresAt === b.expiresAt) return 0;
      if (a.expiresAt === null) return 1; // nulls last
      if (b.expiresAt === null) return -1;
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    });

  const debits: { lotId: string; take: number }[] = [];
  let need = amount;
  for (const lot of spendable) {
    if (need <= 0) break;
    const take = Math.min(lot.remaining, need);
    debits.push({ lotId: lot.id, take });
    need -= take;
  }

  if (need > 0) return { ok: false, debits: [], shortfall: need };
  return { ok: true, debits, shortfall: 0 };
}

/** Credits a workflow run will cost (`units` > 1 for batched pipeline audits). */
export function workflowCost(workflow: Workflow, units = 1): number {
  return WORKFLOW_CREDIT_COST[workflow] * units;
}

// ── DB wrappers (atomic RPCs) ───────────────────────────────────────────────

/** Current spendable balance for an account. */
export async function getCreditBalance(account: BillingAccount): Promise<number> {
  const { data, error } = await supabase
    .from('CreditLot')
    .select('id, remaining, expiresAt')
    .eq('accountType', account.type)
    .eq('accountId', account.id)
    .gt('remaining', 0);
  if (error) throw error;
  return availableBalance((data ?? []) as CreditLot[]);
}

/** Add a credit lot (monthly grant, top-up, free signup, or add-on user).
 *  `sourceId` is the originating Stripe object id (invoice id for a monthly
 *  grant, checkout session id for a top-up). When set, the DB's partial unique
 *  index on (reason, sourceId) makes the grant idempotent — a retried webhook
 *  re-runs this and the duplicate INSERT is a no-op, so credits can't inflate. */
export async function grantCredits(
  account: BillingAccount,
  amount: number,
  reason: 'monthly_grant' | 'topup' | 'free_signup' | 'addon_user' | 'migration' | 'manual_admin',
  expiresAt: Date | null,
  sourceId?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('grant_credits', {
    p_account_type: account.type,
    p_account_id: account.id,
    p_amount: amount,
    p_reason: reason,
    p_expires_at: expiresAt ? expiresAt.toISOString() : null,
    p_source_id: sourceId ?? null,
  });
  if (error) throw error;
}

/** Recent ledger transactions for an account (newest first) — for billing UIs. */
export interface CreditTxnRow {
  id: string;
  delta: number;
  workflow: string;
  reason: string | null;
  createdAt: string;
}
export async function getRecentTxns(account: BillingAccount, limit = 20): Promise<CreditTxnRow[]> {
  const { data, error } = await supabase
    .from('CreditTxn')
    .select('id, delta, workflow, reason, createdAt')
    .eq('accountType', account.type)
    .eq('accountId', account.id)
    .order('createdAt', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as CreditTxnRow[];
}

export interface SpendResult {
  ok: boolean;
  /** Balance after the debit (or current balance when `ok` is false). */
  balance: number;
  /** CreditTxn id of the debit, present when `ok`. Pass to `refundCredits`. */
  txnId?: string;
}

/**
 * Atomically debit `workflow` credits from `account`, FIFO oldest-expiring
 * first. Fails closed (`ok: false`) when the balance is insufficient — callers
 * must refuse the workflow in that case. Records a CreditTxn for audit.
 */
export async function spendCredits(
  account: BillingAccount,
  workflow: Workflow,
  opts?: { units?: number; spaceId?: string; userId?: string; metadata?: Record<string, unknown> },
): Promise<SpendResult> {
  const cost = workflowCost(workflow, opts?.units ?? 1);
  const { data, error } = await supabase.rpc('spend_credits', {
    p_account_type: account.type,
    p_account_id: account.id,
    p_amount: cost,
    p_workflow: workflow,
    p_space_id: opts?.spaceId ?? null,
    p_user_id: opts?.userId ?? null,
    p_metadata: opts?.metadata ?? {},
  });
  if (error) throw error;
  // spend_credits returns a single row: { ok, balance, txn_id }
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: !!row?.ok, balance: row?.balance ?? 0, txnId: row?.txn_id ?? undefined };
}

/** Reverse a debit (e.g. the workflow threw after charging). Idempotent per txn. */
export async function refundCredits(txnId: string): Promise<void> {
  const { error } = await supabase.rpc('refund_credit_txn', { p_txn_id: txnId });
  if (error) throw error;
}

/**
 * Run a metered workflow with automatic refund on failure: debit first, run
 * `fn`, refund if it throws. Returns the workflow result, or `null` when the
 * balance was insufficient (caller should surface "out of credits").
 */
export async function withCredits<T>(
  account: BillingAccount,
  workflow: Workflow,
  fn: () => Promise<T>,
  opts?: { units?: number; spaceId?: string; userId?: string; metadata?: Record<string, unknown> },
): Promise<{ ok: true; result: T } | { ok: false; balance: number }> {
  const debit = await spendCredits(account, workflow, opts);
  if (!debit.ok) return { ok: false, balance: debit.balance };
  try {
    const result = await fn();
    return { ok: true, result };
  } catch (err) {
    if (debit.txnId) await refundCredits(debit.txnId).catch(() => {});
    throw err;
  }
}
