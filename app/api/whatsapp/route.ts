/**
 * GET /api/whatsapp?slug=xxx
 *
 * The realtor's WhatsApp Business conversations, grouped per contact.
 *   - Nothing connected → `{ connected: false }`
 *   - Connected → `{ connected: true, conversations: [] }`
 *
 * Composio's WhatsApp toolkit slug shapes aren't fully verified (see
 * `WHATSAPP_SLUGS.listCandidates`). We try each candidate; if none
 * resolves, we surface an empty list with `noteSlugUnresolved: true` so
 * the UI can render an honest line rather than a 500.
 *
 * If the list slug returns flat messages (not pre-grouped conversations),
 * we group them client-side by phone number — the conversation is what
 * the realtor wants to see, not raw messages.
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

const MAX_CONVERSATIONS = 50;

export interface WhatsAppConversationOut {
  /** Conversation id (or phone number when the provider doesn't carry one). */
  id: string;
  contactName: string;
  contactPhone: string;
  /** Last message text, truncated. */
  snippet: string;
  lastAt: string;
}

interface ConnectedPayload {
  connected: true;
  conversations: WhatsAppConversationOut[];
  noteSlugUnresolved?: boolean;
}

interface NotConnectedPayload {
  connected: false;
}

interface WhatsAppRawRow {
  id?: string;
  conversation_id?: string;
  chatId?: string;
  contact?: { name?: string; phone?: string; wa_id?: string };
  contactName?: string;
  contactPhone?: string;
  phone?: string;
  wa_id?: string;
  from?: string;
  to?: string;
  lastMessage?: { text?: string; body?: string; timestamp?: string | number };
  last_message?: { text?: string; body?: string; timestamp?: string | number };
  message?: string;
  text?: string;
  body?: string;
  timestamp?: string | number;
  sent_at?: string;
  updated_at?: string;
  direction?: 'inbound' | 'outbound' | string;
  fromMe?: boolean;
}

function instantMs(c: WhatsAppRawRow): number {
  const candidates: Array<string | number | undefined> = [
    c.lastMessage?.timestamp,
    c.last_message?.timestamp,
    c.timestamp,
    c.sent_at,
    c.updated_at,
  ];
  for (const v of candidates) {
    if (v === undefined) continue;
    const n = typeof v === 'string' ? Date.parse(v) : Number(v);
    if (Number.isFinite(n) && n > 0) {
      return n < 1_000_000_000_000 ? n * 1000 : n;
    }
  }
  return 0;
}

function rowSnippet(c: WhatsAppRawRow): string {
  return (
    c.lastMessage?.text ??
    c.lastMessage?.body ??
    c.last_message?.text ??
    c.last_message?.body ??
    c.text ??
    c.message ??
    c.body ??
    ''
  );
}

function rowContact(c: WhatsAppRawRow): {
  id: string;
  name: string;
  phone: string;
} {
  const phone =
    c.contact?.phone ??
    c.contact?.wa_id ??
    c.contactPhone ??
    c.phone ??
    c.wa_id ??
    c.from ??
    c.to ??
    '';
  const name = c.contact?.name ?? c.contactName ?? phone ?? '';
  const id =
    c.id ??
    c.conversation_id ??
    c.chatId ??
    phone ??
    '';
  return { id, name, phone };
}

async function tryListSlug(args: {
  conn: WhatsAppConnection;
  slug: string;
}): Promise<{ rows: WhatsAppRawRow[]; ok: boolean }> {
  try {
    const resp = await executeToolForEntity({
      entityId: args.conn.userId,
      slug: args.slug,
      arguments: { limit: MAX_CONVERSATIONS, max_results: MAX_CONVERSATIONS },
    });
    if (resp.successful === false) {
      logger.debug('[api/whatsapp] slug declined', { slug: args.slug });
      return { rows: [], ok: false };
    }
    const data = resp.data as
      | { conversations?: unknown; messages?: unknown; items?: unknown }
      | undefined;
    const list =
      (Array.isArray(data?.conversations) ? data!.conversations : null) ??
      (Array.isArray(data?.messages) ? data!.messages : null) ??
      (Array.isArray(data?.items) ? data!.items : null) ??
      [];
    return { rows: list as WhatsAppRawRow[], ok: true };
  } catch (err) {
    logger.debug('[api/whatsapp] slug threw', {
      slug: args.slug,
      err: err instanceof Error ? err.message : String(err),
    });
    return { rows: [], ok: false };
  }
}

function groupIntoConversations(
  rows: WhatsAppRawRow[],
): WhatsAppConversationOut[] {
  // Group by contact phone — the conversation is the unit, not the message.
  const buckets = new Map<string, WhatsAppRawRow>();
  for (const r of rows) {
    const { id, phone } = rowContact(r);
    const key = phone || id;
    if (!key) continue;
    const cur = buckets.get(key);
    if (!cur || instantMs(r) > instantMs(cur)) buckets.set(key, r);
  }
  const out: WhatsAppConversationOut[] = [];
  for (const [key, r] of buckets) {
    const { id, name, phone } = rowContact(r);
    out.push({
      id: id || key,
      contactName: name || phone || '(Unknown contact)',
      contactPhone: phone,
      snippet: rowSnippet(r).trim().slice(0, 160),
      lastAt:
        instantMs(r) > 0
          ? new Date(instantMs(r)).toISOString()
          : new Date().toISOString(),
    });
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const conn = await findWhatsAppConnection(space.id);
  if (!conn) {
    const payload: NotConnectedPayload = { connected: false };
    return NextResponse.json(payload);
  }

  // Try each candidate slug; first one that resolves wins.
  let rows: WhatsAppRawRow[] | null = null;
  for (const slugCandidate of WHATSAPP_SLUGS.listCandidates) {
    const { rows: r, ok } = await tryListSlug({ conn, slug: slugCandidate });
    if (ok) {
      rows = r;
      break;
    }
  }

  if (rows === null) {
    logger.warn('[api/whatsapp] no list slug resolved');
    const payload: ConnectedPayload = {
      connected: true,
      conversations: [],
      noteSlugUnresolved: true,
    };
    return NextResponse.json(payload);
  }

  const conversations = groupIntoConversations(rows);
  const payload: ConnectedPayload = { connected: true, conversations };
  return NextResponse.json(payload);
}
