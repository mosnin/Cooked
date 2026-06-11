/**
 * Route-level test for `PATCH /api/integrations/[id]`.
 *
 * Same privilege contract as DELETE: a user must not be able to flip
 * another realtor's trigger subscriptions via id-guess. Adds a body-
 * validation gate (rejects anything that isn't `{ paused: boolean }`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/api-auth', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/space', () => ({
  getSpaceForUser: vi.fn(),
}));

const { getByIdMock } = vi.hoisted(() => ({ getByIdMock: vi.fn() }));
vi.mock('@/lib/integrations/connections', () => ({
  getById: getByIdMock,
  revoke: vi.fn(),
}));

const { setPausedMock } = vi.hoisted(() => ({ setPausedMock: vi.fn() }));
vi.mock('@/lib/integrations/triggers', () => ({
  setPausedForConnection: setPausedMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { PATCH } from '@/app/api/integrations/[id]/route';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

const mockRequireAuth = vi.mocked(requireAuth);
const mockGetSpaceForUser = vi.mocked(getSpaceForUser);

const SPACE = {
  id: 'space_1',
  slug: 'jane',
  ownerId: 'user_db_1',
  stripeSubscriptionStatus: 'active',
} as unknown as NonNullable<Awaited<ReturnType<typeof getSpaceForUser>>>;

function makeReq(id: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/integrations/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ id }) }] as const;
}

function fakeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'conn_1',
    spaceId: 'space_1',
    userId: 'user_1',
    toolkit: 'gmail',
    composioConnectionId: 'composio_abc',
    status: 'active' as const,
    label: null,
    lastError: null,
    lastUsedAt: null,
    createdAt: '2026-04-30T12:00:00.000Z',
    updatedAt: '2026-04-30T12:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ userId: 'user_1' });
  mockGetSpaceForUser.mockResolvedValue(SPACE);
  getByIdMock.mockResolvedValue(fakeRow());
  setPausedMock.mockResolvedValue({ updated: 2 });
});

describe('PATCH /api/integrations/[id]', () => {
  it('401 when unauthenticated and never touches the triggers layer', async () => {
    const unauth = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    mockRequireAuth.mockResolvedValue(unauth);
    const [req, ctx] = makeReq('conn_1', { paused: true });
    const res = await PATCH(req, ctx);
    expect(res).toBe(unauth);
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it('404 when the row does not exist', async () => {
    getByIdMock.mockResolvedValue(null);
    const [req, ctx] = makeReq('missing', { paused: true });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(404);
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it('403 when the row belongs to another space (id-guess privilege boundary)', async () => {
    getByIdMock.mockResolvedValue(fakeRow({ spaceId: 'other_space' }));
    const [req, ctx] = makeReq('conn_1', { paused: true });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(403);
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it('400 on invalid JSON body', async () => {
    const [req, ctx] = makeReq('conn_1', 'not-json{');
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it('400 when body is missing the paused boolean', async () => {
    const [req, ctx] = makeReq('conn_1', { paused: 'yes' });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
    expect(setPausedMock).not.toHaveBeenCalled();
  });

  it('happy path: forwards paused=true to setPausedForConnection', async () => {
    const [req, ctx] = makeReq('conn_99', { paused: true });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ paused: true, updated: 2 });
    expect(setPausedMock).toHaveBeenCalledWith({
      connectionId: 'conn_1',
      paused: true,
    });
  });

  it('happy path: forwards paused=false to setPausedForConnection', async () => {
    setPausedMock.mockResolvedValue({ updated: 1 });
    const [req, ctx] = makeReq('conn_1', { paused: false });
    const res = await PATCH(req, ctx);
    const body = await res.json();
    expect(body).toEqual({ paused: false, updated: 1 });
  });
});
