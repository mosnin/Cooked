import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Fake Redis implementing just SET (with nx/ex) and GET over a Map, faithfully:
// SET NX returns 'OK' only when the key is absent, else null — exactly the
// atomic claim the guard relies on.
const { fakeStore, setMock, getMock } = vi.hoisted(() => {
  const fakeStore = new Map<string, unknown>();
  const setMock = vi.fn(async (key: string, value: unknown, opts?: { nx?: boolean }) => {
    if (opts?.nx && fakeStore.has(key)) return null;
    fakeStore.set(key, value);
    return 'OK';
  });
  const getMock = vi.fn(async (key: string) => (fakeStore.has(key) ? fakeStore.get(key) : null));
  return { fakeStore, setMock, getMock };
});

vi.mock('@/lib/redis', () => ({ redis: { set: setMock, get: getMock } }));

import { withIdempotency } from '@/lib/agent/ts-idempotency';

describe('withIdempotency — cross-instance double-send guard', () => {
  beforeEach(() => {
    fakeStore.clear();
    setMock.mockClear();
    getMock.mockClear();
    process.env.KV_REST_API_URL = 'https://kv.example';
    process.env.KV_REST_API_TOKEN = 'token';
  });
  afterEach(() => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  it('runs the side effect once, then a retry returns the cached result WITHOUT re-running', async () => {
    const send = vi.fn(async () => true);
    // First attempt (instance A): actually sends.
    const first = await withIdempotency('send_sms:space1:+15550100:hi', send);
    expect(first).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    // Retry (instance B, fresh memory — but same Redis): must NOT send again.
    const second = await withIdempotency('send_sms:space1:+15550100:hi', send);
    expect(second).toBe(true);
    expect(send).toHaveBeenCalledTimes(1); // still once — no double-send
  });

  it('caches a falsy result (a failed send) so a retry does not re-fire it', async () => {
    const send = vi.fn(async () => false); // provider rejected
    expect(await withIdempotency('send_sms:s:p:b', send)).toBe(false);
    expect(await withIdempotency('send_sms:s:p:b', send)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('different keys are independent (distinct recipients each send)', async () => {
    const send = vi.fn(async () => true);
    await withIdempotency('send_sms:s:+15550100:hi', send);
    await withIdempotency('send_sms:s:+15550199:hi', send);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('concurrent duplicates only send once (the second waits for the first)', async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return true;
    });
    const key = 'send_email:s:lead@x.com:Subject';
    const [a, b] = await Promise.all([
      withIdempotency(key, send),
      withIdempotency(key, send),
    ]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(calls).toBe(1); // the loser waited and reused the winner's result
  });

  it('falls back to in-process dedup when Redis is not configured', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const send = vi.fn(async () => true);
    await withIdempotency('send_sms:s:p:b2', send);
    await withIdempotency('send_sms:s:p:b2', send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(setMock).not.toHaveBeenCalled(); // never touched Redis
  });
});
