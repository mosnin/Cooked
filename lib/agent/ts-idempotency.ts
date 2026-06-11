// Idempotency guard for mutation tools (send SMS, send email, create deal).
//
// Why this exists: a serverless function can be retried, and the retry routinely
// lands on a DIFFERENT cold instance. A guard kept only in process memory is
// empty on that new instance, so the retry re-runs the side effect — the lead
// gets texted/emailed twice (and we get billed twice). Backing the guard with
// Redis makes "already done" visible across instances.
//
// Redis is the cross-instance store; the in-process Map is a fallback for
// environments without Redis (local dev, preview deploys) so behavior degrades
// to the old per-instance dedup instead of crashing.

import { redis } from '@/lib/redis';

export interface IdempotencyEntry {
  result: unknown;
  expiresAt: number;
}

const store = new Map<string, IdempotencyEntry>();
const TTL_MS = 5 * 60 * 1000;
const TTL_S = 5 * 60;

export function makeIdempotencyKey(toolName: string, spaceId: string, ...args: string[]): string {
  // Simple deterministic key — no crypto needed.
  return `${toolName}:${spaceId}:${args.join(':')}`;
}

export function checkIdempotency(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.result;
}

export function storeIdempotency(key: string, result: unknown): void {
  store.set(key, { result, expiresAt: Date.now() + TTL_MS });
}

/** Redis is only the source of truth when it's actually configured — otherwise
 *  the proxy no-ops every call (set→null), which would look like "claim failed"
 *  and wrongly suppress sends. Gate on the env so the absence path is explicit. */
function redisConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

type StoredEntry = { status: 'pending' | 'done'; result?: unknown };

function parseEntry(raw: unknown): StoredEntry | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as StoredEntry;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as StoredEntry;
    } catch {
      return null;
    }
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` at most once per `key`, even across serverless instances/retries.
 *
 * Redis path: atomically CLAIM the key (SET NX). The first caller owns it, runs
 * the side effect, and writes the result back. A later retry — the common case,
 * where the first attempt already finished — sees the cached result and returns
 * it WITHOUT re-running the side effect. A concurrent caller that finds the key
 * still "pending" waits briefly for the owner's result rather than firing a
 * duplicate. Only if the owner never records a result (it crashed) does a later
 * caller re-run, so a genuine failure isn't silently dropped forever.
 *
 * No-Redis path: the original in-process Map (per-instance dedup).
 */
export async function withIdempotency<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!redisConfigured()) return withMemoryIdempotency(key, fn);

  const rkey = `idem:${key}`;

  let claimed: unknown;
  try {
    claimed = await redis.set(rkey, { status: 'pending' }, { nx: true, ex: TTL_S });
  } catch {
    // Redis flaked — degrade to per-instance dedup rather than block the send.
    return withMemoryIdempotency(key, fn);
  }

  if (claimed) {
    // We won the claim: run the side effect once, then publish the result.
    const result = await fn();
    try {
      await redis.set(rkey, { status: 'done', result }, { ex: TTL_S });
    } catch {
      /* result cache is best-effort; the claim already prevented duplicates */
    }
    return result;
  }

  // Someone else owns the key. Return their result if ready, briefly wait if
  // they're still in flight, and only re-run if the claim turns out to be dead.
  for (let attempt = 0; attempt < 10; attempt++) {
    let parsed: StoredEntry | null;
    try {
      parsed = parseEntry(await redis.get(rkey));
    } catch {
      break; // can't read — fall through and just run it
    }
    if (parsed?.status === 'done') return parsed.result as T;
    if (parsed === null) break; // key expired/vanished — re-run
    await sleep(150); // still pending — give the owner a moment
  }

  // Owner never finished (crashed) — run it ourselves so the action isn't lost.
  const result = await fn();
  try {
    await redis.set(rkey, { status: 'done', result }, { ex: TTL_S });
  } catch {
    /* best-effort */
  }
  return result;
}

/** Per-instance fallback (original behavior) for when Redis isn't configured. */
async function withMemoryIdempotency<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Read the store directly rather than via checkIdempotency: that helper
  // returns null for BOTH "miss" and "cached a null result", so a tool that
  // legitimately resolves to null/undefined would re-execute on every retry.
  const entry = store.get(key);
  if (entry) {
    if (Date.now() <= entry.expiresAt) return entry.result as T;
    store.delete(key);
  }
  const result = await fn();
  storeIdempotency(key, result);
  return result;
}
