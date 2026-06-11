/**
 * Gating + validation tests for the phone/call layer.
 *
 *  - lib/voice.ts: no env → isVoiceConfigured()/getVoiceConfig() report off and
 *    placeClickToCall no-ops with { ok:false, reason:'not_configured' }, never
 *    making a network call.
 *  - POST /api/calls: body validation (bad slug, bad number) returns 4xx; and
 *    when voice is unconfigured the row is still logged and the response is a
 *    clean 200 with configured:false — never a 500.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── lib/voice gating ────────────────────────────────────────────────────────

describe('lib/voice gating', () => {
  const saved = {
    key: process.env.TELNYX_API_KEY,
    conn: process.env.TELNYX_VOICE_CONNECTION_ID,
    from: process.env.TELNYX_FROM_NUMBER,
  };

  beforeEach(() => {
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_VOICE_CONNECTION_ID;
    delete process.env.TELNYX_FROM_NUMBER;
    vi.resetModules();
  });

  afterEach(() => {
    if (saved.key) process.env.TELNYX_API_KEY = saved.key;
    if (saved.conn) process.env.TELNYX_VOICE_CONNECTION_ID = saved.conn;
    if (saved.from) process.env.TELNYX_FROM_NUMBER = saved.from;
    vi.restoreAllMocks();
  });

  it('reports not configured when env is missing', async () => {
    const voice = await import('@/lib/voice');
    expect(voice.isVoiceConfigured()).toBe(false);
    expect(voice.getVoiceConfig()).toBeNull();
  });

  it('placeClickToCall no-ops without a network call when unconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const voice = await import('@/lib/voice');
    const result = await voice.placeClickToCall({
      spaceId: 'space_1',
      contactId: null,
      agentNumber: '+15551234567',
      contactNumber: '+15557654321',
    });
    expect(result).toEqual({ ok: false, reason: 'not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports configured when all three env vars are present', async () => {
    process.env.TELNYX_API_KEY = 'KEY';
    process.env.TELNYX_VOICE_CONNECTION_ID = 'CONN';
    process.env.TELNYX_FROM_NUMBER = '+15550000000';
    vi.resetModules();
    const voice = await import('@/lib/voice');
    expect(voice.isVoiceConfigured()).toBe(true);
    expect(voice.getVoiceConfig()).toEqual({
      apiKey: 'KEY',
      connectionId: 'CONN',
      fromNumber: '+15550000000',
    });
  });

  it('toE164 normalizes and rejects junk', async () => {
    const voice = await import('@/lib/voice');
    expect(voice.toE164('(555) 123-4567')).toBe('+15551234567');
    expect(voice.toE164('+447911123456')).toBe('+447911123456');
    expect(voice.toE164('123')).toBeNull();
    expect(voice.toE164(null)).toBeNull();
  });

  it('client_state round-trips through base64', async () => {
    const voice = await import('@/lib/voice');
    const encoded = voice.encodeClientState({ bridgeTo: '+15551112222', spaceId: 's1', contactId: 'c1' });
    expect(voice.decodeClientState(encoded)).toEqual({
      bridgeTo: '+15551112222',
      spaceId: 's1',
      contactId: 'c1',
    });
    expect(voice.decodeClientState(null)).toEqual({});
    expect(voice.decodeClientState('not-base64-json!!!')).toEqual({});
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
  telnyxCallId: null,
  status: 'initiated',
  recordingUrl: null,
  transcript: null,
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
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_VOICE_CONNECTION_ID;
    delete process.env.TELNYX_FROM_NUMBER;
    delete process.env.TELNYX_AGENT_NUMBER;
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
