/**
 * Proactive vector context injection — Phase 4.
 *
 * Before Phase 4, `recall_memory` was a TOOL the agent could choose to call.
 * That meant most turns retrieved no context — the model only fetched
 * memories when it noticed it needed them, which (a) usually came too late
 * and (b) cost a tool round-trip when it did. Phase 4 reverses the contract:
 * we ALWAYS pull top-K relevant context up front and append it to the
 * system message, so the model already has the workspace knowledge by the
 * time it reads the user message.
 *
 * Used by BOTH the direct path (lib/chat/direct-llm.ts) and the agent path
 * (via the existing Modal chat_turn — see lib/chat/context-injection.ts for
 * the agent-side wiring), so quality lifts uniformly regardless of which
 * branch the router picks.
 *
 * What we pull:
 *   - Top-K AgentMemory rows by cosine similarity to the user message
 *   - Any Contact whose `name` appears verbatim in the message (regex pass)
 *   - Any Deal whose `title` appears verbatim in the message (regex pass)
 *   - Any Property whose `address` appears verbatim in the message
 *
 * Skipped entirely when the user message is <10 chars — context for "ok"
 * or "thanks" is wasted tokens. The 10-char floor also dodges the worst
 * embedding edge cases (single tokens get garbage embeddings).
 *
 * Output is a compact markdown block capped at ~400 tokens. The model sees
 * the header `## Workspace context` so it knows what it's reading.
 *
 * Caching: process-local map keyed by (spaceId, sha256(message)). TTL 5 min.
 * If the same realtor re-sends the same query in five minutes (refresh, retry
 * button, conversation restart) we don't pay the embedding cost again.
 */

import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { embed } from '@/lib/agent-memory/embed';

const MIN_MESSAGE_CHARS = 10;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const MAX_CONTEXT_CHARS = 1600; // ~400 tokens
const MAX_NAME_MATCHES = 5; // cap per table to keep the block compact

export interface RetrieveContextInput {
  spaceId: string;
  userMessage: string;
  k?: number;
}

export interface ContextMemory {
  content: string;
  similarity: number;
}

export interface ContextEntity {
  id: string;
  label: string;
  hint: string;
}

export interface RetrieveContextResult {
  /** Pre-formatted markdown block ready to splice into the system prompt.
   *  Empty string when nothing relevant turned up (or message was too short). */
  block: string;
  memories: ContextMemory[];
  contacts: ContextEntity[];
  deals: ContextEntity[];
  properties: ContextEntity[];
}

interface CacheEntry {
  expiresAt: number;
  result: RetrieveContextResult;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(spaceId: string, message: string): string {
  const hash = crypto.createHash('sha256').update(message).digest('hex').slice(0, 16);
  return `${spaceId}:${hash}`;
}

// Pre-cleared so the test suite doesn't accidentally share state.
export function _clearContextCacheForTesting(): void {
  cache.clear();
}

function vectorLiteral(vec: number[]): string {
  return '[' + vec.map((x) => x.toFixed(7)).join(',') + ']';
}

/**
 * Cheap literal-name match. We do a single SQL query per table that ILIKEs
 * against any word longer than 3 chars in the message — `Preston Wilms`
 * → matches Contact.name `Preston Wilms` (exact) AND `Preston` (substring).
 * Cap the result set per table so a generic query doesn't pull the whole
 * book.
 *
 * Trade-off: we accept some over-matching (e.g. "send" matching a property
 * named "Sender's Lane") because the context block is bounded anyway —
 * worst case the noise is trimmed by MAX_CONTEXT_CHARS.
 */
function extractCandidateTokens(message: string): string[] {
  const tokens = message
    .split(/[\s,.;:!?()[\]{}"'`]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  // De-dupe + cap
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(t);
    if (out.length >= 20) break;
  }
  return out;
}

async function matchContactsByName(
  spaceId: string,
  tokens: string[],
): Promise<ContextEntity[]> {
  if (tokens.length === 0) return [];
  // Build an `ilike.*tok*` OR filter — supabase-js's `.or()` takes a
  // comma-separated PostgREST filter spec.
  const orSpec = tokens.map((t) => `name.ilike.%${escapeIlike(t)}%`).join(',');
  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, leadType, "leadScore"')
    .eq('spaceId', spaceId)
    .or(orSpec)
    .limit(MAX_NAME_MATCHES);
  if (error) {
    logger.warn('[vector-context] contact name match failed', { spaceId }, error);
    return [];
  }
  type Row = { id: string; name: string; leadType: string | null; leadScore: number | null };
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    label: r.name,
    hint: r.leadScore != null ? `${r.leadType ?? 'lead'}, score ${r.leadScore}` : (r.leadType ?? 'contact'),
  }));
}

async function matchDealsByTitle(
  spaceId: string,
  tokens: string[],
): Promise<ContextEntity[]> {
  if (tokens.length === 0) return [];
  const orSpec = tokens.map((t) => `title.ilike.%${escapeIlike(t)}%`).join(',');
  const { data, error } = await supabase
    .from('Deal')
    .select('id, title, value, status, address')
    .eq('spaceId', spaceId)
    .or(orSpec)
    .limit(MAX_NAME_MATCHES);
  if (error) {
    logger.warn('[vector-context] deal title match failed', { spaceId }, error);
    return [];
  }
  type Row = {
    id: string;
    title: string;
    value: number | null;
    status: string | null;
    address: string | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const parts: string[] = [];
    if (r.value != null) parts.push(`$${Math.round(r.value).toLocaleString()}`);
    if (r.status) parts.push(r.status);
    if (r.address) parts.push(r.address);
    return { id: r.id, label: r.title, hint: parts.join(' · ') || 'deal' };
  });
}

async function matchPropertiesByAddress(
  spaceId: string,
  tokens: string[],
): Promise<ContextEntity[]> {
  if (tokens.length === 0) return [];
  const orSpec = tokens.map((t) => `address.ilike.%${escapeIlike(t)}%`).join(',');
  const { data, error } = await supabase
    .from('Property')
    .select('id, address, city, "listingStatus", "listPrice"')
    .eq('spaceId', spaceId)
    .or(orSpec)
    .limit(MAX_NAME_MATCHES);
  if (error) {
    logger.warn('[vector-context] property address match failed', { spaceId }, error);
    return [];
  }
  type Row = {
    id: string;
    address: string;
    city: string | null;
    listingStatus: string | null;
    listPrice: number | null;
  };
  return ((data ?? []) as Row[]).map((r) => {
    const parts: string[] = [];
    if (r.listingStatus) parts.push(r.listingStatus);
    if (r.listPrice != null) parts.push(`$${Math.round(r.listPrice).toLocaleString()}`);
    if (r.city) parts.push(r.city);
    return { id: r.id, label: r.address, hint: parts.join(' · ') || 'property' };
  });
}

function escapeIlike(t: string): string {
  // PostgREST `or` parses commas; ilike values shouldn't carry % or _ that
  // weren't intended as wildcards. Strip the dangerous chars.
  return t.replace(/[,%_()]/g, ' ').trim();
}

async function vectorMemorySearch(
  spaceId: string,
  message: string,
  k: number,
): Promise<ContextMemory[]> {
  let embedding: number[];
  try {
    embedding = await embed(message);
  } catch (err) {
    logger.warn('[vector-context] embed failed — skipping memory retrieval', { spaceId }, err);
    return [];
  }
  const { data, error } = await supabase.rpc('match_agent_memory', {
    query_embedding: vectorLiteral(embedding),
    match_space_id: spaceId,
    match_count: k,
    filter_memory_type: null,
    filter_entity_type: null,
    filter_entity_id: null,
    min_similarity: 0.5, // floor — sub-0.5 similarities are noise
  });
  if (error) {
    logger.warn('[vector-context] match_agent_memory rpc failed', { spaceId }, error);
    return [];
  }
  type Row = { content: string; similarity: number | null };
  return ((data ?? []) as Row[]).map((r) => ({
    content: r.content,
    similarity: typeof r.similarity === 'number' ? r.similarity : 0,
  }));
}

/**
 * Format the retrieved pieces into a compact markdown context block. The
 * model sees this verbatim — keep it terse, no preamble. Capped at
 * MAX_CONTEXT_CHARS; we cut from the bottom (memories first, then entities)
 * because the entity hits are most actionable.
 */
function formatBlock(result: Omit<RetrieveContextResult, 'block'>): string {
  const lines: string[] = [];
  if (result.contacts.length > 0) {
    lines.push('### Mentioned contacts');
    for (const c of result.contacts) lines.push(`- ${c.label} (${c.hint})`);
  }
  if (result.deals.length > 0) {
    lines.push('### Mentioned deals');
    for (const d of result.deals) lines.push(`- ${d.label} (${d.hint})`);
  }
  if (result.properties.length > 0) {
    lines.push('### Mentioned properties');
    for (const p of result.properties) lines.push(`- ${p.label} (${p.hint})`);
  }
  if (result.memories.length > 0) {
    lines.push('### Relevant prior notes');
    for (const m of result.memories) {
      const sim = (m.similarity * 100).toFixed(0);
      lines.push(`- (${sim}%) ${m.content}`);
    }
  }
  if (lines.length === 0) return '';
  let body = lines.join('\n');
  if (body.length > MAX_CONTEXT_CHARS) {
    body = body.slice(0, MAX_CONTEXT_CHARS - 1) + '…';
  }
  return `## Workspace context\n${body}`;
}

/**
 * Pull top-K relevant context for this turn. Always returns — failure of
 * any one retrieval path degrades gracefully to whatever else succeeded.
 * Never throws.
 */
export async function retrieveContext(
  input: RetrieveContextInput,
): Promise<RetrieveContextResult> {
  const empty: RetrieveContextResult = {
    block: '',
    memories: [],
    contacts: [],
    deals: [],
    properties: [],
  };

  const message = (input.userMessage ?? '').trim();
  if (message.length < MIN_MESSAGE_CHARS) return empty;
  if (!input.spaceId) return empty;

  const key = cacheKey(input.spaceId, message);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  const k = Math.max(1, Math.min(20, input.k ?? 5));
  const tokens = extractCandidateTokens(message);

  // Fan out — vector search + entity matches in parallel. Any single
  // failure is logged and swallowed; the others still contribute.
  const [memories, contacts, deals, properties] = await Promise.all([
    vectorMemorySearch(input.spaceId, message, k).catch((err) => {
      logger.warn('[vector-context] vector search threw', { spaceId: input.spaceId }, err);
      return [] as ContextMemory[];
    }),
    matchContactsByName(input.spaceId, tokens).catch((err) => {
      logger.warn('[vector-context] contact match threw', { spaceId: input.spaceId }, err);
      return [] as ContextEntity[];
    }),
    matchDealsByTitle(input.spaceId, tokens).catch((err) => {
      logger.warn('[vector-context] deal match threw', { spaceId: input.spaceId }, err);
      return [] as ContextEntity[];
    }),
    matchPropertiesByAddress(input.spaceId, tokens).catch((err) => {
      logger.warn('[vector-context] property match threw', { spaceId: input.spaceId }, err);
      return [] as ContextEntity[];
    }),
  ]);

  const result: RetrieveContextResult = {
    memories,
    contacts,
    deals,
    properties,
    block: '',
  };
  result.block = formatBlock(result);

  cache.set(key, { expiresAt: now + CACHE_TTL_MS, result });
  // Cache hygiene — drop entries past their TTL so the map can't grow
  // unbounded under unique-query traffic. Cheap full sweep; small map in
  // practice.
  if (cache.size > 1000) {
    for (const [k2, v] of cache.entries()) {
      if (v.expiresAt <= now) cache.delete(k2);
    }
  }
  return result;
}
