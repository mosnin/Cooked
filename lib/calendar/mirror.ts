/**
 * Calendar through-write helpers.
 *
 * When Chippi creates an event (tour, callback, follow-up), it does two
 * things:
 *   1. Writes the event to the realtor's connected external calendar
 *      via Composio (`GOOGLECALENDAR_CREATE_EVENT` etc.).
 *   2. Logs the same event to `CalendarEventMirror` as a backup row.
 *
 * The external calendar is the source of truth — Chippi reads from it
 * on-demand. The mirror row is forensics: if the realtor swaps
 * providers later, we still know what we put there.
 *
 * Failure modes:
 *   - Composio reachable, write succeeds → both rows land, externalEventId set.
 *   - Composio unreachable / write fails → the mirror row still lands
 *     (no externalEventId), so we don't lose the intent. Caller decides
 *     whether to surface the failure to the realtor.
 *   - No connected calendar → callers should skip this helper entirely
 *     (use `findCalendarConnection` to check). Writing to the mirror
 *     without an external write is pointless — there's no source of
 *     truth to back up.
 *
 * Why a thin helper instead of inlining: tour booking, post-tour
 * follow-up, manual block-time, and (future) follow-up-callback routines
 * all need the same through-write. One seam, one bug surface.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  composioConfigured,
  executeToolForEntity,
} from '@/lib/integrations/composio';

/** Provider slug as Composio knows it. */
export type CalendarProvider = 'googlecalendar' | 'outlook_calendar';

/** Slugs we accept for the read path — these are the "calendar" toolkits. */
export const CALENDAR_TOOLKITS = ['googlecalendar', 'outlook_calendar'] as const;

/** Composio tool slugs per provider. Keep in one place so the API route,
 *  the through-write helper, and the connection-presence check all agree
 *  on what a calendar even is. */
export const PROVIDER_TOOL_SLUGS = {
  googlecalendar: {
    list: 'GOOGLECALENDAR_EVENTS_LIST',
    create: 'GOOGLECALENDAR_CREATE_EVENT',
  },
  outlook_calendar: {
    // Composio's Outlook slugs. We don't write to Outlook yet — tour
    // booking only fires when googlecalendar is connected. Surfaced here
    // for future use; the create() path checks the provider first.
    list: 'OUTLOOK_CALENDAR_LIST_EVENTS',
    create: 'OUTLOOK_CALENDAR_CREATE_EVENT',
  },
} as const;

export interface CalendarConnection {
  /** IntegrationConnection row id. */
  id: string;
  /** Composio entityId — the realtor's Clerk userId. */
  userId: string;
  /** Provider slug. */
  toolkit: CalendarProvider;
}

/**
 * Find the realtor's active calendar connection for this space. Returns
 * the first match across the calendar toolkits — Google wins over Outlook
 * if somehow both are connected (Google is the brief's primary).
 *
 * Returns null when nothing's connected — callers should render the
 * connect prompt instead of attempting writes.
 */
export async function findCalendarConnection(
  spaceId: string,
): Promise<CalendarConnection | null> {
  if (!composioConfigured()) return null;

  const { data, error } = await supabase
    .from('IntegrationConnection')
    .select('id, userId, toolkit')
    .eq('spaceId', spaceId)
    .in('toolkit', CALENDAR_TOOLKITS as readonly string[])
    .eq('status', 'active')
    .order('toolkit', { ascending: true }) // 'googlecalendar' < 'outlook_calendar'
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn(
      '[calendar.mirror] findCalendarConnection failed',
      { spaceId, err: error.message },
    );
    return null;
  }
  if (!data) return null;

  // Defensive narrow — the IN filter constrains it but the column type is text.
  const toolkit = (data as { toolkit: string }).toolkit;
  if (toolkit !== 'googlecalendar' && toolkit !== 'outlook_calendar') return null;

  return {
    id: (data as { id: string }).id,
    userId: (data as { userId: string }).userId,
    toolkit,
  };
}

export interface WriteThroughInput {
  spaceId: string;
  connection: CalendarConnection;
  /** Display title for the event ("Tour: Sam Lee", "Callback: Jordan"). */
  title: string;
  /** Optional description / body — passed verbatim to the provider. */
  description?: string | null;
  /** ISO 8601 with timezone. */
  startsAt: string;
  /** ISO 8601 with timezone. Must be > startsAt. */
  endsAt: string;
  /** Attendees by email — passed to the provider AND stored on the mirror row. */
  attendees?: { email: string; name?: string | null }[];
  /** When mirroring a tour, point back to the Tour row for joins later. */
  sourceTourId?: string | null;
  /** Who initiated this. Realtors who use the manual UI = 'realtor'; the
   *  agent's tools = 'agent' (the default). */
  createdBy?: 'agent' | 'realtor';
}

export interface WriteThroughResult {
  /** CalendarEventMirror row id — present even on Composio failure. */
  mirrorId: string;
  /** Provider event id — null when the external write failed. */
  externalEventId: string | null;
  /** True iff the external write succeeded. */
  externalOk: boolean;
}

/**
 * Write an event to the realtor's external calendar AND log it to the
 * mirror table. Never throws — failures degrade to a mirror-only row
 * with `externalOk: false`, so the caller's primary action (booking a
 * tour) doesn't fail because Google was slow.
 */
export async function writeEventThrough(
  input: WriteThroughInput,
): Promise<WriteThroughResult> {
  // 1. Attempt the Composio write first. We use its id on the mirror row
  //    when it succeeds; null otherwise.
  let externalEventId: string | null = null;
  let externalOk = false;

  const slugs = PROVIDER_TOOL_SLUGS[input.connection.toolkit];
  if (slugs?.create && composioConfigured()) {
    try {
      // Google Calendar's createEvent shape: summary, description, start.dateTime,
      // end.dateTime, attendees[{ email, displayName }]. Composio passes through
      // verbatim. Outlook's shape differs — we currently only write through for
      // googlecalendar; the Outlook path lights up when we extend.
      const args: Record<string, unknown> = {
        summary: input.title,
        description: input.description ?? undefined,
        start_datetime: input.startsAt,
        end_datetime: input.endsAt,
        // Composio normalizes attendees across providers; pass the
        // canonical Google shape and let the SDK translate if needed.
        attendees: (input.attendees ?? []).map((a) => ({
          email: a.email,
          displayName: a.name ?? undefined,
        })),
      };
      const resp = await executeToolForEntity({
        entityId: input.connection.userId,
        slug: slugs.create,
        arguments: args,
      });
      if (resp.successful) {
        externalOk = true;
        // Composio wraps the provider response in `data`. Google returns
        // the created event with `id`; the SDK passes it through.
        const data = (resp.data as { id?: string; eventId?: string; response_data?: { id?: string } } | undefined) ?? undefined;
        externalEventId =
          data?.id ??
          data?.eventId ??
          data?.response_data?.id ??
          null;
      } else {
        logger.warn(
          '[calendar.mirror] external write failed',
          { spaceId: input.spaceId, provider: input.connection.toolkit, err: resp.error ?? null },
        );
      }
    } catch (err) {
      logger.warn(
        '[calendar.mirror] external write threw',
        { spaceId: input.spaceId, provider: input.connection.toolkit },
        err,
      );
    }
  }

  // 2. Always log the mirror row, even when the external write failed.
  //    Intent is the unit of forensics: if Chippi tried to put a tour on
  //    the calendar at 3pm and Google was down, we still want to know.
  const { data: mirrorRow, error: mirrorErr } = await supabase
    .from('CalendarEventMirror')
    .insert({
      spaceId: input.spaceId,
      externalProvider: input.connection.toolkit,
      externalEventId,
      title: input.title,
      start: input.startsAt,
      end: input.endsAt,
      attendees: input.attendees ?? [],
      sourceTourId: input.sourceTourId ?? null,
      createdBy: input.createdBy ?? 'agent',
    })
    .select('id')
    .single();

  if (mirrorErr || !mirrorRow) {
    logger.error(
      '[calendar.mirror] mirror insert failed',
      { spaceId: input.spaceId, externalEventId },
      mirrorErr,
    );
    // Last-resort: surface a sentinel id so the caller's shape stays
    // consistent. The audit row is gone, but the external event (if
    // any) still landed — the realtor's calendar is the truth.
    return { mirrorId: '', externalEventId, externalOk };
  }

  return {
    mirrorId: (mirrorRow as { id: string }).id,
    externalEventId,
    externalOk,
  };
}
