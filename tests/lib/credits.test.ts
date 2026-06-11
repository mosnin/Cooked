/**
 * Unit tests for the credit-ledger FIFO/expiry rule (lib/billing/credits.ts).
 * These lock the algorithm the atomic SQL `spend_credits` mirrors — if someone
 * changes the ordering or the expiry handling, this fails before it reaches a DB.
 */
import { describe, it, expect } from 'vitest';
import {
  lotExpired,
  availableBalance,
  planDebit,
  workflowCost,
  type CreditLot,
} from '@/lib/billing/credits';

const NOW = new Date('2026-06-20T12:00:00Z');
const future = (days: number) =>
  new Date(NOW.getTime() + days * 86400_000).toISOString();
const past = (days: number) =>
  new Date(NOW.getTime() - days * 86400_000).toISOString();

describe('lotExpired', () => {
  it('treats null expiry as never expired', () => {
    expect(lotExpired({ id: 'a', remaining: 10, expiresAt: null }, NOW)).toBe(false);
  });
  it('expires at or before now', () => {
    expect(lotExpired({ id: 'a', remaining: 10, expiresAt: past(1) }, NOW)).toBe(true);
    expect(lotExpired({ id: 'a', remaining: 10, expiresAt: NOW.toISOString() }, NOW)).toBe(true);
  });
  it('keeps future expiry alive', () => {
    expect(lotExpired({ id: 'a', remaining: 10, expiresAt: future(1) }, NOW)).toBe(false);
  });
});

describe('availableBalance', () => {
  it('sums only non-expired lots with credits left', () => {
    const lots: CreditLot[] = [
      { id: 'a', remaining: 100, expiresAt: future(10) },
      { id: 'b', remaining: 50, expiresAt: past(1) },   // expired — excluded
      { id: 'c', remaining: 0, expiresAt: future(5) },  // empty — excluded
      { id: 'd', remaining: 25, expiresAt: null },      // never expires — included
    ];
    expect(availableBalance(lots, NOW)).toBe(125);
  });
  it('is 0 for no lots', () => {
    expect(availableBalance([], NOW)).toBe(0);
  });
});

describe('planDebit', () => {
  it('takes from the soonest-expiring lot first', () => {
    const lots: CreditLot[] = [
      { id: 'late', remaining: 100, expiresAt: future(30) },
      { id: 'soon', remaining: 100, expiresAt: future(2) },
    ];
    const plan = planDebit(lots, 40, NOW);
    expect(plan.ok).toBe(true);
    expect(plan.debits).toEqual([{ lotId: 'soon', take: 40 }]);
  });

  it('spans multiple lots oldest-expiring first, nulls last', () => {
    const lots: CreditLot[] = [
      { id: 'never', remaining: 100, expiresAt: null },
      { id: 'soon', remaining: 30, expiresAt: future(1) },
      { id: 'mid', remaining: 30, expiresAt: future(10) },
    ];
    const plan = planDebit(lots, 75, NOW);
    expect(plan.ok).toBe(true);
    expect(plan.debits).toEqual([
      { lotId: 'soon', take: 30 },
      { lotId: 'mid', take: 30 },
      { lotId: 'never', take: 15 },
    ]);
  });

  it('skips expired and empty lots', () => {
    const lots: CreditLot[] = [
      { id: 'expired', remaining: 1000, expiresAt: past(1) },
      { id: 'empty', remaining: 0, expiresAt: future(5) },
      { id: 'good', remaining: 50, expiresAt: future(5) },
    ];
    const plan = planDebit(lots, 50, NOW);
    expect(plan.ok).toBe(true);
    expect(plan.debits).toEqual([{ lotId: 'good', take: 50 }]);
  });

  it('fails closed with the shortfall when insufficient', () => {
    const lots: CreditLot[] = [{ id: 'a', remaining: 10, expiresAt: future(5) }];
    const plan = planDebit(lots, 50, NOW);
    expect(plan.ok).toBe(false);
    expect(plan.debits).toEqual([]);
    expect(plan.shortfall).toBe(40);
  });

  it('handles an exact-balance debit', () => {
    const lots: CreditLot[] = [
      { id: 'a', remaining: 20, expiresAt: future(1) },
      { id: 'b', remaining: 30, expiresAt: future(2) },
    ];
    const plan = planDebit(lots, 50, NOW);
    expect(plan.ok).toBe(true);
    expect(plan.debits).toEqual([
      { lotId: 'a', take: 20 },
      { lotId: 'b', take: 30 },
    ]);
  });

  it('is a no-op for non-positive amounts', () => {
    const lots: CreditLot[] = [{ id: 'a', remaining: 10, expiresAt: null }];
    expect(planDebit(lots, 0, NOW)).toEqual({ ok: true, debits: [], shortfall: 0 });
  });
});

describe('workflowCost', () => {
  it('returns the per-workflow cost', () => {
    expect(workflowCost('lead_score')).toBe(1);
    expect(workflowCost('pipeline_audit')).toBe(50);
    // chat_turn must resolve to a real number — if it's ever dropped from the
    // cost table, the chat gate would compute NaN and silently never enforce.
    expect(workflowCost('chat_turn')).toBe(1);
  });
  it('multiplies by units for batched runs (e.g. pipeline audit batches)', () => {
    expect(workflowCost('pipeline_audit', 3)).toBe(150);
  });
});
