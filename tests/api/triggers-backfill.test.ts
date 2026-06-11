/**
 * Route-level test for `POST /api/admin/triggers/backfill`.
 *
 * The backfill registers curated triggers for existing active
 * IntegrationConnection rows that don't have any. It runs once after
 * a feature ship; idempotent on a second invocation.
 *
 * What we lock in:
 *   - Bearer ${CRON_SECRET} gate — wrong/missing → 401
 *   - 500 when CRON_SECRET isn't configured server-side
 *   - Skips connections that already have IntegrationTrigger rows
 *   - Skips toolkits with no curated triggers
 *   - Counts scanned/registered/failed/skipped correctly
 *   - `force=1` bypasses the existing-rows skip
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Supabase mock: returns a fixed set of active connections.
const supabaseConnections: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'in', 'order', 'limit', 'is'];
      for (const m of passthrough) chain[m] = vi.fn(() => chain);
      const term = () => Promise.resolve({ data: supabaseConnections, error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: unknown) => unknown) => term().then(r);
      return chain;
    }),
  },
}));

const { listMock, registerMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  registerMock: vi.fn(),
}));
vi.mock('@/lib/integrations/triggers', async (importOriginal) => {
  // Keep CURATED_TRIGGERS real so the "no curated slugs → skip" branch
  // is testable on actual map state, not a fixture.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listTriggersForConnection: listMock,
    registerForConnection: registerMock,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Caller is treated as a non-admin so these tests exercise the CRON_SECRET path.
vi.mock('@/lib/permissions', () => ({
  isPlatformAdmin: vi.fn().mockResolvedValue(false),
}));

import { POST } from '@/app/api/admin/triggers/backfill/route';

function makeReq(opts: { auth?: string; force?: boolean } = {}) {
  const url = `http://localhost/api/admin/triggers/backfill${opts.force ? '?force=1' : ''}`;
  return new NextRequest(url, {
    method: 'POST',
    headers: opts.auth ? { Authorization: opts.auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseConnections.length = 0;
  listMock.mockResolvedValue([]);
  registerMock.mockResolvedValue({ registered: 1, failed: 0 });
  process.env.CRON_SECRET = 'test-secret';
});

describe('POST /api/admin/triggers/backfill', () => {
  it('500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeReq());
    expect(res.status).toBe(500);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('401 on wrong bearer token', async () => {
    const res = await POST(makeReq({ auth: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('401 when Authorization header is missing', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it('registers triggers for each active connection that has none', async () => {
    supabaseConnections.push(
      { id: 'c1', spaceId: 's1', userId: 'u1', toolkit: 'gmail', composioConnectionId: 'ca1', status: 'active' },
      { id: 'c2', spaceId: 's1', userId: 'u1', toolkit: 'hubspot', composioConnectionId: 'ca2', status: 'active' },
    );
    listMock.mockResolvedValue([]); // none registered yet
    registerMock.mockResolvedValueOnce({ registered: 1, failed: 0 })
                .mockResolvedValueOnce({ registered: 2, failed: 0 });

    const res = await POST(makeReq({ auth: 'Bearer test-secret' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scanned).toBe(2);
    expect(body.registered).toBe(3);
    expect(body.failed).toBe(0);
    expect(body.skipped).toBe(0);
    expect(registerMock).toHaveBeenCalledTimes(2);
  });

  it('skips connections that already have IntegrationTrigger rows', async () => {
    supabaseConnections.push(
      { id: 'c1', spaceId: 's1', userId: 'u1', toolkit: 'gmail', composioConnectionId: 'ca1', status: 'active' },
    );
    listMock.mockResolvedValue([{ id: 'existing-row' }]); // already registered

    const res = await POST(makeReq({ auth: 'Bearer test-secret' }));
    const body = await res.json();

    expect(body.scanned).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.registered).toBe(0);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('skips toolkits with no curated triggers (empty CURATED_TRIGGERS entry)', async () => {
    // 'zoho' is empty in the curated map.
    supabaseConnections.push(
      { id: 'c1', spaceId: 's1', userId: 'u1', toolkit: 'zoho', composioConnectionId: 'ca1', status: 'active' },
    );

    const res = await POST(makeReq({ auth: 'Bearer test-secret' }));
    const body = await res.json();

    expect(body.scanned).toBe(1);
    expect(body.skipped).toBe(1);
    expect(listMock).not.toHaveBeenCalled();
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('force=1 bypasses the all-rows-exist skip but still per-slug deltas', async () => {
    // force=1 now uses per-slug delta. If the existing rows already
    // cover EVERY curated slug for the toolkit, the connection is
    // still skipped — preventing duplicate Composio subscriptions
    // (which would cost real money). Only when at least one
    // CURATED_TRIGGERS slug is missing from existing rows does
    // registerForConnection run.
    supabaseConnections.push(
      { id: 'c1', spaceId: 's1', userId: 'u1', toolkit: 'gmail', composioConnectionId: 'ca1', status: 'active' },
    );
    // Existing rows are missing the gmail curated slug (only the
    // GMAIL_NEW_GMAIL_MESSAGE is curated for gmail). Stub existing as
    // a different slug name so the delta is non-empty.
    listMock.mockResolvedValue([{ id: 'existing', triggerSlug: 'SOMETHING_ELSE' }]);
    registerMock.mockResolvedValueOnce({ registered: 1, failed: 0 });

    const res = await POST(makeReq({ auth: 'Bearer test-secret', force: true }));
    const body = await res.json();

    expect(body.registered).toBe(1);
    // force=1 DOES call listTriggersForConnection (for the delta check).
    expect(listMock).toHaveBeenCalled();
    expect(registerMock).toHaveBeenCalledTimes(1);
  });

  it('force=1 still skips when every curated slug is already present (no duplicate Composio subscriptions)', async () => {
    supabaseConnections.push(
      { id: 'c1', spaceId: 's1', userId: 'u1', toolkit: 'gmail', composioConnectionId: 'ca1', status: 'active' },
    );
    // Existing rows cover every gmail curated slug → delta empty → skip.
    listMock.mockResolvedValue([{ id: 'r1', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE' }]);

    const res = await POST(makeReq({ auth: 'Bearer test-secret', force: true }));
    const body = await res.json();

    expect(body.skipped).toBe(1);
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('captures per-connection failure without dropping the rest', async () => {
    supabaseConnections.push(
      { id: 'c1', spaceId: 's1', userId: 'u1', toolkit: 'gmail', composioConnectionId: 'ca1', status: 'active' },
      { id: 'c2', spaceId: 's1', userId: 'u1', toolkit: 'gmail', composioConnectionId: 'ca2', status: 'active' },
    );
    listMock.mockResolvedValue([]);
    registerMock.mockRejectedValueOnce(new Error('composio rejected'))
                .mockResolvedValueOnce({ registered: 1, failed: 0 });

    const res = await POST(makeReq({ auth: 'Bearer test-secret' }));
    const body = await res.json();

    expect(body.scanned).toBe(2);
    expect(body.registered).toBe(1);
    expect(body.failed).toBeGreaterThan(0);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].connectionId).toBe('c1');
  });
});
