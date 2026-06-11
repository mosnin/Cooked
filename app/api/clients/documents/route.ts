import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { getClientUser } from '@/lib/client-auth';
import { clientOwnsContact } from '@/lib/client-portal-data';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import {
  uploadObject,
  deleteObject,
  getSignedDownloadUrl,
  buildKey,
} from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** Magic-number check — same defense as the realtor upload route. */
function contentMatchesType(header: Uint8Array): boolean {
  const isPdf = header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46;
  const isJpeg = header[0] === 0xff && header[1] === 0xd8;
  const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47;
  const isWebp =
    header.length >= 12 && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
  const isDoc = header[0] === 0xd0 && header[1] === 0xcf;
  const isDocx = header[0] === 0x50 && header[1] === 0x4b;
  return isPdf || isJpeg || isPng || isWebp || isDoc || isDocx;
}

/**
 * GET /api/clients/documents?contactId=… — list documents for a contact the
 * client owns. With &id=… it instead returns a short-lived signed download URL.
 */
export async function GET(req: NextRequest) {
  const user = await getClientUser();
  if (!user?.emailVerifiedAt) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const contactId = req.nextUrl.searchParams.get('contactId');
  const docId = req.nextUrl.searchParams.get('id');
  if (!contactId) return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  if (!(await clientOwnsContact(user.email, contactId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (docId) {
    const { data: doc } = await supabase
      .from('ClientDocument')
      .select('fileKey')
      .eq('id', docId)
      .eq('contactId', contactId)
      .maybeSingle();
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const url = await getSignedDownloadUrl((doc as { fileKey: string }).fileKey);
    return NextResponse.json({ url });
  }

  const { data } = await supabase
    .from('ClientDocument')
    .select('id, fileName, contentType, sizeBytes, uploadedBy, createdAt')
    .eq('contactId', contactId)
    .order('createdAt', { ascending: false });

  return NextResponse.json({ documents: data ?? [] });
}

/**
 * POST /api/clients/documents — client uploads a document to a contact they
 * own. Stored privately in Wasabi under the client-documents prefix; only
 * served back via signed URLs minted in GET.
 */
export async function POST(req: NextRequest) {
  const user = await getClientUser();
  if (!user?.emailVerifiedAt) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const contactId = formData.get('contactId') as string | null;
  const file = formData.get('file') as File | null;

  if (!contactId || !file) {
    return NextResponse.json({ error: 'contactId and file required' }, { status: 400 });
  }
  if (file.size === 0) return NextResponse.json({ error: 'Empty file' }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'File type not supported' }, { status: 400 });
  }

  if (!(await clientOwnsContact(user.email, contactId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { allowed } = await checkRateLimit(`clients:doc:${user.id}`, 20, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many uploads' }, { status: 429 });

  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!contentMatchesType(header)) {
    return NextResponse.json({ error: 'File content does not match declared type' }, { status: 400 });
  }

  const { data: contact } = await supabase
    .from('Contact')
    .select('spaceId')
    .eq('id', contactId)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const spaceId = (contact as { spaceId: string }).spaceId;

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  // Reuse the contact-documents prefix so it lands beside realtor-uploaded docs
  // for the same contact; the DB row's uploadedBy distinguishes the source.
  const fileKey = buildKey('contactDocuments', spaceId, contactId, `${crypto.randomUUID()}-${safeName}`);

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    await uploadObject({ key: fileKey, body: buffer, contentType: file.type, isPublic: false });
  } catch (err) {
    logger.error('[clients/documents] upload failed', { contactId }, err as Error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }

  const { data: doc, error } = await supabase
    .from('ClientDocument')
    .insert({
      contactId,
      spaceId,
      fileKey,
      fileName: file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255),
      contentType: file.type,
      sizeBytes: file.size,
      uploadedBy: 'client',
    })
    .select('id, fileName, contentType, sizeBytes, uploadedBy, createdAt')
    .single();

  if (error) {
    await deleteObject(fileKey).catch(() => undefined);
    logger.error('[clients/documents] insert failed', { contactId }, error);
    return NextResponse.json({ error: 'Failed to save document' }, { status: 500 });
  }

  return NextResponse.json({ document: doc }, { status: 201 });
}
