/**
 * POST   /api/profile-page/cover-photo — upload the realtor's public-page cover photo.
 * DELETE /api/profile-page/cover-photo — clear it.
 *
 * Image-only, ≤ 5 MB. Stored public-read in Wasabi under
 * `profile-cover/{spaceId}/{uuid}-{filename}`, then the URL is written to
 * `ProfilePage.coverPhotoUrl` for the public /p/[slug] page to render.
 * Auth follows the same shape as /api/profile-page: Clerk userId → space.
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

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB cap for cover photos — stricter than the
                                   // general 10 MB image cap so the hero loads fast
                                   // on a phone over LTE.

/** Strip path separators + control chars; preserve a friendly extension. */
function sanitizeFilename(name: string): string {
  const trimmed = (name || 'cover').split(/[\\/]/).pop() ?? 'cover';
  // Keep alnum, dot, dash, underscore. Collapse the rest to single dashes.
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  // Cap length so the S3 key stays sensible.
  return cleaned.slice(0, 80) || 'cover';
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { allowed } = await checkRateLimit(`profile-cover:${userId}`, 10, 60);
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

  // Hard size cap BEFORE buffering the body — keeps a 1 GB upload from
  // chewing up server memory just to be rejected.
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Image must be 5 MB or smaller.' },
      { status: 400 },
    );
  }

  // validateUpload checks the MIME whitelist + magic bytes — same gate the
  // studio and chat-attachment routes use. Then narrow to image-only.
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
    'profileCover',
    space.id,
    `${crypto.randomUUID()}-${filename}`,
  );

  try {
    await uploadObject({
      key,
      body: buffer,
      contentType: file.type,
      // Stored as private — the public page server-renders a fresh signed
      // URL on each visit (revalidate=60s makes the round trip cheap, and
      // signed URLs work regardless of whether the bucket policy allows
      // anonymous reads). The earlier `isPublic: true` + getPublicUrl()
      // path produced a static URL that 403'd because the Wasabi bucket
      // isn't configured for anonymous reads on this account.
      isPublic: false,
    });
  } catch (err) {
    logger.error(
      '[profile-cover] upload failed',
      { spaceId: space.id },
      err as Error,
    );
    return NextResponse.json({ error: 'Upload failed.' }, { status: 500 });
  }

  // Capture the previous storage key BEFORE the upsert overwrites it.
  // The DELETE handler intentionally keeps the object so the realtor can
  // revert; replacement is the explicit "I'm done with that photo"
  // signal, so we clean up. Without this, every cover-photo change
  // leaked the prior object into permanent storage with no DB pointer.
  const { data: existing } = await supabase
    .from('ProfilePage')
    .select('coverPhotoUrl')
    .eq('spaceId', space.id)
    .maybeSingle();
  const previousKey = (existing as { coverPhotoUrl?: string | null } | null)?.coverPhotoUrl ?? null;

  // Store the STORAGE KEY (not a URL) in coverPhotoUrl. The public page
  // signs a fresh download URL on each render. The column name keeps its
  // historical shape — what changes is the value contract: keys that don't
  // start with `http` are signed on read; any legacy `http(s)://...` value
  // is rendered verbatim.
  const { error: dbErr } = await supabase
    .from('ProfilePage')
    .upsert(
      {
        spaceId: space.id,
        coverPhotoUrl: key,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'spaceId' },
    );

  if (dbErr) {
    logger.error(
      '[profile-cover] db write failed',
      { spaceId: space.id },
      dbErr,
    );
    return NextResponse.json({ error: 'Save failed.' }, { status: 500 });
  }

  // Fire-and-forget the previous object's deletion. Legacy http(s)://
  // values aren't storage keys we own — skip those. The storage-gc cron
  // will still catch any object that slipped past this inline path.
  if (previousKey && !/^https?:\/\//i.test(previousKey)) {
    void deleteObject(previousKey).catch((err) =>
      logger.warn('[profile-cover] previous object delete failed', {
        spaceId: space.id,
        keyPreview: previousKey.slice(0, 60),
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  // Return a fresh signed URL alongside the key — the settings UI shows
  // the preview immediately without needing a separate fetch. The KEY is
  // the durable storage value (lives in coverPhotoUrl column); the URL is
  // a 24h presigned read.
  let signedUrl: string | null = null;
  try {
    signedUrl = await getSignedDownloadUrl(key, 60 * 60 * 24);
  } catch (err) {
    logger.warn('[profile-cover] sign just-uploaded failed', {
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

  // We don't delete the underlying object — the realtor may want to revert,
  // and the row is the source of truth for what's "live." Lifecycle cleanup
  // for orphaned cover images is a separate concern (Wasabi lifecycle rule).
  const { error: dbErr } = await supabase
    .from('ProfilePage')
    .upsert(
      {
        spaceId: space.id,
        coverPhotoUrl: null,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: 'spaceId' },
    );

  if (dbErr) {
    logger.error(
      '[profile-cover] db clear failed',
      { spaceId: space.id },
      dbErr,
    );
    return NextResponse.json({ error: 'Could not remove cover.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
