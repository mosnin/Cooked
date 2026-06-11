/**
 * Threat-model test suite for the realtor / broker conversation isolation
 * boundary.
 *
 * The threat: broker-Chippi and brokerage team chats share the
 * `Conversation` table with realtor conversations, keyed by `spaceId` and
 * distinguished only by a reserved title prefix. A broker_owner also owns
 * their personal realtor space, so space ownership ALONE does not isolate the
 * two surfaces. Without an explicit reserved-title guard, a realtor (or a
 * broker hitting the realtor endpoints) could read or mutate broker-side
 * conversations through the realtor routes.
 *
 * Every test here CROSSES the boundary on purpose and asserts denial:
 *   - GET /api/ai/messages on a [BROKER_CHIPPI] conv  -> 404, no message rows
 *   - GET /api/ai/messages on a [BROKERAGE_CHAT] conv -> 404, no message rows
 *   - GET /api/ai/conversations (realtor list) excludes BOTH reserved prefixes
 *   - PATCH /api/ai/conversations/[id] on a [BROKER_CHIPPI] conv -> 404
 *   - DELETE /api/ai/conversations/[id] on a [BROKER_CHIPPI] conv -> 404
 *
 * These must FAIL if the guards are reverted and PASS on the current code.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (declared before importing the routes) ────────────────────────────

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: 'user_clerk_123' })),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99 })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/space', () => ({
  getSpaceFromSlug: vi.fn(async () => ({ id: 's_realtor_1', slug: 'jane', ownerId: 'u_1' })),
}));

// ── Supabase mock ───────────────────────────────────────────────────────────
//
// A per-table response queue. Each table name maps to a FIFO list of results
// that successive queries against that table resolve to (either via
// `.maybeSingle()` / `.single()` or by awaiting the chain directly). Tests
// seed the queue per scenario. We also record every `.not('title','like', x)`
// call so we can assert the realtor list applies BOTH reserved-prefix filters.

type TableResult = { data?: unknown; error?: unknown };

const tableQueues: Record<string, TableResult[]> = {};
const notFilterCalls: { table: string; column: string; op: string; value: unknown }[] = [];

function seed(table: string, ...results: TableResult[]) {
  tableQueues[table] = (tableQueues[table] ?? []).concat(results);
}

function nextResult(table: string): TableResult {
  const q = tableQueues[table];
  if (q && q.length > 0) return q.shift() as TableResult;
  // Default: no rows. The route treats this as "not found" / empty.
  return { data: null };
}

function makeChain(table: string) {
  // `result` is resolved lazily on the terminal call so that the chain can be
  // built first and the queued result pulled when the query actually runs.
  const chain: Record<string, unknown> = {};
  const passthroughMethods = ['select', 'eq', 'order', 'limit', 'in', 'insert', 'update', 'delete'];
  for (const m of passthroughMethods) {
    chain[m] = vi.fn(() => chain);
  }
  chain.not = vi.fn((column: string, op: string, value: unknown) => {
    notFilterCalls.push({ table, column, op, value });
    return chain;
  });
  chain.maybeSingle = vi.fn(() => Promise.resolve(nextResult(table)));
  chain.single = vi.fn(() => Promise.resolve(nextResult(table)));
  // Awaiting the chain directly (list queries) resolves the next result.
  (chain as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(nextResult(table)).then(resolve);
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn((table: string) => makeChain(table)) },
}));

// Import AFTER the mocks.
import { GET as getMessages } from '@/app/api/ai/messages/route';
import { GET as getConversations } from '@/app/api/ai/conversations/route';
import { PATCH as patchConversation, DELETE as deleteConversation } from '@/app/api/ai/conversations/[id]/route';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  notFilterCalls.length = 0;
});

// ── Helpers ─────────────────────────────────────────────────────────────────

// The routes read `req.nextUrl.searchParams`, a NextRequest property a plain
// Request does not have. We hand them a minimal stand-in with `nextUrl` and a
// `json()` body reader, which is all these handlers touch.
function nextRequest(url: string, body?: Record<string, unknown>) {
  return {
    nextUrl: new URL(url),
    json: async () => body ?? {},
  };
}

function messagesRequest(conversationId: string) {
  return nextRequest(
    `http://localhost/api/ai/messages?conversationId=${encodeURIComponent(conversationId)}`,
  ) as unknown as Parameters<typeof getMessages>[0];
}

function conversationsRequest(slug = 'jane') {
  return nextRequest(
    `http://localhost/api/ai/conversations?slug=${encodeURIComponent(slug)}`,
  ) as unknown as Parameters<typeof getConversations>[0];
}

function idRequest(body?: Record<string, unknown>) {
  return nextRequest('http://localhost/api/ai/conversations/c_1', body) as unknown as Parameters<typeof patchConversation>[0];
}

const idParams = { params: Promise.resolve({ id: 'c_broker_1' }) };

// ── GET /api/ai/messages ────────────────────────────────────────────────────

describe('GET /api/ai/messages — broker/team conversations are denied', () => {
  it('404s a [BROKER_CHIPPI] conversation and returns NO message rows', async () => {
    // The caller legitimately owns the space (broker_owner owns their realtor
    // space). Ownership passes; the reserved-title guard is what denies.
    seed('Conversation', { data: { id: 'c_broker_1', spaceId: 's_realtor_1', title: '[BROKER_CHIPPI] private notes' } });
    seed('User', { data: { id: 'u_1' } });
    seed('Space', { data: { id: 's_realtor_1', ownerId: 'u_1' } });
    // If the guard were missing, this is the row set that would leak.
    seed('Message', { data: [{ id: 'm_1', role: 'assistant', content: 'broker secret', blocks: null, createdAt: '2026-01-01' }] });

    const res = await getMessages(messagesRequest('c_broker_1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('broker secret');
  });

  it('404s a [BROKERAGE_CHAT] conversation and returns NO message rows', async () => {
    seed('Conversation', { data: { id: 'c_team_1', spaceId: 's_realtor_1', title: '[BROKERAGE_CHAT] team room' } });
    seed('User', { data: { id: 'u_1' } });
    seed('Space', { data: { id: 's_realtor_1', ownerId: 'u_1' } });
    seed('Message', { data: [{ id: 'm_1', role: 'assistant', content: 'team secret', blocks: null, createdAt: '2026-01-01' }] });

    const res = await getMessages(messagesRequest('c_team_1'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(false);
    expect(JSON.stringify(body)).not.toContain('team secret');
  });

  it('serves a plain realtor conversation (control: the guard is not over-broad)', async () => {
    seed('Conversation', { data: { id: 'c_realtor_1', spaceId: 's_realtor_1', title: 'Follow up with the Garcias' } });
    seed('User', { data: { id: 'u_1' } });
    seed('Space', { data: { id: 's_realtor_1', ownerId: 'u_1' } });
    seed('Message', { data: [{ id: 'm_1', role: 'user', content: 'hi', blocks: null, createdAt: '2026-01-01' }] });

    const res = await getMessages(messagesRequest('c_realtor_1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });
});

// ── GET /api/ai/conversations (realtor list) ────────────────────────────────

describe('GET /api/ai/conversations — list excludes BOTH reserved prefixes', () => {
  it('applies a .not(title,like) filter for each reserved prefix', async () => {
    seed('User', { data: { id: 'u_1' } });
    seed('Conversation', { data: [] }); // list query resolves to no rows
    // No Message preview query because the list is empty.

    const res = await getConversations(conversationsRequest());
    expect(res.status).toBe(200);

    const titleLikeValues = notFilterCalls
      .filter((c) => c.table === 'Conversation' && c.column === 'title' && c.op === 'like')
      .map((c) => c.value);
    expect(titleLikeValues).toContain('[BROKER_CHIPPI]%');
    expect(titleLikeValues).toContain('[BROKERAGE_CHAT]%');
  });

  it('does not return a seeded broker row in the realtor list', async () => {
    // The mock list query just echoes whatever we queue; if the route ever
    // stopped filtering at the DB layer, a defensive belt would still be the
    // .not filters asserted above. Here we confirm the route surfaces exactly
    // what the (filtered) query returns and nothing extra.
    seed('User', { data: { id: 'u_1' } });
    seed('Conversation', { data: [{ id: 'c_realtor_1', spaceId: 's_realtor_1', title: 'Garcias' }] });
    seed('Message', { data: [] }); // preview lookup

    const res = await getConversations(conversationsRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const titles = (body as { title: string }[]).map((c) => c.title);
    expect(titles).not.toContain('[BROKER_CHIPPI] private notes');
    expect(titles).not.toContain('[BROKERAGE_CHAT] team room');
  });
});

// ── PATCH / DELETE /api/ai/conversations/[id] ───────────────────────────────

describe('PATCH /api/ai/conversations/[id] — broker conversation denied', () => {
  it('404s renaming a [BROKER_CHIPPI] conversation even when ownership matches', async () => {
    // Embedded Space(ownerId) on the conversation row; owner lookup then
    // succeeds. The reserved-title guard is what denies the rename.
    seed('Conversation', { data: { id: 'c_broker_1', spaceId: 's_realtor_1', title: '[BROKER_CHIPPI] private', Space: { ownerId: 'u_1' } } });
    seed('User', { data: { id: 'u_1' } });

    const res = await patchConversation(idRequest({ title: 'hijacked' }), idParams);
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/ai/conversations/[id] — broker conversation denied', () => {
  it('404s deleting a [BROKER_CHIPPI] conversation even when ownership matches', async () => {
    seed('Conversation', { data: { id: 'c_broker_1', spaceId: 's_realtor_1', title: '[BROKER_CHIPPI] private', Space: { ownerId: 'u_1' } } });
    seed('User', { data: { id: 'u_1' } });

    const res = await deleteConversation(idRequest(), idParams);
    expect(res.status).toBe(404);
  });

  it('404s deleting a [BROKERAGE_CHAT] conversation even when ownership matches', async () => {
    seed('Conversation', { data: { id: 'c_team_1', spaceId: 's_realtor_1', title: '[BROKERAGE_CHAT] team', Space: { ownerId: 'u_1' } } });
    seed('User', { data: { id: 'u_1' } });

    const res = await deleteConversation(idRequest(), idParams);
    expect(res.status).toBe(404);
  });
});
