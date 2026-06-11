/**
 * E-signature via Composio — the realtor's OWN connected DocuSign account.
 *
 * There is no platform DocuSign app, no JWT, no integration key, no token
 * storage here. DocuSign is a live Composio toolkit (see catalog.ts). The
 * realtor connects it through the same OAuth flow as Gmail/Slack; Composio
 * owns the OAuth app and holds the tokens. We send and read envelopes on
 * the realtor's behalf by executing Composio DocuSign actions, scoped to
 * the realtor's Clerk userId (the Composio "entity").
 *
 * Every exported function gates cleanly: if DocuSign isn't connected or
 * Composio isn't configured, it returns a structured result — it never
 * throws a 500.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠️  ACTION SLUGS NEED LIVE VERIFICATION  ⚠️
 * ─────────────────────────────────────────────────────────────────────────
 * Composio fetches its action catalog from its API at runtime — the slugs
 * are NOT bundled in the SDK, so they can't be confirmed offline. The
 * `DOCUSIGN_ACTIONS` block below holds the best-documented candidate slugs
 * and the argument mapping for each. If a call fails with an "unknown tool"
 * / "action not found" error, run `discoverDocusignActions(userId)` against
 * a live connected account, read the printed slugs, and correct this block.
 * It is intentionally the ONLY place any slug or arg name lives.
 */

import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { getSignedDownloadUrl, uploadObject, buildKey } from '@/lib/storage';
import {
  composioConfigured,
  executeToolForEntity,
  loadToolsForEntity,
  listConnectedAccountsForEntity,
} from '@/lib/integrations/composio';

const DOCUSIGN_TOOLKIT = 'docusign';

// ── The one place slugs + arg shapes live ────────────────────────────────────
//
// DocuSign Composio actions are named DOCUSIGN_<VERB>. These three are the
// envelope lifecycle we need. Arg names follow DocuSign's eSignature REST v2.1
// body (Composio passes them through to DocuSign mostly verbatim), but the
// exact Composio parameter casing should be verified against a live account
// via `discoverDocusignActions`.
const DOCUSIGN_ACTIONS = {
  /** Create + send a single-signer envelope from one base64 document. */
  CREATE_ENVELOPE: 'DOCUSIGN_CREATE_ENVELOPE',
  /** Fetch one envelope's current status. */
  GET_ENVELOPE: 'DOCUSIGN_GET_ENVELOPE',
  /** Download the combined signed PDF (base64) for a completed envelope. */
  GET_DOCUMENT: 'DOCUSIGN_GET_ENVELOPE_DOCUMENT',
} as const;

/** Build the CREATE_ENVELOPE arguments — DocuSign envelope-definition shape. */
function createEnvelopeArgs(input: {
  documentBase64: string;
  documentName: string;
  fileExtension: string;
  signerEmail: string;
  signerName: string;
  subject: string;
}): Record<string, unknown> {
  return {
    status: 'sent',
    emailSubject: input.subject,
    documents: [
      {
        documentBase64: input.documentBase64,
        name: input.documentName,
        fileExtension: input.fileExtension,
        documentId: '1',
      },
    ],
    recipients: {
      signers: [
        {
          email: input.signerEmail,
          name: input.signerName,
          recipientId: '1',
          routingOrder: '1',
          tabs: {
            signHereTabs: [
              {
                anchorString: 'Signature:',
                anchorUnits: 'pixels',
                anchorXOffset: '40',
                anchorYOffset: '0',
                documentId: '1',
                pageNumber: '1',
                recipientId: '1',
                xPosition: '100',
                yPosition: '100',
              },
            ],
          },
        },
      ],
    },
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SignatureStatus =
  | 'created'
  | 'sent'
  | 'delivered'
  | 'completed'
  | 'declined'
  | 'voided';

export interface SignatureRequestRow {
  id: string;
  spaceId: string;
  dealId: string | null;
  contactId: string | null;
  documentId: string | null;
  envelopeId: string | null;
  subject: string;
  signerEmail: string;
  signerName: string | null;
  status: SignatureStatus;
  signedDocumentUrl: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const REQUEST_COLUMNS =
  'id, spaceId, dealId, contactId, documentId, envelopeId, subject, signerEmail, signerName, status, signedDocumentUrl, completedAt, createdAt, updatedAt';

/** Composio's execute response: { successful, data?, error? }. */
interface ComposioExecuteResult {
  successful?: boolean;
  data?: unknown;
  error?: string | null;
}

// ── Connection check ───────────────────────────────────────────────────────────

/** True when the realtor has an active DocuSign connection on Composio. */
export async function isDocusignConnected(userId: string): Promise<boolean> {
  if (!composioConfigured()) return false;
  try {
    const list = await listConnectedAccountsForEntity({ entityId: userId });
    const items = ((list as { items?: unknown[] })?.items ?? []) as Array<{
      toolkit?: { slug?: string } | null;
      status?: string;
    }>;
    return items.some(
      (i) => i.toolkit?.slug === DOCUSIGN_TOOLKIT && i.status === 'ACTIVE',
    );
  } catch (err) {
    logger.warn('[esign] isDocusignConnected check failed', {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Enumerate the DocuSign actions actually available on the connected account.
 * Diagnostic helper — call this to confirm the real slugs when an envelope
 * action fails with "unknown tool". Returns the slug list (also logged).
 */
export async function discoverDocusignActions(userId: string): Promise<string[]> {
  if (!composioConfigured()) return [];
  try {
    const tools = await loadToolsForEntity({
      entityId: userId,
      toolkits: [DOCUSIGN_TOOLKIT],
    });
    const slugs = (tools as Array<{ name?: string; slug?: string }>).map(
      (t) => t.slug ?? t.name ?? '',
    ).filter(Boolean);
    logger.info('[esign] discovered docusign action slugs', { userId, slugs });
    return slugs;
  } catch (err) {
    logger.warn('[esign] discoverDocusignActions failed', {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

// ── Send for signature ───────────────────────────────────────────────────────

export interface SendForSignatureInput {
  userId: string;
  spaceId: string;
  documentId: string;
  dealId?: string | null;
  contactId?: string | null;
  signerEmail: string;
  signerName?: string | null;
  subject?: string | null;
}

export type SendForSignatureResult =
  | { ok: true; signatureRequest: SignatureRequestRow }
  | { ok: false; reason: 'not_connected' }
  | { ok: false; reason: 'document_not_found' }
  | { ok: false; reason: 'document_unreadable' }
  | { ok: false; reason: 'send_failed'; error: string }
  | { ok: false; reason: 'persist_failed' };

/** Lowercase file extension (default pdf). */
function fileExtensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'pdf';
  return name.slice(dot + 1).toLowerCase();
}

/** Pull an envelope id out of Composio's response data, however it's nested. */
function extractEnvelopeId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const direct = d.envelopeId ?? d.envelope_id;
  if (typeof direct === 'string' && direct) return direct;
  // Composio sometimes wraps the provider body under `response_data`/`data`.
  for (const key of ['response_data', 'data', 'result']) {
    const nested = d[key];
    if (nested && typeof nested === 'object') {
      const id = (nested as Record<string, unknown>).envelopeId ??
        (nested as Record<string, unknown>).envelope_id;
      if (typeof id === 'string' && id) return id;
    }
  }
  return null;
}

/**
 * Send a stored document out for signature on the realtor's DocuSign account.
 * Fetches the document bytes, base64-encodes them, fires the Composio
 * CREATE_ENVELOPE action, and records a SignatureRequest row.
 */
export async function sendForSignature(
  input: SendForSignatureInput,
): Promise<SendForSignatureResult> {
  // 1. Gate on connection.
  if (!(await isDocusignConnected(input.userId))) {
    return { ok: false, reason: 'not_connected' };
  }

  // 2. Load the document — scoped to the space so a caller can't sign
  //    someone else's file.
  const { data: doc, error: docError } = await supabase
    .from('DealDocument')
    .select('id, dealId, label, storagePath, contentType')
    .eq('id', input.documentId)
    .eq('spaceId', input.spaceId)
    .maybeSingle();

  if (docError) {
    logger.error('[esign] doc lookup failed', {
      documentId: input.documentId,
      err: docError.message,
    });
    return { ok: false, reason: 'document_not_found' };
  }
  if (!doc) return { ok: false, reason: 'document_not_found' };

  // 3. Fetch + base64-encode the bytes via a short-lived signed URL — same
  //    store the documents download path uses, no new storage primitive.
  let documentBase64: string;
  try {
    const url = await getSignedDownloadUrl(doc.storagePath as string, 60);
    const fileRes = await fetch(url);
    if (!fileRes.ok) throw new Error(`fetch ${fileRes.status}`);
    documentBase64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');
  } catch (err) {
    logger.error('[esign] doc fetch failed', { documentId: input.documentId }, err);
    return { ok: false, reason: 'document_unreadable' };
  }

  const rawName =
    (doc.label as string | null)?.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) ||
    'document.pdf';
  const documentName = rawName.includes('.') ? rawName : `${rawName}.pdf`;
  const signerEmail = input.signerEmail.trim().toLowerCase();
  const signerName = input.signerName?.trim() || signerEmail;
  const subject = (input.subject?.trim() || 'Please sign this document').slice(0, 200);

  // 4. Fire the Composio CREATE_ENVELOPE action on the realtor's account.
  let envelopeId: string | null = null;
  try {
    const result = (await executeToolForEntity({
      entityId: input.userId,
      slug: DOCUSIGN_ACTIONS.CREATE_ENVELOPE,
      arguments: createEnvelopeArgs({
        documentBase64,
        documentName,
        fileExtension: fileExtensionOf(documentName),
        signerEmail,
        signerName,
        subject,
      }),
    })) as ComposioExecuteResult;

    if (!result.successful) {
      logger.error('[esign] create envelope failed', {
        documentId: input.documentId,
        error: result.error ?? 'unknown',
      });
      return { ok: false, reason: 'send_failed', error: result.error ?? 'unknown' };
    }
    envelopeId = extractEnvelopeId(result.data);
  } catch (err) {
    logger.error('[esign] create envelope threw', { documentId: input.documentId }, err);
    return {
      ok: false,
      reason: 'send_failed',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }

  // 5. Record the request.
  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from('SignatureRequest')
    .insert({
      spaceId: input.spaceId,
      dealId: input.dealId?.trim() || (doc.dealId as string | null) || null,
      contactId: input.contactId?.trim() || null,
      documentId: doc.id,
      envelopeId,
      subject,
      signerEmail,
      signerName: input.signerName?.trim() || null,
      status: 'sent',
      createdAt: now,
      updatedAt: now,
    })
    .select(REQUEST_COLUMNS)
    .single();

  if (insertError || !inserted) {
    logger.error('[esign] insert failed after send', {
      envelopeId,
      err: insertError?.message,
    });
    return { ok: false, reason: 'persist_failed' };
  }

  return { ok: true, signatureRequest: inserted as SignatureRequestRow };
}

// ── Refresh envelope status ────────────────────────────────────────────────────

export type RefreshEnvelopeStatusResult =
  | { ok: true; signatureRequest: SignatureRequestRow }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_connected' }
  | { ok: false; reason: 'no_envelope' }
  | { ok: false; reason: 'refresh_failed'; error: string };

/** Map a DocuSign envelope status string onto our enum. */
function mapDocusignStatus(raw: string | null | undefined): SignatureStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'completed':
    case 'signed':
      return 'completed';
    case 'declined':
      return 'declined';
    case 'voided':
      return 'voided';
    default:
      return 'sent';
  }
}

/** Pull a status string out of Composio's GET_ENVELOPE response. */
function extractEnvelopeStatus(data: unknown): { status?: string; completedDateTime?: string | null } {
  if (!data || typeof data !== 'object') return {};
  const d = data as Record<string, unknown>;
  const pick = (obj: Record<string, unknown>) => ({
    status: typeof obj.status === 'string' ? obj.status : undefined,
    completedDateTime:
      typeof obj.completedDateTime === 'string'
        ? obj.completedDateTime
        : typeof obj.completed_date_time === 'string'
          ? (obj.completed_date_time as string)
          : null,
  });
  if (typeof d.status === 'string') return pick(d);
  for (const key of ['response_data', 'data', 'result']) {
    const nested = d[key];
    if (nested && typeof nested === 'object') return pick(nested as Record<string, unknown>);
  }
  return {};
}

/** Extract a base64 PDF body out of Composio's GET_DOCUMENT response. */
function extractDocumentBase64(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  for (const key of ['documentBase64', 'document_base64', 'content', 'base64', 'data']) {
    const v = d[key];
    if (typeof v === 'string' && v.length > 0 && !/^https?:/i.test(v)) return v;
  }
  for (const key of ['response_data', 'data', 'result']) {
    const nested = d[key];
    if (nested && typeof nested === 'object') {
      const inner = extractDocumentBase64(nested);
      if (inner) return inner;
    }
  }
  return null;
}

export interface RefreshEnvelopeStatusInput {
  userId: string;
  signatureRequestId: string;
}

/**
 * Refresh one SignatureRequest's status from DocuSign via Composio. On
 * 'completed', fetch the signed PDF, store it, attach it back as a
 * DealDocument (when the request is tied to a deal), and stamp completion.
 */
export async function refreshEnvelopeStatus(
  input: RefreshEnvelopeStatusInput,
): Promise<RefreshEnvelopeStatusResult> {
  const { data: row, error: rowError } = await supabase
    .from('SignatureRequest')
    .select(REQUEST_COLUMNS)
    .eq('id', input.signatureRequestId)
    .maybeSingle();

  if (rowError || !row) return { ok: false, reason: 'not_found' };
  const request = row as SignatureRequestRow;

  // Terminal states never change — return as-is, no network call.
  if (
    request.status === 'completed' ||
    request.status === 'declined' ||
    request.status === 'voided'
  ) {
    return { ok: true, signatureRequest: request };
  }
  if (!request.envelopeId) return { ok: false, reason: 'no_envelope' };
  if (!(await isDocusignConnected(input.userId))) {
    return { ok: false, reason: 'not_connected' };
  }

  // Fetch current status.
  let status: SignatureStatus;
  let completedDateTime: string | null = null;
  try {
    const result = (await executeToolForEntity({
      entityId: input.userId,
      slug: DOCUSIGN_ACTIONS.GET_ENVELOPE,
      arguments: { envelopeId: request.envelopeId },
    })) as ComposioExecuteResult;

    if (!result.successful) {
      return { ok: false, reason: 'refresh_failed', error: result.error ?? 'unknown' };
    }
    const parsed = extractEnvelopeStatus(result.data);
    status = mapDocusignStatus(parsed.status);
    completedDateTime = parsed.completedDateTime ?? null;
  } catch (err) {
    logger.error('[esign] get envelope threw', { id: request.id }, err);
    return {
      ok: false,
      reason: 'refresh_failed',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }

  // No change → just bump updatedAt and return. (request.status is already
  // narrowed to non-terminal here, so an unchanged status can't be completed.)
  if (status === request.status) {
    await supabase
      .from('SignatureRequest')
      .update({ updatedAt: new Date().toISOString() })
      .eq('id', request.id);
    return { ok: true, signatureRequest: { ...request, status } };
  }

  let signedDocumentUrl: string | null = request.signedDocumentUrl;
  let completedAt: string | null = request.completedAt;

  // On completion, fetch + store the signed PDF and attach it to the deal.
  if (status === 'completed') {
    completedAt = completedDateTime ?? new Date().toISOString();
    try {
      const docResult = (await executeToolForEntity({
        entityId: input.userId,
        slug: DOCUSIGN_ACTIONS.GET_DOCUMENT,
        // 'combined' returns the whole envelope as one PDF.
        arguments: { envelopeId: request.envelopeId, documentId: 'combined' },
      })) as ComposioExecuteResult;

      const base64 = docResult.successful ? extractDocumentBase64(docResult.data) : null;
      if (base64) {
        const key = buildKey(
          'dealDocuments',
          request.spaceId,
          request.dealId ?? 'signatures',
          `${request.id}-signed.pdf`,
        );
        await uploadObject({
          key,
          body: Buffer.from(base64, 'base64'),
          contentType: 'application/pdf',
          isPublic: false,
        });
        signedDocumentUrl = key;

        // Attach back as a DealDocument when tied to a deal.
        if (request.dealId) {
          await supabase.from('DealDocument').insert({
            dealId: request.dealId,
            spaceId: request.spaceId,
            kind: 'other',
            label: `${request.subject} (signed)`.slice(0, 200),
            storagePath: key,
            contentType: 'application/pdf',
            sizeBytes: Buffer.from(base64, 'base64').length,
            uploadedById: null,
            createdAt: new Date().toISOString(),
          });
        }
      } else {
        logger.warn('[esign] signed doc fetch returned no bytes', { id: request.id });
      }
    } catch (err) {
      // The envelope IS complete; failing to grab the PDF shouldn't block the
      // status update. Log and carry on with the status persisted.
      logger.error('[esign] signed doc fetch/attach failed', { id: request.id }, err);
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('SignatureRequest')
    .update({
      status,
      signedDocumentUrl,
      completedAt,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', request.id)
    .select(REQUEST_COLUMNS)
    .single();

  if (updateError || !updated) {
    logger.error('[esign] status persist failed', { id: request.id, err: updateError?.message });
    return {
      ok: true,
      signatureRequest: { ...request, status, signedDocumentUrl, completedAt },
    };
  }

  return { ok: true, signatureRequest: updated as SignatureRequestRow };
}
