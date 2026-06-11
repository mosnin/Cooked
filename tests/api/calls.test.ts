/**
 * Gating + validation tests for the phone/call layer.
 *
 *  - lib/twilio.ts: no env → isTwilioConfigured()/getTwilioConfig() report off
 *    and placeClickToCall no-ops with { ok:false, reason:'not_configured' },
 *    never making a network call.
 *  - validateTwilioSignature: accepts the documented X-Twilio-Signature scheme
 *    (HMAC-SHA1 over url + sorted POST params, base64) and rejects everything
 *    else.
 *  - POST /api/calls: body validation (bad slug, bad number) returns 4xx; and
 *    when voice is unconfigured the row is still logged and the response is a
 *    clean 200 with configured:false — never a 500.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';

// server-only is a no-op import in tests but must be stubbed so lib/twilio loads.
vi.mock('server-only', () => ({}));

// ── lib/twilio gating ───────────────────────────────────────────────────────

describe('lib/twilio gating', () => {
  const saved = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_PHONE_NUMBER,
  };

  beforeEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    vi.resetModules();
  });

  afterEach(() => {
    if (saved.sid) process.env.TWILIO_ACCOUNT_SID = saved.sid;
    if (saved.token) process.env.TWILIO_AUTH_TOKEN = saved.token;
    if (saved.from) process.env.TWILIO_PHONE_NUMBER = saved.from;
    vi.restoreAllMocks();
  });

  it('reports not configured when env is missing', async () => {
    const twilio = await import('@/lib/twilio');
    expect(twilio.isTwilioConfigured()).toBe(false);
    expect(twilio.getTwilioConfig()).toBeNull();
  });

  it('placeClickToCall no-ops without a network call when unconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const twilio = await import('@/lib/twilio');
    const result = await twilio.placeClickToCall({
      spaceId: 'space_1',
      contactId: null,
      agentNumber: '+15551234567',
      contactNumber: '+15557654321',
    });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports configured when all three env vars are present', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'AC123';
    process.env.TWILIO_AUTH_TOKEN = 'TOKEN';
    process.env.TWILIO_PHONE_NUMBER = '+15550000000';
    vi.resetModules();
    const twilio = await import('@/lib/twilio');
    expect(twilio.isTwilioConfigured()).toBe(true);
    expect(twilio.getTwilioConfig()).toEqual({
      accountSid: 'AC123',
      authToken: 'TOKEN',
      fromNumber: '+15550000000',
    });
  });

  it('toE164 normalizes and rejects junk', async () => {
    const twilio = await import('@/lib/twilio');
    expect(twilio.toE164('(555) 123-4567')).toBe('+15551234567');
    expect(twilio.toE164('+447911123456')).toBe('+447911123456');
    expect(twilio.toE164('123')).toBeNull();
    expect(twilio.toE164(null)).toBeNull();
  });

  it('validateTwilioSignature accepts the documented scheme and rejects forgeries', async () => {
    const twilio = await import('@/lib/twilio');
    const url = 'https://example.com/api/webhooks/twilio-voice?spaceId=s1';
    const params = { CallSid: 'CA1', CallStatus: 'completed', To: '+15557654321' };
    const authToken = 'TOKEN';

    // X-Twilio-Signature: HMAC-SHA1(url + concat(sorted key+value), token), base64.
    let data = url;
    for (const key of Object.keys(params).sort()) {
      data += key + params[key as keyof typeof params];
    }
    const good = createHmac('sha1', authToken).update(data).digest('base64');

    expect(twilio.validateTwilioSignature(url, params, good, authToken)).toBe(true);
    expect(twilio.validateTwilioSignature(url, params, 'bogus', authToken)).toBe(false);
    expect(twilio.validateTwilioSignature(url, params, null, authToken)).toBe(false);
    expect(
      twilio.validateTwilioSignature(url, { ...params, CallStatus: 'failed' }, good, authToken),
    ).toBe(false);
  });
});

// ── POST /api/calls validation + gated no-op ────────────────────────────────

vi.mock('@/lib/api-auth', () => ({
  requireSpaceOwner: vi.fn(),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

// In-memory Supabase stub: insert returns a fake row; update is a no-op.
const insertedRow = {
  id: 'call_1',
  spaceId: 'space_1',
  contactId: null,
  direction: 'outbound',
  fromNumber: 'unknown',
  toNumber: '+15557654321',
  twilioCallSid: null,
  status: 'initiated',
  recordingUrl: null,
  recordingSid: null,
  transcript: null,
  transcriptStatus: null,
  summary: null,
  durationSec: null,
  createdAt: '2026-06-02T00:00:00.000Z',
  updatedAt: '2026-06-02T00:00:00.000Z',
};
vi.mock('@/lib/supabase', () => {
  const builder: any = {
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: [], error: null })),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    single: vi.fn(async () => ({ data: insertedRow, error: null })),
  };
  return { supabase: { from: vi.fn(() => builder) } };
});

import { POST } from '@/app/api/calls/route';
import { requireSpaceOwner } from '@/lib/api-auth';

const mockRequireSpaceOwner = vi.mocked(requireSpaceOwner);

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const fakeSpace = { id: 'space_1', phoneNumber: null } as any;

describe('POST /api/calls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TWILIO_AGENT_NUMBER;
  });

  it('returns 400 when slug is missing', async () => {
    const res = await POST(makeReq({ toNumber: '+15557654321' }));
    expect(res.status).toBe(400);
  });

  it('returns the auth response when unauthorized', async () => {
    mockRequireSpaceOwner.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    );
    const res = await POST(makeReq({ slug: 'acme', toNumber: '+15557654321' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid phone number', async () => {
    mockRequireSpaceOwner.mockResolvedValue({ userId: 'u1', space: fakeSpace });
    const res = await POST(makeReq({ slug: 'acme', toNumber: '123' }));
    expect(res.status).toBe(400);
  });

  it('logs the call and returns 200 configured:false when voice is unconfigured', async () => {
    mockRequireSpaceOwner.mockResolvedValue({ userId: 'u1', space: fakeSpace });
    const res = await POST(makeReq({ slug: 'acme', toNumber: '+15557654321' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { configured: boolean; call: { status: string } };
    expect(json.configured).toBe(false);
    expect(json.call.status).toBe('failed');
  });
});
