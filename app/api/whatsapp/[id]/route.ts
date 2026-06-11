/**
 * GET /api/whatsapp/[id]?slug=xxx
 *
 * One WhatsApp conversation, fully loaded. Backs the thread page at
 * /s/[slug]/whatsapp/[id] — messages sorted oldest → newest so the
 * realtor reads top-down.
 *
 * Composio's WhatsApp toolkit again best-effort: try each get-candidate
 * slug in order; if none resolves, surface a clean error.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { executeToolForEntity } from '@/lib/integrations/composio';
import {
  findWhatsAppConnection,
  WHATSAPP_SLUGS,
  type WhatsAppConnection,
} from '@/lib/communication/connect';

export const runtime = 'nodejs';
export const maxDuration = 30;

export interface WhatsAppMessageOut {
  id: string;
  fromName: string;
  fromAddress: string;
  body: string;
  sentAt: string;
  fromMe: boolean;
}

interface OkPayload {
  ok: true;
  conversation: {
    id: string;
    contactName: string;
    contactPhone: string;
  };
  messages: WhatsAppMessageOut[];
}

interface ErrPayload {
  ok: false;
  error: string;
}

interface WhatsAppRawMessage {
  id?: string;
  message_id?: string;
  from?: string;
  to?: string;
  sender?: { name?: string; phone?: string };
  fromName?: string;
  text?: string;
  body?: string;
  message?: string;
  timestamp?: string | number;
  sent_at?: string;
  direction?: 'inbound' | 'outbound' | string;
  fromMe?: boolean;
}

function instantMs(m: WhatsAppRawMessage): number {
  const candidates: Array<string | number | undefined> = [m.timestamp, m.sent_at];
  for (const v of candidates) {
    if (v === undefined) continue;
    const n = typeof v === 'string' ? Date.parse(v) : Number(v);
    if (Number.isFinite(n) && n > 0) {
      return n < 1_000_000_000_000 ? n * 1000 : n;
    }
  }
  return 0;
}

async function tryGetSlug(args: {
  conn: WhatsAppConnection;
  slug: string;
  conversationId: string;
}): Promise<{ rows: WhatsAppRawMessage[]; ok: boolean }> {
  try {
    const resp = await executeToolForEntity({
      entityId: args.conn.userId,
      slug: args.slug,
      // Pass several arg shapes — Composio's WhatsApp slugs aren't
      // fully documented and we want the first one that resolves.
      arguments: {
        conversation_id: args.conversationId,
        conversationId: args.conversationId,
        chat_id: args.conversationId,
        to: args.conversationId,
        phone_number: args.conversationId,
        limit: 100,
        max_results: 100,
      },
    });
    if (resp.successful === false) {
      logger.debug('[api/whatsapp/:id] slug declined', { slug: args.slug });
      return { rows: [], ok: false };
    }
    const data = resp.data as
      | { messages?: unknown; items?: unknown }
      | undefined;
    const raw =
      (Array.isArray(data?.messages) ? data!.messages : null) ??
      (Array.isArray(data?.items) ? data!.items : null) ??
      [];
    return { rows: raw as WhatsAppRawMessage[], ok: true };
  } catch (err) {
    logger.debug('[api/whatsapp/:id] slug threw', {
      slug: args.slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return { rows: [], ok: false };
  }
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

  const conn = await findWhatsAppConnection(space.id);
  if (!conn) {
    return NextResponse.json<ErrPayload>(
      { ok: false, error: 'Connect WhatsApp first.' },
      { status: 400 },
    );
  }

  const { id: rawId } = await params;
  const conversationId = decodeURIComponent(rawId);

  let rows: WhatsAppRawMessage[] | null = null;
  for (const candidate of WHATSAPP_SLUGS.getCandidates) {
    const { rows: r, ok } = await tryGetSlug({
      conn,
      slug: candidate,
      conversationId,
    });
    if (ok) {
      rows = r;
      break;
    }
  }

  if (rows === null) {
    return NextResponse.json<ErrPayload>(
      { ok: false, error: 'Could not load this conversation.' },
      { status: 502 },
    );
  }

  const messages: WhatsAppMessageOut[] = rows
    .map((m): WhatsAppMessageOut => {
      const fromAddress = m.from ?? m.sender?.phone ?? '';
      const fromName = m.sender?.name ?? m.fromName ?? '';
      const body = m.text ?? m.body ?? m.message ?? '';
      const inst = instantMs(m);
      const fromMe =
        typeof m.fromMe === 'boolean' ? m.fromMe : m.direction === 'outbound';
      return {
        id: m.id ?? m.message_id ?? `${conversationId}-${inst}`,
        fromName,
        fromAddress,
        body,
        sentAt: inst > 0 ? new Date(inst).toISOString() : new Date().toISOString(),
        fromMe,
      };
    })
    .sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));

  // Best-effort contact resolution from the most-recent inbound message.
  const inboundMsg = [...rows]
    .reverse()
    .find((m) => m.direction !== 'outbound' && m.fromMe !== true);
  const contactPhone = inboundMsg?.from ?? inboundMsg?.sender?.phone ?? conversationId;
  const contactName =
    inboundMsg?.sender?.name ?? inboundMsg?.fromName ?? contactPhone ?? '';

  return NextResponse.json<OkPayload>({
    ok: true,
    conversation: {
      id: conversationId,
      contactName: contactName || contactPhone || '(Unknown contact)',
      contactPhone,
    },
    messages,
  });
}
