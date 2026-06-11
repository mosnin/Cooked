/**
 * POST   /api/profile-page/profile-photo — upload the public-page profile photo.
 * DELETE /api/profile-page/profile-photo — clear it.
 *
 * Distinct from /api/upload (which writes the dashboard's realtorPhotoUrl on
 * SpaceSetting). This one writes ProfilePage.profilePhotoUrl — a face the
 * realtor picks specifically for /p/[slug] without disturbing the photo their
 * dashboard chrome / intake form / booking page display. Stored private,
 * signed on read — same contract as the cover photo.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { uploadObject, buildKey, getSignedDownloadUrl, deleteObject } from '@/lib/storage';
import { validateUpload } from '@/lib/storage/limits';

export const runtime = 'nodejs';

const MAX_BYTES = 5 * 1024 * 1024;

function sanitizeFilename(name: string): string {
  const trimmed = (name || 'profile').split(/[\\/]/).pop() ?? 'profile';
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 80) || 'profile';
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { allowed } = await checkRateLimit(`profile-photo:${userId}`, 10, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many uploads' }, { status: 429 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No image provided.' }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Image must be 5 MB or smaller.' },
      { status: 400 },
    );
  }

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const validation = validateUpload({
    mimeType: file.type,
    sizeBytes: file.size,
    header,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }
  if (validation.category !== 'image') {
    return NextResponse.json(
      { error: 'Only images are allowed.' },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = sanitizeFilename(file.name);
  const key = buildKey(
    'profilePhoto',
    space.id,
    `${crypto.randomUUID()}-${filename}`,
  );

  try {
    await uploadObject({
      key,
      body: buffer,
      contentType: file.type,
      isPublic: false,
    });
  } catch (err) {
    logger.error(
      '[profile-photo] upload failed',
      { spaceId: space.id },
      err as Error,
    );
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  }

  // Capture the previous key before the upsert overwrites it — same
  // orphan-on-replace fix as cover-photo. DELETE intentionally keeps the
  // object for revert; POST is an explicit replacement signal.
  const { data: existing } = await supabase
    .from('ProfilePage')
    .select('profilePhotoUrl')
    .eq('spaceId', space.id)
    .maybeSingle();
  const previousKey = (existing as { profilePhotoUrl?: string | null } | null)?.profilePhotoUrl ?? null;

  const { error: dbErr } = await supabase
    .from('ProfilePage')
    .upsert(
      {
        spaceId: space.id,
        profilePhotoUrl: key,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'spaceId' },
    );

  if (previousKey && !/^https?:\/\//i.test(previousKey)) {
    void deleteObject(previousKey).catch((err) =>
      logger.warn('[profile-photo] previous object delete failed', {
        spaceId: space.id,
        keyPreview: previousKey.slice(0, 60),
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  if (dbErr) {
    logger.error(
      '[profile-photo] db write failed',
      { spaceId: space.id },
      dbErr,
    );
    return NextResponse.json({ error: 'Save failed.' }, { status: 500 });
  }

  let signedUrl: string | null = null;
  try {
    signedUrl = await getSignedDownloadUrl(key, 60 * 60 * 24);
  } catch (err) {
    logger.warn('[profile-photo] sign just-uploaded failed', {
      spaceId: space.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return NextResponse.json({ key, url: signedUrl });
}

export async function DELETE() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { error: dbErr } = await supabase
    .from('ProfilePage')
    .upsert(
      {
        spaceId: space.id,
        profilePhotoUrl: null,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'spaceId' },
    );

  if (dbErr) {
    logger.error(
      '[profile-photo] db clear failed',
      { spaceId: space.id },
      dbErr,
    );
    return NextResponse.json({ error: 'Could not remove photo.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
