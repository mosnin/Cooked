/**
 * GET /api/email?slug=xxx&filter=inbox|starred|sent&pageToken=...&q=...
 *
 * The realtor's email, channel-pure (no WhatsApp). Mirrors the calendar
 * pattern — connection presence is part of the payload so the page
 * paints the right shape on first render.
 *
 *   - Nothing connected → `{ connected: false }`
 *   - Connected → `{ connected: true, provider, items: [], nextPageToken? }`
 *
 * Filter is Gmail's label_ids:
 *   - inbox   → ['INBOX']
 *   - starred → ['STARRED']
 *   - sent    → ['SENT']
 *
 * Search: pass `q` to run Gmail's full-text search. When q is present,
 * label_ids is omitted so the search scans the whole mailbox (Gmail's
 * own search syntax already supports from:/to:/subject: operators).
 *
 * Pagination is Gmail's native `next_page_token`. We pass it through; the
 * client tracks it for "Load more". 30 messages per page — enough to fill
 * a screen, small enough that the realtor isn't waiting on a 200-row
 * fetch when they only wanted the top dozen.
 *
 * No memo: each list call carries a pageToken, so the cache key would be
 * (slug, filter, pageToken) — three dimensions of state we'd have to
 * invalidate on every star, every send, every navigation. Composio's
 * Gmail call is fast enough that the simpler thing is to just refetch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { executeToolForEntity } from '@/lib/integrations/composio';
import {
  findEmailConnection,
  PROVIDER_MAIL_SLUGS,
  type MailConnection,
} from '@/lib/communication/connect';

export const runtime = 'nodejs';
export const maxDuration = 30;

const PAGE_SIZE = 30;

type EmailFilter = 'inbox' | 'starred' | 'sent';

function parseFilter(raw: string | null): EmailFilter {
  if (raw === 'starred' || raw === 'sent') return raw;
  return 'inbox';
}

function labelIdsFor(filter: EmailFilter): string[] {
  switch (filter) {
    case 'starred':
      return ['STARRED'];
    case 'sent':
      return ['SENT'];
    default:
      return ['INBOX'];
  }
}

export interface EmailListItem {
  /** Raw Gmail message id — what /email/[id] uses to fetch the full message. */
  id: string;
  /** Gmail thread id — kept for future "open the thread" affordance. */
  threadId: string;
  fromName: string;
  fromAddress: string;
  /** Realtor's own send: shown in the Sent filter; renders "to <recipient>" */
  toName: string;
  toAddress: string;
  subject: string | null;
  snippet: string;
  sentAt: string;
  unread: boolean;
  starred: boolean;
}

interface ConnectedPayload {
  connected: true;
  provider: 'gmail' | 'outlook';
  filter: EmailFilter;
  items: EmailListItem[];
  /** Pass back to /api/email?pageToken=... for the next page. */
  nextPageToken: string | null;
  /** Outlook list still isn't wired; surfaces honestly to the UI. */
  noteOutlookReadPending?: boolean;
}

interface NotConnectedPayload {
  connected: false;
}

interface GmailRawMessage {
  messageId?: string;
  threadId?: string;
  sender?: string;
  to?: string | string[];
  subject?: string;
  messageText?: string;
  preview?: { body?: string } | string;
  messageTimestamp?: string;
  labelIds?: string[];
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

function snippetFrom(m: GmailRawMessage): string {
  if (typeof m.messageText === 'string' && m.messageText.trim().length > 0) {
    return m.messageText.trim().slice(0, 160);
  }
  const p = m.preview;
  if (typeof p === 'string') return p.trim().slice(0, 160);
  if (p && typeof p.body === 'string') return p.body.trim().slice(0, 160);
  return '';
}

function msgInstantMs(m: GmailRawMessage): number {
  const v = m.messageTimestamp;
  if (!v) return 0;
  const n = typeof v === 'string' ? Date.parse(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchGmailPage(args: {
  conn: MailConnection;
  filter: EmailFilter;
  pageToken: string | null;
  /** Free-text search query. When set, label filtering is relaxed so the
   *  search scans the whole mailbox — same as Gmail's own search bar. */
  q?: string | null;
}): Promise<{ items: EmailListItem[]; nextPageToken: string | null }> {
  // Composio's Gmail SDK accepts `label_ids` and `page_token`. We also
  // pass the camelCase counterparts in case the SDK adapter drifts.
  // When a search query is present, skip the label filter so results
  // surface from across the mailbox.
  const callArgs: Record<string, unknown> = {
    max_results: PAGE_SIZE,
    include_payload: false,
  };

  if (args.q) {
    // Pass query under both key spellings in case the SDK adapter varies.
    callArgs.query = args.q;
    callArgs.q = args.q;
  } else {
    const labelIds = labelIdsFor(args.filter);
    callArgs.label_ids = labelIds;
    callArgs.labelIds = labelIds;
  }

  if (args.pageToken) {
    callArgs.page_token = args.pageToken;
    callArgs.pageToken = args.pageToken;
  }

  const resp = await executeToolForEntity({
    entityId: args.conn.userId,
    slug: PROVIDER_MAIL_SLUGS.gmail.list,
    arguments: callArgs,
  });

  if (resp.successful === false) {
    logger.warn('[api/email] gmail list !successful', {
      err: (resp as { error?: string }).error ?? null,
    });
    return { items: [], nextPageToken: null };
  }

  const data = resp.data as
    | {
        messages?: unknown;
        next_page_token?: unknown;
        nextPageToken?: unknown;
        resultSizeEstimate?: number;
      }
    | undefined;

  const messages = Array.isArray(data?.messages)
    ? (data!.messages as GmailRawMessage[])
    : [];

  const items: EmailListItem[] = messages
    .filter((m) => Boolean(m.messageId))
    .map((m): EmailListItem => {
      const sender = parseAddress(m.sender);
      // For sent messages, the "interesting" person is the recipient.
      const tos = Array.isArray(m.to) ? m.to : m.to ? [m.to] : [];
      const recipient = tos[0] ? parseAddress(tos[0]) : { name: '', address: '' };
      const labels = Array.isArray(m.labelIds) ? m.labelIds : [];
      return {
        id: m.messageId!,
        threadId: m.threadId ?? m.messageId!,
        fromName: sender.name,
        fromAddress: sender.address,
        toName: recipient.name,
        toAddress: recipient.address,
        subject: (m.subject ?? '').trim() || null,
        snippet: snippetFrom(m),
        sentAt: m.messageTimestamp
          ? new Date(msgInstantMs(m)).toISOString()
          : new Date().toISOString(),
        unread: labels.includes('UNREAD'),
        starred: labels.includes('STARRED'),
      };
    });

  const rawToken =
    (typeof data?.next_page_token === 'string' && data.next_page_token) ||
    (typeof data?.nextPageToken === 'string' && data.nextPageToken) ||
    null;

  return { items, nextPageToken: rawToken };
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const conn = await findEmailConnection(space.id);
  if (!conn) {
    const payload: NotConnectedPayload = { connected: false };
    return NextResponse.json(payload);
  }

  const filter = parseFilter(req.nextUrl.searchParams.get('filter'));
  const pageToken = req.nextUrl.searchParams.get('pageToken');
  const q = req.nextUrl.searchParams.get('q') ?? null;

  if (conn.toolkit !== 'gmail') {
    const payload: ConnectedPayload = {
      connected: true,
      provider: 'outlook',
      filter,
      items: [],
      nextPageToken: null,
      noteOutlookReadPending: true,
    };
    return NextResponse.json(payload);
  }

  const { items, nextPageToken } = await fetchGmailPage({
    conn,
    filter,
    pageToken,
    q,
  });

  const payload: ConnectedPayload = {
    connected: true,
    provider: 'gmail',
    filter,
    items,
    nextPageToken,
  };
  return NextResponse.json(payload);
}
