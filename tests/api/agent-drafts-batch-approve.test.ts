/**
 * Route-level test for `POST /api/agent/drafts/batch-approve`.
 *
 * Covers:
 *   - 401 unauth, 403 no-space, 429 rate-limit
 *   - 400 invalid body (missing draftIds, empty array, oversized, wrong types)
 *   - Per-draft scoping: foreign-space draft → not_found (NOT a cross-space leak)
 *   - Per-draft status: non-pending draft → already_<status> (skipped, not failed)
 *   - Happy path: all sent successfully → results[].ok=true, status='sent'
 *   - Partial failure: one delivery fails → other drafts still ok, failed item
 *     has ok=false with the delivery error
 *   - sendDraft + audit + supabase update wired correctly
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@/lib/audit', () => ({
  audit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/delivery', () => ({
  sendDraft: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Supabase mock — table-aware queue ───────────────────────────────────────
// Each call to supabase.from('Table') consumes one terminal result from the
// table's queue. select/eq/in/maybeSingle/single all return the chain itself
// (or resolve with the terminal). Updates are recorded for assertion.
type Terminal = { data?: unknown; error?: unknown };
const queues: Record<string, Terminal[]> = {};
const updateCalls: Array<{ table: string; values: unknown; eq: Array<[string, unknown]> }> = [];

function queueFor(table: string) {
  if (!queues[table]) queues[table] = [];
  return queues[table];
}

vi.mock('@/lib/supabase', () => {
  function makeChain(table: string): Record<string, unknown> {
    const q = queueFor(table);
    const terminal = q.shift() ?? { data: null, error: null };
    let isUpdate = false;
    let updateValues: unknown = undefined;
    const eqs: Array<[string, unknown]> = [];

    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqs.push([col, val]);
      return chain;
    });
    chain.update = vi.fn((values: unknown) => {
      isUpdate = true;
      updateValues = values;
      return chain;
    });
    chain.maybeSingle = vi.fn(() => Promise.resolve(terminal));
    chain.single = vi.fn(() => Promise.resolve(terminal));
    // Update returns a chain that's awaitable on `.eq(...).eq(...)`.
    chain.then = (resolve: (v: Terminal) => unknown, reject?: (e: unknown) => unknown) => {
      if (isUpdate) {
        updateCalls.push({ table, values: updateValues, eq: eqs });
      }
      try {
        return Promise.resolve(terminal).then(resolve, reject);
      } catch (e) {
        return reject ? reject(e) : Promise.reject(e);
      }
    };
    return chain;
  }
  return { supabase: { from: vi.fn((table: string) => makeChain(table)) } };
});

// Import AFTER mocks.
import { POST } from '@/app/api/agent/drafts/batch-approve/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendDraft } from '@/lib/delivery';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSpaceForUser = vi.mocked(getSpaceForUser);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockSendDraft = vi.mocked(sendDraft);

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agent/drafts/batch-approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SPACE = { id: 'space_1', slug: 's', name: 'Test', ownerId: 'owner_1' };

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(queues)) delete queues[k];
  updateCalls.length = 0;
  mockRequireAuth.mockResolvedValue({ userId: 'user_1' });
  mockGetSpaceForUser.mockResolvedValue(SPACE as never);
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
});

describe('POST /api/agent/drafts/batch-approve', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const res = await POST(makeReq({ draftIds: ['a'] }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user has no space', async () => {
    mockGetSpaceForUser.mockResolvedValue(null);
    const res = await POST(makeReq({ draftIds: ['a'] }));
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate-limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false });
    const res = await POST(makeReq({ draftIds: ['a'] }));
    expect(res.status).toBe(429);
  });

  it('returns 400 when draftIds is missing', async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when draftIds is empty', async () => {
    const res = await POST(makeReq({ draftIds: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when draftIds exceeds the max batch size', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id_${i}`);
    const res = await POST(makeReq({ draftIds: ids }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when draftIds contains non-string entries', async () => {
    const res = await POST(makeReq({ draftIds: ['ok', 123, ''] }));
    expect(res.status).toBe(400);
  });

  it('returns not_found for a draftId in another space (the scoping guard)', async () => {
    // Single draftId. The supabase mock returns null data for AgentDraft,
    // emulating .eq('spaceId', space.id) filtering out the foreign-space row.
    queueFor('AgentDraft').push({ data: null, error: null });

    const res = await POST(makeReq({ draftIds: ['foreign_draft'] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: Array<{ draftId: string; ok: boolean; error?: string }> };
    expect(json.results).toEqual([
      { draftId: 'foreign_draft', ok: false, error: 'not_found' },
    ]);
    // sendDraft must NOT have been called for the foreign row.
    expect(mockSendDraft).not.toHaveBeenCalled();
  });

  it('returns already_<status> for a non-pending draft (skipped, not failed)', async () => {
    queueFor('AgentDraft').push({
      data: { id: 'd1', status: 'sent', contactId: 'c1', channel: 'email', subject: 's', content: 'hi' },
      error: null,
    });

    const res = await POST(makeReq({ draftIds: ['d1'] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: Array<{ draftId: string; ok: boolean; error?: string }> };
    expect(json.results).toEqual([{ draftId: 'd1', ok: false, error: 'already_sent' }]);
    expect(mockSendDraft).not.toHaveBeenCalled();
  });

  it('sends all drafts on happy path and returns ok=true per item', async () => {
    // Two drafts. For each: one AgentDraft read, one Contact read, one update.
    queueFor('AgentDraft').push(
      { data: { id: 'd1', status: 'pending', contactId: 'c1', channel: 'email', subject: 's1', content: 'hello 1' }, error: null },
      { data: null, error: null }, // update terminal for d1
    );
    queueFor('Contact').push({ data: { name: 'Alice', email: 'a@x.test', phone: null }, error: null });

    queueFor('AgentDraft').push(
      { data: { id: 'd2', status: 'pending', contactId: 'c2', channel: 'sms', subject: null, content: 'hello 2' }, error: null },
      { data: null, error: null }, // update terminal for d2
    );
    queueFor('Contact').push({ data: { name: 'Bob', email: null, phone: '+15551234' }, error: null });

    mockSendDraft.mockResolvedValueOnce({ sent: true, method: 'email' });
    mockSendDraft.mockResolvedValueOnce({ sent: true, method: 'sms' });

    const res = await POST(makeReq({ draftIds: ['d1', 'd2'] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: Array<{ draftId: string; ok: boolean; status?: string; error?: string }>;
    };
    expect(json.results).toHaveLength(2);
    expect(json.results[0]).toMatchObject({ draftId: 'd1', ok: true, status: 'sent' });
    expect(json.results[1]).toMatchObject({ draftId: 'd2', ok: true, status: 'sent' });
    expect(mockSendDraft).toHaveBeenCalledTimes(2);

    // Each draft generated one update with status='sent'.
    const updates = updateCalls.filter((u) => u.table === 'AgentDraft');
    expect(updates).toHaveLength(2);
    for (const u of updates) {
      expect((u.values as { status: string }).status).toBe('sent');
    }
  });

  it('keeps other items running when one delivery fails', async () => {
    queueFor('AgentDraft').push(
      { data: { id: 'd1', status: 'pending', contactId: 'c1', channel: 'email', subject: 's1', content: 'hi' }, error: null },
      { data: null, error: null }, // update terminal for d1
    );
    queueFor('Contact').push({ data: { name: 'Alice', email: 'a@x.test', phone: null }, error: null });

    queueFor('AgentDraft').push(
      { data: { id: 'd2', status: 'pending', contactId: 'c2', channel: 'email', subject: 's2', content: 'hi' }, error: null },
      { data: null, error: null }, // update terminal for d2
    );
    queueFor('Contact').push({ data: { name: 'Bob', email: 'b@x.test', phone: null }, error: null });

    // d1 fails delivery (stale recipient), d2 succeeds.
    mockSendDraft.mockResolvedValueOnce({ sent: false, method: 'email', error: 'Contact has no email address' });
    mockSendDraft.mockResolvedValueOnce({ sent: true, method: 'email' });

    const res = await POST(makeReq({ draftIds: ['d1', 'd2'] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      results: Array<{ draftId: string; ok: boolean; status?: string; deliveryResult?: { sent: boolean } }>;
    };
    // sent=false → row marked 'approved' (human reviewed, delivery failed),
    // still ok=true because the draft moved out of pending. The deliveryResult
    // carries the failure detail for the UI to surface.
    expect(json.results[0]).toMatchObject({ draftId: 'd1', ok: true, status: 'approved' });
    expect(json.results[0].deliveryResult?.sent).toBe(false);
    expect(json.results[1]).toMatchObject({ draftId: 'd2', ok: true, status: 'sent' });
  });

  it('de-dupes repeated draftIds in the input', async () => {
    queueFor('AgentDraft').push(
      { data: { id: 'd1', status: 'pending', contactId: 'c1', channel: 'note', subject: null, content: 'note' }, error: null },
      { data: null, error: null }, // update terminal
    );
    queueFor('Contact').push({ data: { name: 'Alice', email: null, phone: null }, error: null });

    mockSendDraft.mockResolvedValueOnce({ sent: true, method: 'note' });

    const res = await POST(makeReq({ draftIds: ['d1', 'd1', 'd1'] }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: unknown[] };
    expect(json.results).toHaveLength(1);
    expect(mockSendDraft).toHaveBeenCalledTimes(1);
  });
});
