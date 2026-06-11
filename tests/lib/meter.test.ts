import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the account resolver and the DB spend/balance calls so we can exercise
// the enforcement semantics without a database. workflowCost stays REAL (reads
// lib/plans.ts) so chat_turn=1 is what actually gates here.
const { resolveMock, balanceMock, spendMock } = vi.hoisted(() => ({
  resolveMock: vi.fn(),
  balanceMock: vi.fn(),
  spendMock: vi.fn(),
}));

vi.mock('@/lib/billing/account', () => ({ resolveBillingAccount: resolveMock }));
vi.mock('@/lib/billing/credits', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/billing/credits')>();
  return { ...actual, getCreditBalance: balanceMock, spendCredits: spendMock };
});

// CREDITS_ENFORCED is read at module load, so each case re-imports meter with
// the flag stubbed to the value under test.
async function loadMeter(enforced: boolean) {
  vi.resetModules();
  vi.stubEnv('CREDITS_ENFORCED', enforced ? 'true' : '');
  return import('@/lib/billing/meter');
}

describe('credit enforcement (meter)', () => {
  beforeEach(() => {
    resolveMock.mockReset();
    balanceMock.mockReset();
    spendMock.mockReset();
    resolveMock.mockResolvedValue({ account: { type: 'space', id: 'sp1' } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('assertCanSpend is a no-op (never reads balance) when enforcement is OFF', async () => {
    const { assertCanSpend } = await loadMeter(false);
    await expect(assertCanSpend('sp1', 'chat_turn')).resolves.toBeUndefined();
    expect(balanceMock).not.toHaveBeenCalled();
  });

  it('assertCanSpend hard-stops (throws) when ON and balance < cost', async () => {
    balanceMock.mockResolvedValue(0); // chat_turn costs 1
    const { assertCanSpend, CreditsExhaustedError } = await loadMeter(true);
    await expect(assertCanSpend('sp1', 'chat_turn')).rejects.toBeInstanceOf(CreditsExhaustedError);
  });

  it('assertCanSpend passes when ON and balance covers the cost', async () => {
    balanceMock.mockResolvedValue(1);
    const { assertCanSpend } = await loadMeter(true);
    await expect(assertCanSpend('sp1', 'chat_turn')).resolves.toBeUndefined();
  });

  it('chargeWorkflow debits via spendCredits when ON', async () => {
    spendMock.mockResolvedValue({ ok: true, balance: 0 });
    const { chargeWorkflow } = await loadMeter(true);
    await chargeWorkflow('sp1', 'chat_turn', { userId: 'u1' });
    expect(spendMock).toHaveBeenCalledWith(
      { type: 'space', id: 'sp1' },
      'chat_turn',
      expect.objectContaining({ spaceId: 'sp1', userId: 'u1' }),
    );
  });

  it('chargeWorkflow is a no-op when OFF', async () => {
    const { chargeWorkflow } = await loadMeter(false);
    await chargeWorkflow('sp1', 'chat_turn');
    expect(spendMock).not.toHaveBeenCalled();
  });

  it('chargeWorkflow never throws even if the debit fails (metering must not break work)', async () => {
    spendMock.mockRejectedValue(new Error('db down'));
    const { chargeWorkflow } = await loadMeter(true);
    await expect(chargeWorkflow('sp1', 'chat_turn')).resolves.toBeUndefined();
  });
});
