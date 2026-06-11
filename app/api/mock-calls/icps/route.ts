/**
 * ICPs — the Ideal Customer Profiles a space practices against.
 *
 *   GET    ?slug=<slug>                                   → { icps }  space ICPs + seeded defaults
 *   POST   { slug, name, description?, persona }          → { icp }   create a space ICP
 *   PATCH  { slug, id, name, description?, persona }      → { icp }   edit a space ICP
 *   DELETE { slug, id }                                   → { success } remove a space ICP
 *
 * Auth: requireSpaceOwner(slug). Reads include the three global defaults
 * (spaceId NULL); writes only ever touch the space's own, non-default ICPs —
 * the CRUD helpers scope every mutation to (spaceId, isDefault=false), so the
 * shared starter profiles can't be edited or deleted through this route. The
 * persona JSONB is normalized server-side (lib/mock-calls/icp.ts) — the body is
 * never trusted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  listIcps,
  createIcp,
  updateIcp,
  deleteIcp,
  validateIcpInput,
} from '@/lib/mock-calls/icp';

export const runtime = 'nodejs';

// ── GET — space ICPs + global defaults ───────────────────────────────────────

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  try {
    const icps = await listIcps(supabase, space.id);
    return NextResponse.json({ icps });
  } catch (err) {
    logger.error('[mock-calls/icps] list failed', {
      spaceId: space.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not load your customer profiles.' }, { status: 500 });
  }
}

// ── POST — create a space ICP ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  const valid = validateIcpInput(payload);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  try {
    const icp = await createIcp(supabase, {
      spaceId: space.id,
      createdBy: userId,
      name: valid.value.name,
      description: valid.value.description,
      persona: valid.value.persona,
    });
    return NextResponse.json({ icp }, { status: 201 });
  } catch (err) {
    // A duplicate name trips the partial unique index (spaceId, name).
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(message)) {
      return NextResponse.json(
        { error: 'You already have a profile with that name.' },
        { status: 409 },
      );
    }
    logger.error('[mock-calls/icps] create failed', { spaceId: space.id, err: message });
    return NextResponse.json({ error: 'Could not save the profile.' }, { status: 500 });
  }
}

// ── PATCH — edit a space ICP ─────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = typeof payload.slug === 'string' ? payload.slug.trim() : '';
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const valid = validateIcpInput(payload);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  try {
    const icp = await updateIcp(supabase, {
      spaceId: space.id,
      icpId: id,
      name: valid.value.name,
      description: valid.value.description,
      persona: valid.value.persona,
    });
    // Null = not found, another space's, or a read-only default.
    if (!icp) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    return NextResponse.json({ icp });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(message)) {
      return NextResponse.json(
        { error: 'You already have a profile with that name.' },
        { status: 409 },
      );
    }
    logger.error('[mock-calls/icps] update failed', { spaceId: space.id, id, err: message });
    return NextResponse.json({ error: 'Could not save the profile.' }, { status: 500 });
  }
}

// ── DELETE — remove a space ICP ──────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  // Accept the id from the body (mirrors PATCH) or the query string.
  let id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
  let slug = req.nextUrl.searchParams.get('slug')?.trim() ?? '';
  if (!id || !slug) {
    try {
      const body = (await req.json()) as { slug?: string; id?: string };
      slug = slug || (typeof body.slug === 'string' ? body.slug.trim() : '');
      id = id || (typeof body.id === 'string' ? body.id.trim() : '');
    } catch {
      // body optional when query params are present
    }
  }
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  try {
    const removed = await deleteIcp(supabase, space.id, id);
    if (!removed) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('[mock-calls/icps] delete failed', {
      spaceId: space.id,
      id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Could not delete the profile.' }, { status: 500 });
  }
}
