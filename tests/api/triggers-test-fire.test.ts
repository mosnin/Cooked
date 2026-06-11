/**
 * Smoke test for POST /api/admin/triggers/test-fire.
 *
 * The route's job is to synthesise a signed Composio webhook
 * delivery and POST it to our own receiver. These tests cover the
 * input-validation gates; the actual receiver round-trip is mocked
 * (we just verify the fetch was called with valid-looking headers).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getByIdMock, listTriggersMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  listTriggersMock: vi.fn(),
}));
vi.mock('@/lib/integrations/connections', () => ({
  getById: getByIdMock,
}));
vi.mock('@/lib/integrations/triggers', () => ({
  listTriggersForConnection: listTriggersMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
// Caller is treated as a non-admin so these tests exercise the CRON_SECRET path.
vi.mock('@/lib/permissions', () => ({
  isPlatformAdmin: vi.fn().mockResolvedValue(false),
}));

// Stub global fetch so the route's POST to its own receiver doesn't
// actually leave the test runtime.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { POST } from '@/app/api/admin/triggers/test-fire/route';

function makeReq(opts: { auth?: string; body?: unknown } = {}) {
  return new NextRequest('http://localhost/api/admin/triggers/test-fire', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.auth ? { Authorization: opts.auth } : {}),
    },
    body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  process.env.COMPOSIO_WEBHOOK_SECRET = 'whsec_test';
  getByIdMock.mockResolvedValue({
    id: 'conn-1',
    spaceId: 'space-1',
    userId: 'user-1',
    toolkit: 'gmail',
    composioConnectionId: 'ca-1',
    status: 'active',
  });
  listTriggersMock.mockResolvedValue([
    { id: 'trg-1', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE', composioTriggerId: 'ctrg-1', status: 'active' },
  ]);
  fetchMock.mockResolvedValue({
    status: 200,
    json: async () => ({ received: true }),
  });
});

describe('POST /api/admin/triggers/test-fire', () => {
  it('500 when CRON_SECRET missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(makeReq({ body: { connectionId: 'c', triggerSlug: 's' } }));
    expect(res.status).toBe(500);
  });

  it('401 on wrong bearer', async () => {
    const res = await POST(makeReq({ auth: 'Bearer wrong', body: { connectionId: 'c', triggerSlug: 's' } }));
    expect(res.status).toBe(401);
  });

  it('500 when COMPOSIO_WEBHOOK_SECRET missing (receiver would reject the synthetic delivery)', async () => {
    delete process.env.COMPOSIO_WEBHOOK_SECRET;
    const res = await POST(makeReq({ auth: 'Bearer test-secret', body: { connectionId: 'c', triggerSlug: 's' } }));
    expect(res.status).toBe(500);
  });

  it('400 on invalid JSON body', async () => {
    const res = await POST(makeReq({ auth: 'Bearer test-secret', body: 'not-json{' }));
    expect(res.status).toBe(400);
  });

  it('400 when body is missing required fields', async () => {
    const res = await POST(makeReq({ auth: 'Bearer test-secret', body: { connectionId: 'c' } }));
    expect(res.status).toBe(400);
  });

  it('404 when the connection does not exist', async () => {
    getByIdMock.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ auth: 'Bearer test-secret', body: { connectionId: 'nope', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE' } }));
    expect(res.status).toBe(404);
  });

  it('404 when the trigger slug is not registered for this connection', async () => {
    listTriggersMock.mockResolvedValueOnce([
      { id: 'trg-other', triggerSlug: 'OTHER_SLUG', composioTriggerId: 'ctrg-other', status: 'active' },
    ]);
    const res = await POST(makeReq({ auth: 'Bearer test-secret', body: { connectionId: 'conn-1', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE' } }));
    expect(res.status).toBe(404);
  });

  it('409 when the trigger row exists but has no composioTriggerId (failed registration)', async () => {
    listTriggersMock.mockResolvedValueOnce([
      { id: 'trg-1', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE', composioTriggerId: null, status: 'failed' },
    ]);
    const res = await POST(makeReq({ auth: 'Bearer test-secret', body: { connectionId: 'conn-1', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE' } }));
    expect(res.status).toBe(409);
  });

  it('happy path: posts a signed delivery to the receiver and returns the receiver status', async () => {
    const res = await POST(makeReq({
      auth: 'Bearer test-secret',
      body: { connectionId: 'conn-1', triggerSlug: 'GMAIL_NEW_GMAIL_MESSAGE', payload: { subject: 'Hi' } },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.receiverStatus).toBe(200);
    expect(body.deliveryId).toMatch(/^msg_test_/);

    // The fetch hit our receiver with all three webhook headers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain('/api/webhooks/composio');
    expect(init.headers['webhook-id']).toBeTruthy();
    expect(init.headers['webhook-timestamp']).toBeTruthy();
    expect(init.headers['webhook-signature']).toMatch(/^v1,/);
  });
});
