/**
 * GET /api/email/[id]?slug=xxx
 *
 * One email message, fully loaded. Backs the full-page read at
 * /s/[slug]/email/[id] — subject, sender, recipients, body, time, star
 * state, plus the Gmail webLink so the realtor can punch out to Gmail
 * itself.
 *
 * Uses GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID with full payload — the per-
 * message slug returns the body without query-DSL gymnastics that
 * GMAIL_FETCH_EMAILS demands.
 *
 * Plain text body, v1: rich HTML is a follow-up. We strip the HTML if
 * the provider didn't give us a text alternative.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { executeToolForEntity } from '@/lib/integrations/composio';
import {
  findEmailConnection,
  PROVIDER_MAIL_SLUGS,
} from '@/lib/communication/connect';

export const runtime = 'nodejs';
export const maxDuration = 30;

export interface EmailMessageOut {
  id: string;
  threadId: string;
  fromName: string;
  fromAddress: string;
  /** Display-friendly To list — first recipient name + address if available. */
  to: { name: string; address: string }[];
  cc: { name: string; address: string }[];
  subject: string | null;
  body: string;
  sentAt: string;
  starred: boolean;
  /** Open-in-Gmail web link when the provider returned one. */
  webLink: string | null;
}

interface OkPayload {
  ok: true;
  message: EmailMessageOut;
}

interface ErrPayload {
  ok: false;
  error: string;
}

interface GmailRawMessage {
  messageId?: string;
  threadId?: string;
  sender?: string;
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  subject?: string;
  messageText?: string;
  preview?: { body?: string } | string;
  payload?: {
    body?: { data?: string };
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
    }>;
  };
  messageTimestamp?: string;
  labelIds?: string[];
  webLink?: string;
  web_link?: string;
}

function parseAddress(headerValue: string | undefined | null): {
  name: string;
  address: string;
} {
  if (!headerValue) return { name: '', address: '' };
  const value = String(headerValue).trim();
  const angled = value.match(/^(.*?)<([^>]+)>\s*$/);
  if (angled) {
    return {
      name: angled[1].trim().replace(/^"|"$/g, '').trim(),
      address: angled[2].trim().toLowerCase(),
    };
  }
  if (value.includes('@')) return { name: '', address: value.toLowerCase() };
  return { name: value, address: '' };
}

function parseAddresses(
  headerValue: string | string[] | undefined,
): { name: string; address: string }[] {
  if (!headerValue) return [];
  const raw: string[] = Array.isArray(headerValue) ? headerValue : [headerValue];
  const items: { name: string; address: string }[] = [];
  for (const entry of raw) {
    for (const piece of entry.split(',')) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      items.push(parseAddress(trimmed));
    }
  }
  return items;
}

function gmailInstantMs(m: GmailRawMessage): number {
  const v = m.messageTimestamp;
  if (!v) return 0;
  const n = typeof v === 'string' ? Date.parse(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stripHtml(html: string): string {
  // Tiny, conservative — same approach the existing communication route
  // takes. Strip tags, decode the common entities, collapse whitespace.
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeBase64Url(value: string): string {
  try {
    const normal = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded =
      normal + (normal.length % 4 ? '='.repeat(4 - (normal.length % 4)) : '');
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractBody(m: GmailRawMessage): string {
  if (typeof m.messageText === 'string' && m.messageText.trim().length > 0) {
    return m.messageText;
  }

  // Dig into payload.parts for text/plain first, then fall back to
  // text/html and strip.
  const parts = m.payload?.parts ?? [];
  let plainData = '';
  let htmlData = '';
  for (const part of parts) {
    const data = part?.body?.data;
    if (!data) continue;
    if (part.mimeType === 'text/plain' && !plainData) plainData = data;
    else if (part.mimeType === 'text/html' && !htmlData) htmlData = data;
  }
  if (plainData) return decodeBase64Url(plainData);
  if (htmlData) return stripHtml(decodeBase64Url(htmlData));

  const directBody = m.payload?.body?.data;
  if (directBody) return decodeBase64Url(directBody);

  const p = m.preview;
  if (typeof p === 'string') return p;
  if (p && typeof p.body === 'string') return p.body;
  return '';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json<ErrPayload>(
      { ok: false, error: 'slug required' },
      { status: 400 },
    );
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const conn = await findEmailConnection(space.id);
  if (!conn) {
    return NextResponse.json<ErrPayload>(
      { ok: false, error: 'Connect email first.' },
      { status: 400 },
    );
  }
  if (conn.toolkit !== 'gmail') {
    return NextResponse.json<ErrPayload>(
      { ok: false, error: 'Outlook read is on the way.' },
      { status: 400 },
    );
  }

  const { id: rawId } = await params;
  const messageId = decodeURIComponent(rawId);

  try {
    const resp = await executeToolForEntity({
      entityId: conn.userId,
      slug: PROVIDER_MAIL_SLUGS.gmail.get,
      arguments: {
        message_id: messageId,
        messageId,
        format: 'full',
      },
    });

    if (resp.successful === false) {
      const err = (resp as { error?: string }).error ?? 'fetch_failed';
      logger.warn('[api/email/:id] gmail get !successful', { err });
      return NextResponse.json<ErrPayload>(
        { ok: false, error: 'Could not load this email.' },
        { status: 502 },
      );
    }

    const raw = (resp.data as GmailRawMessage) ?? {};
    const sender = parseAddress(raw.sender ?? raw.from);
    const tos = parseAddresses(raw.to);
    const ccs = parseAddresses(raw.cc);
    const labels = Array.isArray(raw.labelIds) ? raw.labelIds : [];
    const message: EmailMessageOut = {
      id: raw.messageId ?? messageId,
      threadId: raw.threadId ?? raw.messageId ?? messageId,
      fromName: sender.name,
      fromAddress: sender.address,
      to: tos,
      cc: ccs,
      subject: (raw.subject ?? '').trim() || null,
      body: extractBody(raw),
      sentAt: raw.messageTimestamp
        ? new Date(gmailInstantMs(raw)).toISOString()
        : new Date().toISOString(),
      starred: labels.includes('STARRED'),
      webLink: raw.webLink ?? raw.web_link ?? null,
    };

    return NextResponse.json<OkPayload>({ ok: true, message });
  } catch (err) {
    logger.error('[api/email/:id] gmail fetch threw', {}, err);
    return NextResponse.json<ErrPayload>(
      { ok: false, error: 'Could not load this email.' },
      { status: 502 },
    );
  }
}
