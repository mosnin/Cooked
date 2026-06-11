/**
 * DELETE /api/integrations/[id]   — disconnect (revoke).
 * PATCH  /api/integrations/[id]   — toggle the connection's triggers
 *                                   between paused and active.
 *
 * Both routes scope by the caller's space — id-guess across realtors
 * is rejected with 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { getById, revoke } from '@/lib/integrations/connections';
import { setPausedForConnection } from '@/lib/integrations/triggers';

async function resolveOwned(
  paramsP: Promise<{ id: string }>,
): Promise<{ ok: true; row: NonNullable<Awaited<ReturnType<typeof getById>>> } | { ok: false; res: NextResponse }> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return { ok: false, res: auth };
  const { userId } = auth;

  const { id } = await paramsP;
  const row = await getById(id);
  if (!row) return { ok: false, res: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  const space = await getSpaceForUser(userId);
  if (!space || row.spaceId !== space.id) {
    return { ok: false, res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, row };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveOwned(params);
  if (!resolved.ok) return resolved.res;
  await revoke(resolved.row);
  return NextResponse.json({ ok: true });
}

/**
 * Pauses or resumes every trigger subscription registered for this
 * connection. Per-connection granularity, not per-trigger — the
 * integrations panel intentionally shows ONE toggle per app.
 *
 * Body: { paused: boolean }. Returns { paused, updated } so the UI can
 * update without a re-fetch.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveOwned(params);
  if (!resolved.ok) return resolved.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as { paused?: unknown }).paused !== 'boolean'
  ) {
    return NextResponse.json({ error: "Body must be { paused: boolean }" }, { status: 400 });
  }
  const paused = (body as { paused: boolean }).paused;

  const result = await setPausedForConnection({ connectionId: resolved.row.id, paused });
  return NextResponse.json({ paused, updated: result.updated });
}
