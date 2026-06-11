import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { getSpaceForUser } from '@/lib/space';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { isValidDocumentKind, defaultDocumentKind } from '@/lib/deals/documents';
import { uploadObject, deleteObject, buildKey } from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — closing disclosures with embedded exhibits can be large.

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

async function resolveDealAndSpace(userId: string, dealId: string) {
  const space = await getSpaceForUser(userId);
  if (!space) return null;
  const { data: deal } = await supabase
    .from('Deal')
    .select('id')
    .eq('id', dealId)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (!deal) return null;
  return space;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { id } = await params;
  const space = await resolveDealAndSpace(userId, id);
  if (!space) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('DealDocument')
    .select('*')
    .eq('dealId', id)
    .order('createdAt', { ascending: false });

  if (error) {
    logger.error('[deals/docs] list failed', { dealId: id }, error);
    return NextResponse.json({ error: 'Failed to list documents' }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  // Uploads are I/O-heavy and user-uploaded — rate limit at the user level.
  const { allowed } = await checkRateLimit(`deal-doc-upload:${userId}`, 10, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many uploads' }, { status: 429 });

  const { id } = await params;
  const space = await resolveDealAndSpace(userId, id);
  if (!space) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Two POST shapes share this route:
  //   - multipart/form-data → new upload (the original path)
  //   - application/json    → attach existing File rows by id, no re-upload
  // The attach path lets the realtor pull from the Files library on the
  // documents tab without copying bytes. The DealDocument row's storagePath
  // points at the existing File's storageKey; on delete we skip the storage
  // unlink because the File row still owns those bytes.
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return handleAttachFromFiles(req, id, space.id, userId);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  const kind = formData.get('kind');
  const labelRaw = formData.get('label');

  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (!isValidDocumentKind(kind)) return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File must be under 25MB' }, { status: 413 });
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type. Allowed: PDF, image, Word.' }, { status: 400 });
  }

  const label = typeof labelRaw === 'string' && labelRaw.trim()
    ? labelRaw.trim().slice(0, 200)
    : file.name.slice(0, 200);

  // Storage path: deal-documents/spaceId/dealId/<uuid>-<safeName>. The
  // dealDocuments prefix groups files with their peers; spaceId scoping
  // makes "purge on space deletion" a single key-prefix delete.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const storagePath = buildKey(
    'dealDocuments',
    space.id,
    id,
    `${crypto.randomUUID()}-${safeName}`,
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await uploadObject({
      key: storagePath,
      body: buffer,
      contentType: file.type,
      isPublic: false,
    });
  } catch (uploadError) {
    logger.error('[deals/docs] upload failed', { dealId: id }, uploadError as Error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }

  const { data: inserted, error: insertError } = await supabase
    .from('DealDocument')
    .insert({
      id: crypto.randomUUID(),
      dealId: id,
      spaceId: space.id,
      kind,
      label,
      storagePath,
      contentType: file.type,
      sizeBytes: file.size,
      uploadedById: userId,
    })
    .select()
    .single();

  if (insertError) {
    // Best-effort rollback — delete the uploaded object so we don't leak it.
    await deleteObject(storagePath).catch(() => undefined);
    logger.error('[deals/docs] insert failed', { dealId: id }, insertError);
    return NextResponse.json({ error: 'Failed to record document' }, { status: 500 });
  }

  return NextResponse.json(inserted, { status: 201 });
}

/**
 * Attach existing File rows to the deal — no upload, no copy. We insert a
 * DealDocument row per file whose storagePath equals the File's storageKey,
 * so the existing download/list paths work unchanged. The DELETE handler
 * detects this case by storage-path prefix (`files/...`) and skips the
 * object unlink, leaving the original File row's bytes intact.
 *
 * Request shape: { fileIds: string[]; kind?: DealDocumentKind }. Kind is
 * optional — if omitted we pick `defaultDocumentKind(pipelineType)` based
 * on the deal's current stage. Each attach inserts independently so a
 * single bad id doesn't poison the rest.
 */
async function handleAttachFromFiles(
  req: NextRequest,
  dealId: string,
  spaceId: string,
  userId: string,
) {
  let body: { fileIds?: unknown; kind?: unknown };
  try {
    body = (await req.json()) as { fileIds?: unknown; kind?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawIds = body.fileIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: 'fileIds[] required' }, { status: 400 });
  }
  // Per-request cap — keeps the per-id verify loop bounded and stops a
  // single attach from blowing through the rate limiter's budget.
  if (rawIds.length > 50) {
    return NextResponse.json({ error: 'Attach up to 50 files at a time' }, { status: 400 });
  }
  const fileIds = rawIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (fileIds.length === 0) {
    return NextResponse.json({ error: 'fileIds[] required' }, { status: 400 });
  }

  let kind: ReturnType<typeof defaultDocumentKind>;
  if (body.kind === undefined || body.kind === null) {
    // Resolve the deal's current pipeline type so the kind picker default
    // matches what the upload path does. Worst case (no stage) it returns
    // 'offer', the canonical buyer default.
    const { data: stageRow } = await supabase
      .from('Deal')
      .select('DealStage(pipelineType)')
      .eq('id', dealId)
      .eq('spaceId', spaceId)
      .maybeSingle();
    const pipelineType =
      (stageRow as { DealStage?: { pipelineType?: string | null } } | null)
        ?.DealStage?.pipelineType ?? null;
    kind = defaultDocumentKind(pipelineType);
  } else if (isValidDocumentKind(body.kind)) {
    kind = body.kind;
  } else {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  // Verify every file belongs to this space — defence-in-depth on top of
  // RLS. One round trip; the IN() result also gives us name/mime/size for
  // the DealDocument row without re-querying per id.
  const { data: ownedFiles, error: filesError } = await supabase
    .from('File')
    .select('id, name, mimeType, sizeBytes, storageKey')
    .in('id', fileIds)
    .eq('spaceId', spaceId);

  if (filesError) {
    logger.error('[deals/docs] file lookup failed', { dealId, spaceId }, filesError);
    return NextResponse.json({ error: 'Failed to look up files' }, { status: 500 });
  }

  const ownedSet = new Map((ownedFiles ?? []).map((f) => [f.id as string, f]));
  const missing = fileIds.filter((id) => !ownedSet.has(id));
  if (missing.length === fileIds.length) {
    return NextResponse.json({ error: 'No accessible files' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const rows = (ownedFiles ?? []).map((f) => ({
    id: crypto.randomUUID(),
    dealId,
    spaceId,
    kind,
    label: ((f.name as string | null) ?? 'file').slice(0, 200),
    // Point at the existing object. DELETE on this DealDocument will skip
    // the storage unlink because the path doesn't start with deal-documents/.
    storagePath: f.storageKey as string,
    contentType: (f.mimeType as string | null) ?? null,
    sizeBytes: Number(f.sizeBytes ?? 0),
    uploadedById: userId,
    createdAt: now,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('DealDocument')
    .insert(rows)
    .select();

  if (insertError) {
    logger.error('[deals/docs] attach insert failed', { dealId, count: rows.length }, insertError);
    return NextResponse.json({ error: 'Failed to attach files' }, { status: 500 });
  }

  return NextResponse.json(inserted ?? [], { status: 201 });
}
