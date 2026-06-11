/**
 * Tests for the Composio webhook receiver — the entry point that turns
 * a signed Composio delivery into an Inngest event.
 *
 * Behaviours locked in here:
 *   - Missing webhook-* headers → 400 (and no SDK call).
 *   - Missing COMPOSIO_WEBHOOK_SECRET → 500 (config error, not signature).
 *   - SDK verification throws (bad signature, stale ts) → 401.
 *   - Verified, first-seen, under-cap → Inngest send + 200.
 *   - Duplicate webhook-id → no Inngest send, 200 with deduped=true.
 *   - Hourly cap exceeded → no Inngest send, 200 with capped=true.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── verifyTriggerWebhook mock ─────────────────────────────────────────

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));
vi.mock('@/lib/integrations/composio', () => ({
  verifyTriggerWebhook: verifyMock,
}));

// ── inngest mock ──────────────────────────────────────────────────────

const { inngestSendMock } = vi.hoisted(() => ({
  inngestSendMock: vi.fn(async () => ({ ids: ['evt_1'] })),
}));
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendMock },
}));

// ── redis mock ────────────────────────────────────────────────────────
// The receiver uses three methods: set (with nx), incr, expire. We track
// each one so the dedupe-claim and rate-cap branches are testable.

const { redisSetMock, redisIncrMock, redisExpireMock, redisDelMock } = vi.hoisted(() => ({
  redisSetMock: vi.fn(),
  redisIncrMock: vi.fn(),
  redisExpireMock: vi.fn(async () => 1),
  redisDelMock: vi.fn(async () => 1),
}));
vi.mock('@/lib/redis', () => ({
  redis: {
    set: redisSetMock,
    incr: redisIncrMock,
    expire: redisExpireMock,
    del: redisDelMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/webhooks/composio/route';

function verifiedPayload() {
  return {
    version: 'V3' as const,
    rawPayload: { foo: 'bar' },
    payload: {
      id: 'msg_abc',
      uuid: 'uuid_abc',
      triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE',
      toolkitSlug: 'gmail',
      userId: 'user_clerk_1',
      payload: { subject: 'Hello' },
      metadata: {
        id: 'trg_xyz',
        uuid: 'trg_uuid',
        toolkitSlug: 'gmail',
        triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE',
        triggerConfig: {},
        connectedAccount: {
          id: 'ca_999',
          uuid: 'ca_uuid',
          authConfigId: 'ac_1',
          authConfigUUID: 'ac_uuid',
          userId: 'user_clerk_1',
          status: 'ACTIVE' as const,
        },
      },
    },
  };
}

function makeRequest(opts: { headers?: Record<string, string>; body?: string } = {}): NextRequest {
  const headers = new Headers(opts.headers ?? {
    'webhook-id': 'msg_abc',
    'webhook-timestamp': '1700000000',
    'webhook-signature': 'v1,abc',
  });
  return new NextRequest('https://example.com/api/webhooks/composio', {
    method: 'POST',
    headers,
    body: opts.body ?? JSON.stringify({ raw: 'body' }),
  });
}

beforeEach(() => {
  verifyMock.mockReset();
  inngestSendMock.mockReset();
  inngestSendMock.mockResolvedValue({ ids: ['evt_1'] });
  redisSetMock.mockReset();
  redisIncrMock.mockReset();
  redisExpireMock.mockReset();
  redisExpireMock.mockResolvedValue(1);
  redisDelMock.mockReset();
  redisDelMock.mockResolvedValue(1);
  process.env.COMPOSIO_WEBHOOK_SECRET = 'whsec_test';
});

describe('composio webhook receiver', () => {
  it('returns 500 when COMPOSIO_WEBHOOK_SECRET is missing', async () => {
    delete process.env.COMPOSIO_WEBHOOK_SECRET;
    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    expect(verifyMock).not.toHaveBeenCalled();
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it('returns 400 when webhook-* headers are missing', async () => {
    const res = await POST(makeRequest({ headers: { 'content-type': 'application/json' } }));
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('returns 401 when signature verification throws', async () => {
    verifyMock.mockRejectedValueOnce(new Error('Invalid signature'));
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it('returns 200 and fires Inngest on a fresh, verified, under-cap delivery', async () => {
    verifyMock.mockResolvedValueOnce(verifiedPayload());
    redisSetMock.mockResolvedValueOnce('OK'); // dedupe key claimed
    redisIncrMock.mockResolvedValueOnce(1); // first event in window

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(inngestSendMock).toHaveBeenCalledTimes(1);
    const sent = (inngestSendMock.mock.calls[0] as unknown as [{
      name: string;
      data: {
        triggerSlug: string;
        composioConnectionId: string;
        composioTriggerId: string;
      };
    }])[0];
    expect(sent.name).toBe('composio/trigger.received');
    expect(sent.data.triggerSlug).toBe('GMAIL_NEW_GMAIL_MESSAGE');
    expect(sent.data.composioConnectionId).toBe('ca_999');
    expect(sent.data.composioTriggerId).toBe('trg_xyz');
    // First event in window must also have set the TTL.
    expect(redisExpireMock).toHaveBeenCalled();
  });

  it('skips Inngest when redis.set NX returns null (duplicate delivery)', async () => {
    verifyMock.mockResolvedValueOnce(verifiedPayload());
    redisSetMock.mockResolvedValueOnce(null); // dedupe says "seen"

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(inngestSendMock).not.toHaveBeenCalled();
    expect(redisIncrMock).not.toHaveBeenCalled();
  });

  it('skips Inngest when the hourly cap is exceeded', async () => {
    verifyMock.mockResolvedValueOnce(verifiedPayload());
    redisSetMock.mockResolvedValueOnce('OK');
    redisIncrMock.mockResolvedValueOnce(61); // over the 60/hr cap

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it('returns 500 AND releases the dedupe key when Inngest send fails', async () => {
    verifyMock.mockResolvedValueOnce(verifiedPayload());
    redisSetMock.mockResolvedValueOnce('OK');
    redisIncrMock.mockResolvedValueOnce(1);
    inngestSendMock.mockRejectedValueOnce(new Error('inngest down'));

    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    // The dedupe key MUST be released so Composio's retry can re-claim
    // it — otherwise the event is silently lost. This is the bug-fix
    // contract being locked in.
    expect(redisDelMock).toHaveBeenCalledTimes(1);
    const [delKey] = redisDelMock.mock.calls[0] as unknown as [string];
    expect(delKey).toContain('msg_abc');
  });
});
