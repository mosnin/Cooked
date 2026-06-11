/**
 * GET /api/agent/briefing
 *
 * Read today's brief for the authenticated realtor's space. The cron at
 * /api/cron/daily-briefing pre-generates the row at 7am UTC; this route
 * is the read path the workspace surface calls.
 *
 * Behavior when no brief exists yet (cron hasn't run, or this realtor's
 * row was missed by the last tick): compose on demand and persist. The
 * realtor opening Chippi at 8am before the cron caught up still sees
 * their brief; they just paid the latency.
 *
 * PATCH is the seen / acted lifecycle — the workspace marks the brief
 * 'seen' on first render and 'acted' when a card's button is tapped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { composeBrief } from '@/lib/briefing/compose';
import { localDateIn } from '@/lib/briefing/timing';
import type { Brief, BriefCardTap, SignalKind, SignalSource } from '@/lib/briefing/types';

const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * The brief's `forDate` is the realtor's LOCAL date — the date they see
 * on their phone when they open Chippi — not the server's UTC date.
 * Otherwise the late-night Pacific realtor opening the app at 11:30 PM
 * would already see "tomorrow's brief" because UTC has rolled over.
 */
async function todayLocalDate(spaceId: string): Promise<string> {
  const { data } = await supabase
    .from('SpaceSetting')
    .select('timezone')
    .eq('spaceId', spaceId)
    .maybeSingle();
  return localDateIn(new Date(), (data?.timezone as string | undefined) ?? DEFAULT_TIMEZONE);
}

/**
 * Compute the local date string N days offset from today in the
 * given timezone. Used for `?day=yesterday` (offset = -1) — the
 * lifecycle UX one-day window beyond which the brief stops being
 * accessible from the workspace surface.
 */
function localDateOffset(timezone: string, offsetDays: number): string {
  const at = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return localDateIn(at, timezone);
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // ?day=yesterday returns yesterday's brief as a READ-ONLY echo —
  // never composes on demand, never PATCHes, never stamps showIntro.
  // The one-day backward window is hard: there is no ?day=2-days-ago.
  const dayParam = req.nextUrl.searchParams.get('day');
  if (dayParam === 'yesterday') {
    const { data: tz } = await supabase
      .from('SpaceSetting')
      .select('timezone')
      .eq('spaceId', space.id)
      .maybeSingle();
    const yForDate = localDateOffset(
      (tz?.timezone as string | undefined) ?? DEFAULT_TIMEZONE,
      -1,
    );
    const { data: yRow } = await supabase
      .from('Brief')
      .select('id, status, payload, createdAt, seenAt, actedAt')
      .eq('spaceId', space.id)
      .eq('forDate', yForDate)
      .maybeSingle();

    if (!yRow) return NextResponse.json({ brief: null });
    return NextResponse.json({
      id: yRow.id,
      status: yRow.status,
      brief: yRow.payload as Brief,
      createdAt: yRow.createdAt,
      seenAt: yRow.seenAt,
      actedAt: yRow.actedAt,
    });
  }

  const forDate = await todayLocalDate(space.id);

  // Whether to show the one-line intro on this brief. Null means the
  // realtor has never seen a brief — the intro renders. Once 'seen'
  // PATCH fires the column gets stamped and the intro never returns.
  const { data: setting } = await supabase
    .from('SpaceSetting')
    .select('briefIntroSeenAt')
    .eq('spaceId', space.id)
    .maybeSingle();
  const showIntro = setting?.briefIntroSeenAt == null;

  const { data: existing } = await supabase
    .from('Brief')
    .select('id, status, payload, createdAt, seenAt, actedAt')
    .eq('spaceId', space.id)
    .eq('forDate', forDate)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({
      id: existing.id,
      status: existing.status,
      brief: existing.payload as Brief,
      createdAt: existing.createdAt,
      seenAt: existing.seenAt,
      actedAt: existing.actedAt,
      showIntro,
    });
  }

  // No row yet — compose on demand and persist. The realtor sees their
  // brief; tomorrow's cron tick fills the gap for everyone systematically.
  const { brief, cardMeta } = await composeBrief(space.id);
  const { data: created, error } = await supabase
    .from('Brief')
    .insert({
      spaceId: space.id,
      forDate,
      status: 'pending',
      payload: brief,
      cardMeta,
    })
    .select('id, status, payload, createdAt, seenAt, actedAt')
    .single();

  if (error || !created) {
    // Persist failed but the brief itself is fine — return it anyway
    // so the surface doesn't get stuck on a transient DB hiccup.
    return NextResponse.json({
      id: null,
      status: 'pending',
      brief,
      createdAt: new Date().toISOString(),
      seenAt: null,
      actedAt: null,
      showIntro,
    });
  }

  return NextResponse.json({
    id: created.id,
    status: created.status,
    brief: created.payload as Brief,
    createdAt: created.createdAt,
    seenAt: created.seenAt,
    actedAt: created.actedAt,
    showIntro,
  });
}

/**
 * PATCH /api/agent/briefing
 *
 * Body shapes:
 *   { event: 'seen' }
 *   { event: 'acted', cardIndex, source, kind }   // since B5
 *
 * 'seen'  → set seenAt + flip status from 'pending' to 'seen' (once).
 * 'acted' → set actedAt + flip status to 'acted' (once) + append the
 *           tap event to Brief.cardTaps. The cardIndex/source/kind
 *           triple identifies WHICH card was tapped so analytics can
 *           answer "which sources move realtors" without DOM scraping.
 *
 * Both are idempotent and additive — re-firing 'seen' doesn't overwrite
 * the earlier timestamp; re-firing 'acted' with the same
 * (cardIndex, source, kind) drops the duplicate.
 */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json()) as {
    event?: 'seen' | 'acted';
    cardIndex?: number;
    source?: SignalSource;
    kind?: SignalKind;
  };

  if (body.event !== 'seen' && body.event !== 'acted') {
    return NextResponse.json({ error: 'event must be "seen" or "acted"' }, { status: 400 });
  }

  const forDate = await todayLocalDate(space.id);
  const { data: existing } = await supabase
    .from('Brief')
    .select('id, seenAt, actedAt, status, cardTaps')
    .eq('spaceId', space.id)
    .eq('forDate', forDate)
    .maybeSingle();

  if (!existing) return NextResponse.json({ ok: true });

  const update: Record<string, string | BriefCardTap[]> = {};
  const nowIso = new Date().toISOString();

  if (body.event === 'seen' && !existing.seenAt) {
    update.seenAt = nowIso;
    if (existing.status === 'pending') update.status = 'seen';
  }
  if (body.event === 'acted') {
    if (!existing.seenAt) update.seenAt = nowIso;
    if (!existing.actedAt) update.actedAt = nowIso;
    update.status = 'acted';

    // Append the tap to cardTaps — but only if (cardIndex, source, kind)
    // is well-formed AND not already present. The triple is the dedup
    // key; duplicate taps (refresh, double-click, retry) are dropped.
    const taps = Array.isArray(existing.cardTaps) ? (existing.cardTaps as BriefCardTap[]) : [];
    const isValid =
      typeof body.cardIndex === 'number' &&
      typeof body.source === 'string' &&
      typeof body.kind === 'string';
    if (isValid) {
      const already = taps.some(
        (t) => t.cardIndex === body.cardIndex && t.source === body.source && t.kind === body.kind,
      );
      if (!already) {
        update.cardTaps = [
          ...taps,
          {
            cardIndex: body.cardIndex as number,
            source: body.source as SignalSource,
            kind: body.kind as SignalKind,
            tappedAt: nowIso,
          },
        ];
      }
    }
  }

  if (Object.keys(update).length > 0) {
    await supabase.from('Brief').update(update).eq('id', existing.id);
  }

  // The first ever 'seen' PATCH stamps briefIntroSeenAt so the one-line
  // intro never reappears. Only on 'seen' (not 'acted') because the
  // intro lives on the live brief surface, not on acted-then-collapsed.
  if (body.event === 'seen') {
    await supabase
      .from('SpaceSetting')
      .update({ briefIntroSeenAt: nowIso })
      .eq('spaceId', space.id)
      .is('briefIntroSeenAt', null);
  }

  return NextResponse.json({ ok: true });
}
