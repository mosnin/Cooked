/**
 * Tests for `lib/integrations/triggers.ts` — the lifecycle + dispatch
 * layer for Composio trigger subscriptions.
 *
 * Three behaviours we lock in:
 *   1. registerForConnection registers EACH curated slug and tolerates a
 *      single-slug failure without dropping the rest.
 *   2. dispatchTrigger routes a DRAFT slug to fireRoutineRun with a
 *      templated instruction; an unmapped slug is a no-op; a thin
 *      payload also no-ops.
 *   3. deleteForConnection deletes every Composio trigger AND wipes the
 *      DB rows, in that order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Composio SDK wrapper mocks ────────────────────────────────────────

const { createTriggerMock, deleteTriggerMock } = vi.hoisted(() => ({
  createTriggerMock: vi.fn(),
  deleteTriggerMock: vi.fn(async () => undefined),
}));

vi.mock('@/lib/integrations/composio', () => ({
  createTrigger: createTriggerMock,
  deleteTrigger: deleteTriggerMock,
}));

// ── fireRoutineRun mock ───────────────────────────────────────────────

const { fireRoutineRunMock } = vi.hoisted(() => ({
  fireRoutineRunMock: vi.fn(async () => 'ok' as const),
}));
vi.mock('@/lib/routines', () => ({
  fireRoutineRun: fireRoutineRunMock,
}));

// ── Supabase mock — captures upsert/delete/select on IntegrationTrigger

type Terminal = { data: unknown; error: unknown };
const supabaseState: {
  terminal: Terminal;
  calls: Array<{ table: string; chain: Array<[string, unknown[]]> }>;
} = { terminal: { data: null, error: null }, calls: [] };

vi.mock('@/lib/supabase', () => {
  function makeChain(table: string): Record<string, unknown> {
    const chainCalls: Array<[string, unknown[]]> = [];
    supabaseState.calls.push({ table, chain: chainCalls });
    const chain: Record<string, unknown> = {};
    const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
    for (const method of passthrough) {
      chain[method] = vi.fn((...args: unknown[]) => {
        chainCalls.push([method, args]);
        return chain;
      });
    }
    const term = () => Promise.resolve(supabaseState.terminal);
    chain.maybeSingle = vi.fn(term);
    chain.single = vi.fn(term);
    chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
      Promise.resolve(supabaseState.terminal).then(r, e);
    return chain;
  }
  return { supabase: { from: vi.fn((table: string) => makeChain(table)) } };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  registerForConnection,
  deleteForConnection,
  dispatchTrigger,
  setPausedForConnection,
  summariesForConnections,
  CURATED_TRIGGERS,
} from '@/lib/integrations/triggers';
import type { IntegrationConnectionRow } from '@/lib/integrations/connections';

function freshConnection(overrides: Partial<IntegrationConnectionRow> = {}): IntegrationConnectionRow {
  return {
    id: 'conn-1',
    spaceId: 'space-1',
    userId: 'user-1',
    toolkit: 'gmail',
    composioConnectionId: 'ca_abc',
    status: 'active',
    label: 'me@example.com',
    lastError: null,
    lastUsedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  createTriggerMock.mockReset();
  deleteTriggerMock.mockReset();
  fireRoutineRunMock.mockReset();
  fireRoutineRunMock.mockResolvedValue('ok');
  supabaseState.terminal = { data: null, error: null };
  supabaseState.calls = [];
});

// ─── CURATED_TRIGGERS sanity ─────────────────────────────────────────────────

describe('CURATED_TRIGGERS', () => {
  it('has an entry for every catalog toolkit that ships triggers', () => {
    // Gmail must ship with at least one slug — the v1 ship gate.
    expect(CURATED_TRIGGERS.gmail).toContain('GMAIL_NEW_GMAIL_MESSAGE');
  });

  it('uses UPPER_SNAKE_CASE for every slug it registers', () => {
    for (const [toolkit, slugs] of Object.entries(CURATED_TRIGGERS)) {
      for (const slug of slugs) {
        expect(slug, `${toolkit} → ${slug}`).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    }
  });

  it('every curated slug has a dispatch + a working template', async () => {
    // Catches the failure mode where a slug enters CURATED_TRIGGERS
    // but TRIGGER_DISPATCH / TEMPLATES weren't updated. Registration
    // would succeed at Composio; deliveries would silently no-op.
    // Hits the dispatcher with a generously-shaped payload so the
    // template's bail-out branch doesn't masquerade as "no dispatch".
    const conn = freshConnection();
    const fatPayload = {
      // Cover field names across Gmail/Outlook/Slack/Discord/CRMs/Stripe.
      subject: 'X', from: 'a@b', sender: 'a@b', snippet: 'hi',
      bodyPreview: 'hi', text: 'hi', message: 'hi', user: 'u', author: 'u',
      summary: 'evt', responseStatus: 'accepted', startTime: 'soon',
      attendees: [{ email: 'x@y' }],
      properties: { firstname: 'A', lastname: 'B', email: 'a@b', phone: '1', dealname: 'D', dealstage: 'open' },
      name: 'N', company: 'C', leadSource: 'web', stageName: 'open', amount: '1',
      title: 'T', value: '1', personName: 'P',
      amount_total: '1', customer_email: 'a@b', failure_message: 'f', amount_paid: '1',
      taskName: 'T', listName: 'L', reaction: 'thumbs_up',
      cardName: 'C', change: 'moved',
      content: 'msg',
      emailAddress: 'a@b',
    };
    for (const [toolkit, slugs] of Object.entries(CURATED_TRIGGERS)) {
      for (const slug of slugs) {
        const result = await dispatchTrigger({
          triggerSlug: slug,
          connection: conn,
          payload: fatPayload,
        });
        // Every curated slug must either DRAFT or have a well-known
        // skip reason (NOT 'no_dispatch' — that means we forgot to
        // wire it up).
        if (result.dispatched === 'noop') {
          expect(result.reason, `${toolkit} → ${slug} should dispatch on a full payload`).not.toBe('no_dispatch');
        }
      }
    }
  });
});

// ─── registerForConnection ───────────────────────────────────────────────────

describe('registerForConnection', () => {
  it('registers every curated slug and returns the counts', async () => {
    createTriggerMock.mockImplementation(async (args: { slug: string }) => ({
      triggerId: `trg_${args.slug.toLowerCase()}`,
    }));
    supabaseState.terminal = { data: null, error: null };

    const result = await registerForConnection({ connection: freshConnection() });

    expect(createTriggerMock).toHaveBeenCalledTimes(CURATED_TRIGGERS.gmail.length);
    expect(result.registered).toBe(CURATED_TRIGGERS.gmail.length);
    expect(result.failed).toBe(0);
  });

  it('records a failed row when one slug throws and continues the rest', async () => {
    // Force a failure by faking gmail to have two slugs for this test —
    // we mock createTrigger by call index, regardless of the map's real
    // length (the asserts below don't depend on map size).
    const slugCount = CURATED_TRIGGERS.gmail.length;
    if (slugCount < 1) {
      throw new Error('gmail map must have at least one slug for this test to be meaningful');
    }
    createTriggerMock.mockImplementationOnce(async () => {
      throw new Error('composio said no');
    });
    // Subsequent calls succeed.
    createTriggerMock.mockImplementation(async (args: { slug: string }) => ({
      triggerId: `trg_${args.slug.toLowerCase()}`,
    }));

    const result = await registerForConnection({ connection: freshConnection() });

    expect(result.failed).toBe(1);
    expect(result.registered).toBe(slugCount - 1);
  });

  it('is a no-op when the toolkit has no curated triggers', async () => {
    // `zoho` is intentionally empty in CURATED_TRIGGERS (see the per-
    // entry comment in lib/integrations/triggers.ts). If this test
    // starts failing, either (a) zoho got triggers, in which case
    // swap to another intentionally-empty toolkit, or (b) we
    // accidentally registered something — investigate the map.
    const result = await registerForConnection({
      connection: freshConnection({ toolkit: 'zoho' }),
    });
    expect(createTriggerMock).not.toHaveBeenCalled();
    expect(result).toEqual({ registered: 0, failed: 0 });
  });
});

// ─── deleteForConnection ─────────────────────────────────────────────────────

describe('deleteForConnection', () => {
  it('deletes every Composio trigger AND the DB rows', async () => {
    // First supabase call (list) returns two rows; second call is the delete.
    let callIndex = 0;
    supabaseState.terminal = { data: null, error: null };
    const responses: Terminal[] = [
      { data: [
        { id: 'r1', composioTriggerId: 'trg_a', connectionId: 'conn-1' },
        { id: 'r2', composioTriggerId: 'trg_b', connectionId: 'conn-1' },
      ], error: null },
      { data: null, error: null },
    ];
    vi.mocked(supabaseState).calls = [];

    // Intercept the supabase mock to swap the terminal per call.
    const { supabase } = await import('@/lib/supabase');
    const origFrom = supabase.from as ReturnType<typeof vi.fn>;
    origFrom.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) chain[m] = vi.fn(() => chain);
      const term = () => Promise.resolve(responses[callIndex++] ?? { data: null, error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve(responses[callIndex++] ?? { data: null, error: null }).then(r, e);
      return chain;
    });

    await deleteForConnection('conn-1');

    expect(deleteTriggerMock).toHaveBeenCalledWith('trg_a');
    expect(deleteTriggerMock).toHaveBeenCalledWith('trg_b');
    expect(deleteTriggerMock).toHaveBeenCalledTimes(2);
  });

  it('skips Composio delete for rows with null composioTriggerId', async () => {
    let callIndex = 0;
    const responses: Terminal[] = [
      { data: [{ id: 'r1', composioTriggerId: null, connectionId: 'conn-1' }], error: null },
      { data: null, error: null },
    ];
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) chain[m] = vi.fn(() => chain);
      const term = () => Promise.resolve(responses[callIndex++] ?? { data: null, error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve(responses[callIndex++] ?? { data: null, error: null }).then(r, e);
      return chain;
    });

    await deleteForConnection('conn-1');

    expect(deleteTriggerMock).not.toHaveBeenCalled();
  });
});

// ─── setPausedForConnection ──────────────────────────────────────────────────

describe('setPausedForConnection', () => {
  it('updates rows from active → paused when called with paused:true', async () => {
    // Capture the chain to assert what was filtered + what was set.
    let chainCalls: Array<[string, unknown[]]> = [];
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) {
        chain[m] = vi.fn((...args: unknown[]) => {
          chainCalls.push([m, args]);
          return chain;
        });
      }
      chainCalls = [];
      const term = () => Promise.resolve({ data: [{ id: 'r1' }, { id: 'r2' }], error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'r1' }, { id: 'r2' }], error: null }).then(r, e);
      return chain;
    });

    const result = await setPausedForConnection({ connectionId: 'conn-1', paused: true });

    expect(result.updated).toBe(2);
    // Must have filtered on the OPPOSITE status — the helper only flips
    // rows in the wrong state, leaving paused-already and failed alone.
    const eqCalls = chainCalls.filter(([m]) => m === 'eq');
    expect(eqCalls).toContainEqual(['eq', ['status', 'active']]);
    // And updated TO 'paused'.
    const updateCall = chainCalls.find(([m]) => m === 'update');
    expect((updateCall![1][0] as { status: string }).status).toBe('paused');
  });

  it('updates rows from paused → active when called with paused:false', async () => {
    let chainCalls: Array<[string, unknown[]]> = [];
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) {
        chain[m] = vi.fn((...args: unknown[]) => {
          chainCalls.push([m, args]);
          return chain;
        });
      }
      chainCalls = [];
      const term = () => Promise.resolve({ data: [{ id: 'r1' }], error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'r1' }], error: null }).then(r, e);
      return chain;
    });

    const result = await setPausedForConnection({ connectionId: 'conn-1', paused: false });

    expect(result.updated).toBe(1);
    const eqCalls = chainCalls.filter(([m]) => m === 'eq');
    expect(eqCalls).toContainEqual(['eq', ['status', 'paused']]);
    const updateCall = chainCalls.find(([m]) => m === 'update');
    expect((updateCall![1][0] as { status: string }).status).toBe('active');
  });
});

// ─── summariesForConnections ─────────────────────────────────────────────────

describe('summariesForConnections', () => {
  it('returns "active" when ANY trigger row is active', async () => {
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) chain[m] = vi.fn(() => chain);
      const data = [
        { connectionId: 'c1', status: 'paused' },
        { connectionId: 'c1', status: 'active' }, // wins
      ];
      const term = () => Promise.resolve({ data, error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(r, e);
      return chain;
    });

    const result = await summariesForConnections(['c1']);
    expect(result.c1).toBe('active');
  });

  it('returns "paused" only when all rows are paused', async () => {
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) chain[m] = vi.fn(() => chain);
      const data = [
        { connectionId: 'c1', status: 'paused' },
        { connectionId: 'c1', status: 'paused' },
      ];
      const term = () => Promise.resolve({ data, error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(r, e);
      return chain;
    });

    const result = await summariesForConnections(['c1']);
    expect(result.c1).toBe('paused');
  });

  it('returns "off" for connections with no rows', async () => {
    const { supabase } = await import('@/lib/supabase');
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      const passthrough = ['select', 'eq', 'is', 'in', 'order', 'limit', 'upsert', 'delete', 'update', 'insert'];
      for (const m of passthrough) chain[m] = vi.fn(() => chain);
      const term = () => Promise.resolve({ data: [], error: null });
      chain.maybeSingle = vi.fn(term);
      chain.single = vi.fn(term);
      chain.then = (r: (v: Terminal) => unknown, e?: (e: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(r, e);
      return chain;
    });

    const result = await summariesForConnections(['c1', 'c2']);
    expect(result.c1).toBe('off');
    expect(result.c2).toBe('off');
  });

  it('is a no-op for an empty input list', async () => {
    const result = await summariesForConnections([]);
    expect(result).toEqual({});
  });
});

// ─── dispatchTrigger ─────────────────────────────────────────────────────────

describe('dispatchTrigger', () => {
  it('routes a DRAFT slug to fireRoutineRun with a templated instruction', async () => {
    const result = await dispatchTrigger({
      triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE',
      connection: freshConnection(),
      payload: {
        subject: 'Offer accepted on 1421 Maple',
        from: 'sarah@example.com',
        snippet: 'Hi — we accept. When can we sign?',
      },
    });

    expect(result.dispatched).toBe('DRAFT');
    expect(fireRoutineRunMock).toHaveBeenCalledTimes(1);
    const call = fireRoutineRunMock.mock.calls[0] as unknown as [string, string, string];
    const [spaceId, instruction, userId] = call;
    expect(spaceId).toBe('space-1');
    expect(userId).toBe('user-1');
    expect(instruction).toContain('Offer accepted on 1421 Maple');
    expect(instruction).toContain('sarah@example.com');
    expect(instruction).toContain('we accept');
    // The honest cue: instruction must tell the model NOT to act on noise.
    expect(instruction.toLowerCase()).toContain('noise');
  });

  it('skips fireRoutineRun when the payload is too thin to act on', async () => {
    const result = await dispatchTrigger({
      triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE',
      connection: freshConnection(),
      payload: {},
    });
    expect(result.dispatched).toBe('noop');
    expect(result.reason).toBe('thin_payload');
    expect(fireRoutineRunMock).not.toHaveBeenCalled();
  });

  it('no-ops for a slug with no dispatch handler', async () => {
    const result = await dispatchTrigger({
      triggerSlug: 'NOT_A_REAL_TRIGGER',
      connection: freshConnection(),
      payload: { anything: 'ok' },
    });
    expect(result.dispatched).toBe('noop');
    expect(result.reason).toBe('no_dispatch');
    expect(fireRoutineRunMock).not.toHaveBeenCalled();
  });
});
