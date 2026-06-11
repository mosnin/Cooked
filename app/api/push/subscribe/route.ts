/**
 * Web push subscription registration — POST / DELETE
 *
 *   POST   { slug, subscription }  → { ok: true }   upsert a browser subscription
 *   DELETE { slug, endpoint }      → { ok: true }   remove a subscription
 *
 * `subscription` is the raw PushSubscription JSON the browser hands back from
 * pushManager.subscribe() — { endpoint, keys: { p256dh, auth } }. We pull only
 * those fields and store them keyed by the space.
 *
 * Auth: requireSpaceOwner(slug) — same posture as the rest of the realtor API.
 * endpoint is unique, so re-subscribing the same browser upserts in place.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

interface BrowserSubscription {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

// ── POST — upsert a subscription ─────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: { slug?: string; subscription?: BrowserSubscription };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = payload.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  const sub = payload.subscription;
  const endpoint = sub?.endpoint?.trim();
  const p256dh = sub?.keys?.p256dh?.trim();
  const authKey = sub?.keys?.auth?.trim();

  if (!endpoint || !p256dh || !authKey) {
    return NextResponse.json({ error: 'Invalid subscription.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('PushSubscription')
    .upsert(
      {
        spaceId: space.id,
        userId,
        endpoint,
        p256dh,
        auth: authKey,
        userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
        createdAt: now,
      },
      { onConflict: 'endpoint' },
    );

  if (error) {
    logger.error('[push/subscribe] upsert failed', { spaceId: space.id, err: error.message });
    return NextResponse.json({ error: 'Could not save subscription.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// ── DELETE — remove a subscription by endpoint ───────────────────────────────

export async function DELETE(req: NextRequest) {
  let payload: { slug?: string; endpoint?: string };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = payload.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const endpoint = payload.endpoint?.trim();
  if (!endpoint) return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });

  const { error } = await supabase
    .from('PushSubscription')
    .delete()
    .eq('spaceId', space.id)
    .eq('endpoint', endpoint);

  if (error) {
    logger.error('[push/subscribe] delete failed', { spaceId: space.id, err: error.message });
    return NextResponse.json({ error: 'Could not remove subscription.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
