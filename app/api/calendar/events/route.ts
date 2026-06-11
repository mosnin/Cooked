/**
 * GET  /api/calendar/events?slug=xxx
 * POST /api/calendar/events    (manual event creation)
 *
 * GET: returns the next 30 days of events from the realtor's connected
 * external calendar (Google Calendar via Composio). On-demand fetch —
 * no background sync, no webhook receiver, no cache layer beyond a
 * thin 60s memoization to absorb the page's own re-renders.
 *
 * POST: realtor-initiated manual event creation. Validates ownership,
 * connection presence, and the payload shape; pushes to the provider
 * via `writeEventThrough` (same helper tour booking uses) so the event
 * appears in their actual Google Calendar AND a CalendarEventMirror
 * row lands for forensics. Returns the created event in the same
 * shape GET emits so the client can splice it into the visible view.
 *
 * The Chippi calendar surface is a thin read view; the realtor's
 * external calendar is the truth. If nothing's connected we return
 * `{ connected: false }` so the UI renders the connect prompt without
 * a separate roundtrip.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { executeToolForEntity } from '@/lib/integrations/composio';
import {
  PROVIDER_TOOL_SLUGS,
  findCalendarConnection,
  writeEventThrough,
} from '@/lib/calendar/mirror';
import {
  validateCreatePayload,
  type CreateEventBody,
} from '@/lib/calendar/event-validation';

export const runtime = 'nodejs';
// 30s is generous — the Composio call is typically <1s, but Google's
// cold path on a primary calendar with many events can stretch.
export const maxDuration = 30;

const LOOKAHEAD_DAYS = 30;

/** In-process memo. 60s TTL absorbs a realtor flipping between days
 *  in the UI without hammering Composio. Keyed by spaceId so multi-
 *  tenant calls don't cross-pollinate. The serverless cold-start
 *  ratio means this is mostly a hot-loop guard, not a long-term cache. */
interface CacheEntry {
  expiresAt: number;
  payload: ConnectedPayload;
}
const memo = new Map<string, CacheEntry>();
const MEMO_TTL_MS = 60_000;

interface CalendarEventOut {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string | null;
  attendees: { email: string; name: string | null; responseStatus: string | null }[];
}

interface NotConnectedPayload {
  connected: false;
}

interface ConnectedPayload {
  connected: true;
  provider: string;
  events: CalendarEventOut[];
}

type Payload = NotConnectedPayload | ConnectedPayload;

interface GcalEventAttendee {
  email?: string | null;
  displayName?: string | null;
  responseStatus?: string | null;
  self?: boolean | null;
}

interface GcalEvent {
  id?: string | null;
  summary?: string | null;
  description?: string | null;
  htmlLink?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: GcalEventAttendee[] | null;
}

function normalizeGcalEvent(raw: GcalEvent): CalendarEventOut | null {
  const id = raw.id ?? '';
  if (!id) return null;
  // Google sends `dateTime` for timed events, `date` for all-day events.
  // We pass both shapes through — the UI renders all-day differently.
  const startIso = raw.start?.dateTime ?? raw.start?.date ?? null;
  const endIso = raw.end?.dateTime ?? raw.end?.date ?? null;
  if (!startIso || !endIso) return null;
  const allDay = Boolean(raw.start?.date && !raw.start?.dateTime);
  return {
    id,
    title: (raw.summary ?? '').trim() || '(No title)',
    description: raw.description?.trim() || null,
    start: startIso,
    end: endIso,
    allDay,
    htmlLink: raw.htmlLink?.trim() || null,
    attendees: (raw.attendees ?? [])
      .filter((a): a is GcalEventAttendee => Boolean(a))
      .map((a) => ({
        email: (a.email ?? '').trim(),
        name: a.displayName?.trim() || null,
        responseStatus: a.responseStatus?.trim() || null,
      }))
      .filter((a) => a.email),
  };
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) {
    return NextResponse.json({ error: 'slug required' }, { status: 400 });
  }

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  // Connection presence is the data signal — IntegrationConnection row
  // with toolkit in (googlecalendar, outlook_calendar) and status =
  // 'active'. No row → render the connect prompt.
  const connection = await findCalendarConnection(space.id);
  if (!connection) {
    const payload: Payload = { connected: false };
    return NextResponse.json(payload);
  }

  // Hot-path cache. Independent of connection identity — a reconnect
  // (which mints a new connection id) bypasses the memo on the next
  // request because the cached payload no longer satisfies "events for
  // THIS active connection"; we just keep it simple and key by space.
  const cached = memo.get(space.id);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.payload);
  }

  const now = new Date();
  const timeMax = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const slugs = PROVIDER_TOOL_SLUGS[connection.toolkit];

  let events: CalendarEventOut[] = [];
  try {
    const resp = await executeToolForEntity({
      entityId: connection.userId,
      slug: slugs.list,
      arguments: {
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      },
    });
    if (resp.successful) {
      // Composio wraps Google's response; events can land at
      // resp.data.items, resp.data.events, or resp.items depending on
      // SDK version. Try in that order; bail to empty.
      const data = resp.data as
        | { items?: unknown; events?: unknown }
        | undefined;
      const rawItems =
        (data && Array.isArray((data as { items?: unknown }).items)
          ? ((data as { items?: unknown }).items as unknown[])
          : null) ??
        (data && Array.isArray((data as { events?: unknown }).events)
          ? ((data as { events?: unknown }).events as unknown[])
          : null) ??
        ((resp as unknown as { items?: unknown }).items &&
        Array.isArray((resp as unknown as { items?: unknown }).items)
          ? ((resp as unknown as { items?: unknown }).items as unknown[])
          : null) ??
        [];
      for (const raw of rawItems) {
        const normalized = normalizeGcalEvent(raw as GcalEvent);
        if (normalized) events.push(normalized);
      }
    } else {
      logger.warn(
        '[api/calendar/events] composio returned !successful',
        { spaceId: space.id, provider: connection.toolkit, err: resp.error ?? null },
      );
    }
  } catch (err) {
    logger.error(
      '[api/calendar/events] composio call threw',
      { spaceId: space.id, provider: connection.toolkit },
      err,
    );
    // Don't 500 — the realtor sees an empty list with the calm empty
    // state. Composio's flakiness shouldn't break the calendar page.
    events = [];
  }

  const payload: ConnectedPayload = {
    connected: true,
    provider: connection.toolkit,
    events,
  };
  memo.set(space.id, { expiresAt: Date.now() + MEMO_TTL_MS, payload });
  return NextResponse.json(payload);
}

/* ── POST ─────────────────────────────────────────────────────────────── */

/**
 * Manual event creation. Validates the realtor owns the space, has an
 * active calendar connection, and that the payload makes sense; then
 * fires `writeEventThrough` (same helper tour booking uses) so the event
 * lands in their actual calendar and a forensic mirror row gets written.
 */


export async function POST(req: NextRequest) {
  let body: CreateEventBody;
  try {
    body = (await req.json()) as CreateEventBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const validated = validateCreatePayload(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const connection = await findCalendarConnection(space.id);
  if (!connection) {
    return NextResponse.json(
      { error: 'Connect a calendar first.' },
      { status: 400 },
    );
  }

  const v = validated.value;
  const result = await writeEventThrough({
    spaceId: space.id,
    connection,
    title: v.title,
    description: v.description,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    attendees: v.attendees,
    createdBy: 'realtor',
  });

  if (!result.externalOk) {
    // The mirror row landed (forensics) but the realtor's calendar
    // didn't get the event. Tell them honestly — the optimistic UI
    // shouldn't show success when the calendar doesn't have it.
    return NextResponse.json(
      { error: 'Could not reach your calendar. Try again.' },
      { status: 502 },
    );
  }

  // Invalidate the 60s memo so a refetch picks up the new event from
  // the source of truth. Cheap; the next GET re-hits Composio once.
  memo.delete(space.id);

  // Return the event in the same shape GET emits — the client can splice
  // it directly into local state without a refetch.
  const event: CalendarEventOut = {
    id: result.externalEventId ?? `mirror-${result.mirrorId}`,
    title: v.title,
    description: v.description,
    start: v.startsAt,
    end: v.endsAt,
    allDay: v.allDay,
    htmlLink: null,
    attendees: v.attendees.map((a) => ({
      email: a.email,
      name: null,
      responseStatus: null,
    })),
  };

  logger.info('[api/calendar/events] manual event created', {
    spaceId: space.id,
    provider: connection.toolkit,
    externalEventId: result.externalEventId,
  });

  return NextResponse.json({ connected: true, provider: connection.toolkit, event });
}
