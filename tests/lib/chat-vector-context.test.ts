/**
 * Tests for the Phase 4 proactive vector context retriever.
 *
 * Covers:
 *   - skips work entirely on short messages (<10 chars)
 *   - calls embed() + match_agent_memory rpc with the right shape
 *   - parses entity matches into the formatted block
 *   - caches by (spaceId, messageHash) for 5 min
 *   - never throws — failures degrade gracefully to empty block
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));
vi.mock('@/lib/agent-memory/embed', () => ({
  embed: embedMock,
  EMBED_MODEL: 'text-embedding-3-small',
  EMBED_DIMS: 1536,
}));

const { supabaseMock, rpcResp, contactResp, dealResp, propertyResp } = vi.hoisted(() => {
  const rpcResp = { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null };
  const contactResp = { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null };
  const dealResp = { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null };
  const propertyResp = { data: [] as Array<Record<string, unknown>>, error: null as { message: string } | null };

  // Track which table the current chain is for so the limit() resolver
  // returns the right canned response.
  let activeTable: string = '';

  const tableChain = () => ({
    select() { return this; },
    eq() { return this; },
    or() { return this; },
    limit() {
      if (activeTable === 'Contact') return Promise.resolve(contactResp);
      if (activeTable === 'Deal') return Promise.resolve(dealResp);
      if (activeTable === 'Property') return Promise.resolve(propertyResp);
      return Promise.resolve({ data: [], error: null });
    },
  });

  const supabaseMock = {
    from: (t: string) => {
      activeTable = t;
      return tableChain();
    },
    rpc: vi.fn(() => Promise.resolve(rpcResp)),
  };
  return { supabaseMock, rpcResp, contactResp, dealResp, propertyResp };
});

vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import {
  retrieveContext,
  _clearContextCacheForTesting,
} from '@/lib/chat/vector-context';

beforeEach(() => {
  _clearContextCacheForTesting();
  embedMock.mockReset();
  embedMock.mockResolvedValue(new Array(1536).fill(0));
  supabaseMock.rpc.mockClear();
  rpcResp.data = [];
  rpcResp.error = null;
  contactResp.data = [];
  contactResp.error = null;
  dealResp.data = [];
  dealResp.error = null;
  propertyResp.data = [];
  propertyResp.error = null;
});

describe('retrieveContext — short circuits', () => {
  it('skips when message is below the 10-char floor', async () => {
    const r = await retrieveContext({ spaceId: 'sp1', userMessage: 'hi' });
    expect(r.block).toBe('');
    expect(embedMock).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('skips when spaceId is missing', async () => {
    const r = await retrieveContext({ spaceId: '', userMessage: 'long enough message here.' });
    expect(r.block).toBe('');
    expect(embedMock).not.toHaveBeenCalled();
  });
});

describe('retrieveContext — happy path', () => {
  it('embeds the message and queries match_agent_memory', async () => {
    rpcResp.data = [
      { content: 'Preston wants a 3-bed under $500k', similarity: 0.82 },
      { content: 'Sarah\'s tour was canceled', similarity: 0.71 },
    ];
    const r = await retrieveContext({
      spaceId: 'sp1',
      userMessage: 'What did Preston say about pricing recently?',
      k: 3,
    });
    expect(embedMock).toHaveBeenCalledWith('What did Preston say about pricing recently?');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('match_agent_memory', expect.objectContaining({
      match_space_id: 'sp1',
      match_count: 3,
      filter_memory_type: null,
      filter_entity_type: null,
      filter_entity_id: null,
      min_similarity: 0.5,
    }));
    expect(r.memories).toHaveLength(2);
    expect(r.block).toMatch(/## Workspace context/);
    expect(r.block).toMatch(/Relevant prior notes/);
    expect(r.block).toMatch(/Preston wants a 3-bed under \$500k/);
    expect(r.block).toMatch(/82%/);
  });

  it('includes literal-name matches for contacts/deals/properties', async () => {
    contactResp.data = [
      { id: 'c1', name: 'Preston Wilms', leadType: 'buyer', leadScore: 72 },
    ];
    dealResp.data = [
      { id: 'd1', title: '456 Oak Ave', value: 480000, status: 'active', address: '456 Oak Ave' },
    ];
    propertyResp.data = [
      { id: 'p1', address: '456 Oak Ave', city: 'Austin', listingStatus: 'active', listPrice: 480000 },
    ];
    const r = await retrieveContext({
      spaceId: 'sp1',
      userMessage: 'Tell me everything about Preston and the 456 Oak Ave deal.',
    });
    expect(r.contacts[0]).toMatchObject({ id: 'c1', label: 'Preston Wilms' });
    expect(r.deals[0]).toMatchObject({ id: 'd1', label: '456 Oak Ave' });
    expect(r.properties[0]).toMatchObject({ id: 'p1', label: '456 Oak Ave' });
    expect(r.block).toMatch(/Preston Wilms/);
    expect(r.block).toMatch(/456 Oak Ave/);
  });

  it('returns an empty block when nothing relevant comes back', async () => {
    const r = await retrieveContext({
      spaceId: 'sp1',
      userMessage: 'A long enough message but nothing matches.',
    });
    expect(r.block).toBe('');
    expect(r.memories).toEqual([]);
    expect(r.contacts).toEqual([]);
  });
});

describe('retrieveContext — caching', () => {
  it('reuses the cached result on a second identical call within TTL', async () => {
    rpcResp.data = [{ content: 'memory A', similarity: 0.9 }];
    const m = 'What did Preston say about pricing recently?';
    const r1 = await retrieveContext({ spaceId: 'sp1', userMessage: m });
    const r2 = await retrieveContext({ spaceId: 'sp1', userMessage: m });
    expect(r1).toBe(r2);
    // embed + rpc are called exactly once across both retrievals
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('separates cache entries by spaceId', async () => {
    rpcResp.data = [{ content: 'memory A', similarity: 0.9 }];
    const m = 'Same query different space.';
    await retrieveContext({ spaceId: 'sp1', userMessage: m });
    await retrieveContext({ spaceId: 'sp2', userMessage: m });
    expect(embedMock).toHaveBeenCalledTimes(2);
  });
});

describe('retrieveContext — failure modes', () => {
  it('returns an empty memories list when embed throws', async () => {
    embedMock.mockRejectedValueOnce(new Error('boom'));
    const r = await retrieveContext({
      spaceId: 'sp1',
      userMessage: 'A message that needs context.',
    });
    expect(r.memories).toEqual([]);
    // Never throws.
  });

  it('returns an empty memories list when the rpc errors', async () => {
    rpcResp.error = { message: 'rpc failed' };
    const r = await retrieveContext({
      spaceId: 'sp1',
      userMessage: 'A message that needs context.',
    });
    expect(r.memories).toEqual([]);
  });
});
