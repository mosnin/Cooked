/**
 * POST /api/esign/send — send a stored document out for signature on the
 * realtor's OWN connected DocuSign account (via Composio).
 *
 *   body: { slug, documentId, dealId?, contactId?, signerEmail, signerName?, subject? }
 *   → 201 { request }                  envelope sent, row recorded
 *   → 409 { code: 'not_connected' }    DocuSign isn't connected for this realtor
 *
 * Auth: requireSpaceOwner(slug). The send is rate-limited — envelopes are a
 * billable, irreversible action.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { sendForSignature } from '@/lib/esign';

export const runtime = 'nodejs';

const SUBJECT_MAX = 200;
// Deliberately strict email shape — full RFC validation is theater.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let payload: {
    slug?: string;
    documentId?: string;
    dealId?: string;
    contactId?: string;
    signerEmail?: string;
    signerName?: string;
    subject?: string;
  };
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

  const documentId = payload.documentId?.trim();
  if (!documentId) return NextResponse.json({ error: 'Pick a document to send.' }, { status: 400 });

  const signerEmail = payload.signerEmail?.trim().toLowerCase() ?? '';
  if (!signerEmail) return NextResponse.json({ error: "Add the signer's email." }, { status: 400 });
  if (!EMAIL_RE.test(signerEmail)) {
    return NextResponse.json({ error: 'That email address looks off.' }, { status: 400 });
  }

  const signerName = payload.signerName?.trim().slice(0, 200) || null;
  const subject = (payload.subject?.trim() || 'Please sign this document').slice(0, SUBJECT_MAX);

  // Rate limit — sending out envelopes is billable and irreversible.
  const { allowed } = await checkRateLimit(`esign:send:${userId}`, 10, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  const sent = await sendForSignature({
    userId,
    spaceId: space.id,
    documentId,
    dealId: payload.dealId?.trim() || null,
    contactId: payload.contactId?.trim() || null,
    signerEmail,
    signerName,
    subject,
  });

  if (sent.ok) {
    return NextResponse.json({ request: sent.signatureRequest }, { status: 201 });
  }

  switch (sent.reason) {
    case 'not_connected':
      return NextResponse.json(
        { error: 'Connect DocuSign to send for signature.', code: 'not_connected' },
        { status: 409 },
      );
    case 'document_not_found':
      return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
    case 'document_unreadable':
      return NextResponse.json({ error: 'Could not read that document.' }, { status: 500 });
    case 'send_failed':
      logger.error('[esign/send] send failed', { documentId, error: sent.error });
      return NextResponse.json({ error: 'DocuSign rejected the request. Try again.' }, { status: 502 });
    case 'persist_failed':
      return NextResponse.json(
        { error: 'Sent, but could not save the record. Check DocuSign.' },
        { status: 500 },
      );
    default:
      return NextResponse.json({ error: 'Could not send for signature.' }, { status: 500 });
  }
}
