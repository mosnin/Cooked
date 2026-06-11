import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

function createRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // Don't log on every call — only first time
    return null;
  }
  return new Redis({ url, token });
}

/**
 * Per-method no-op return value, picked so a caller using the result in
 * the natural way doesn't crash when env vars are missing (local dev,
 * preview deploys without Upstash configured).
 *
 *   list/zset reads → []   safe for `for (const x of result)`
 *   counters        → 0    safe for arithmetic + `count <= max`
 *   anything else   → null caller treats null as "no row touched"
 *
 * Add a method here when a caller starts depending on a specific empty
 * shape. Unlisted methods fall through to `null` — same contract as
 * "Redis didn't have it" — so a new caller becomes a graceful no-op
 * rather than crashing on `undefined.<anything>`.
 */
const NOOP_RETURNS: Record<string, unknown> = {
  lrange: [],
  zrange: [],
  zrangebyscore: [],
  mget: [],
  incr: 0,
  decr: 0,
  zcard: 0,
  llen: 0,
};

/**
 * Lazy Redis singleton. Returns a no-op proxy if env vars are missing,
 * so callers never crash from a missing Redis connection.
 *
 * Prefer this over `new Redis({ url, token })` at route module load —
 * the direct construction throws at import time on missing env, which
 * breaks local dev and preview deploys without Upstash. Going through
 * the singleton means a missing-Redis environment becomes "everything
 * looks empty / unrate-limited" instead of bricking the whole route.
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    if (!_redis) {
      _redis = createRedis();
    }
    if (!_redis) {
      if (typeof prop === 'string') {
        const defaultValue = prop in NOOP_RETURNS ? NOOP_RETURNS[prop] : null;
        return async (..._args: unknown[]) => defaultValue;
      }
      return undefined;
    }
    const value = (_redis as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (value as (...args: unknown[]) => unknown).bind(_redis);
    }
    return value;
  },
});
