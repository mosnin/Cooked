/**
 * Tests for Composio-backed e-signature gating + POST /api/esign/send validation.
 *
 * Two contracts:
 *
 *   1. lib/esign gates on the realtor's DocuSign CONNECTION (via Composio).
 *      When Composio isn't configured / DocuSign isn't connected,
 *      isDocusignConnected → false and sendForSignature → a structured
 *      { ok: false, reason: 'not_connected' } — never a throw, never a network
 *      envelope call.
 *
 *   2. POST /api/esign/send validates the body BEFORE any work: missing slug →
 *      400, missing document → 400, bad email → 400. And a well-formed request
 *      against an UNCONNECTED account returns 409 (clean), not a 500.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/api-auth', () => ({
  requireSpaceOwner: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}));

vi.mock('@/lib/storage', () => ({
  getSignedDownloadUrl: vi.fn(async () => 'https://signed.example/doc'),
  uploadObject: vi.fn(async () => ({ key: 'k' })),
  buildKey: (...segs: string[]) => segs.join('/'),
}));

// Composio: not configured → executeToolForEntity must never be reached on the
// gating path. listConnectedAccountsForEntity returns no DocuSign account.
const { composioConfiguredMock, listAccountsMock, executeMock } = vi.hoisted(() => ({
  composioConfiguredMock: vi.fn(() => false),
  listAccountsMock: vi.fn<(...args: unknown[]) => Promise<{ items: unknown[] }>>(
    async () => ({ items: [] }),
  ),
  executeMock: vi.fn(),
}));
vi.mock('@/lib/integrations/composio', () => ({
  composioConfigured: composioConfiguredMock,
  listConnectedAccountsForEntity: listAccountsMock,
  loadToolsForEntity: vi.fn(async () => []),
  executeToolForEntity: executeMock,
}));

import { requireSpaceOwner } from '@/lib/api-auth';
import { isDocusignConnected, sendForSignature } from '@/lib/esign';
import { POST } from '@/app/api/esign/send/route';

const mockedRequireSpaceOwner = vi.mocked(requireSpaceOwner);

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/esign/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  composioConfiguredMock.mockReturnValue(false);
  listAccountsMock.mockResolvedValue({ items: [] });
  mockedRequireSpaceOwner.mockResolvedValue({
    userId: 'user_1',
    space: { id: 'space_1', slug: 'jane', name: 'Jane', ownerId: 'user_1' },
  } as never);
});

// ── 1. lib gating ──────────────────────────────────────────────────────────────

describe('lib/esign gating', () => {
  it('isDocusignConnected is false when Composio is not configured', async () => {
    composioConfiguredMock.mockReturnValue(false);
    await expect(isDocusignConnected('user_1')).resolves.toBe(false);
    // Never even hit the list call.
    expect(listAccountsMock).not.toHaveBeenCalled();
  });

  it('isDocusignConnected is false when no active DocuSign account is connected', async () => {
    composioConfiguredMock.mockReturnValue(true);
    listAccountsMock.mockResolvedValue({
      items: [{ toolkit: { slug: 'gmail' }, status: 'ACTIVE' }],
    });
    await expect(isDocusignConnected('user_1')).resolves.toBe(false);
  });

  it('isDocusignConnected is true when an active DocuSign account exists', async () => {
    composioConfiguredMock.mockReturnValue(true);
    listAccountsMock.mockResolvedValue({
      items: [{ toolkit: { slug: 'docusign' }, status: 'ACTIVE' }],
    });
    await expect(isDocusignConnected('user_1')).resolves.toBe(true);
  });

  it('sendForSignature returns not_connected (no throw, no envelope call) when unconnected', async () => {
    composioConfiguredMock.mockReturnValue(false);
    const result = await sendForSignature({
      userId: 'user_1',
      spaceId: 'space_1',
      documentId: 'doc_1',
      signerEmail: 'buyer@example.com',
    });
    expect(result).toEqual({ ok: false, reason: 'not_connected' });
    expect(executeMock).not.toHaveBeenCalled();
  });
});

// ── 2. route validation ──────────────────────────────────────────────────────

describe('POST /api/esign/send validation', () => {
  it('400 when slug is missing', async () => {
    const res = await POST(makeReq({ documentId: 'doc_1', signerEmail: 'a@b.com' }));
    expect(res.status).toBe(400);
  });

  it('400 when documentId is missing', async () => {
    const res = await POST(makeReq({ slug: 'jane', signerEmail: 'a@b.com' }));
    expect(res.status).toBe(400);
  });

  it('400 when signer email is missing', async () => {
    const res = await POST(makeReq({ slug: 'jane', documentId: 'doc_1' }));
    expect(res.status).toBe(400);
  });

  it('400 when signer email is malformed', async () => {
    const res = await POST(
      makeReq({ slug: 'jane', documentId: 'doc_1', signerEmail: 'not-an-email' }),
    );
    expect(res.status).toBe(400);
  });

  it('409 not_connected (clean, not 500) for a well-formed request to an unconnected account', async () => {
    composioConfiguredMock.mockReturnValue(false);
    const res = await POST(
      makeReq({ slug: 'jane', documentId: 'doc_1', signerEmail: 'buyer@example.com' }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe('not_connected');
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('propagates the auth NextResponse when requireSpaceOwner rejects', async () => {
    mockedRequireSpaceOwner.mockResolvedValue(
      NextResponse.json({ error: 'no' }, { status: 403 }) as never,
    );
    const res = await POST(
      makeReq({ slug: 'jane', documentId: 'doc_1', signerEmail: 'buyer@example.com' }),
    );
    expect(res.status).toBe(403);
  });
});
