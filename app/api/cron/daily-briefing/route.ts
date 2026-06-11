/**
 * GET /api/cron/daily-briefing
 *
 * Hourly tick (UTC). For each Space whose SpaceSetting matches the
 * current local hour in its timezone, generates today's Brief and
 * UPSERTs it. The `forDate` key is the SPACE'S local date — what the
 * realtor sees on their phone, not the server's UTC date.
 *
 * Why hourly: per-realtor 7am local. A 7am UTC daily cron would deliver
 * to Pacific realtors at midnight. Each tick now scans every space and
 * generates only for those whose briefHour matches the current local
 * hour. Spaces with briefEnabled=false are skipped.
 *
 * Bounds:
 *   - MAX_PER_TICK = 1000; overflow caught next tick (one hour later).
 *   - MAX_CONCURRENCY = 8 in-flight composes.
 *   - IDEMPOTENT: re-running the same UTC hour overwrites the existing
 *     row's payload with a fresh compose (same forDate, same UPSERT key).
 *
 * Auth: Bearer ${CRON_SECRET}. Disable: CRON_DAILY_BRIEFING_DISABLED=1.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { composeBrief } from '@/lib/briefing/compose';
import { shouldGenerateFor } from '@/lib/briefing/timing';
import { deliverBrief, loadDeliveryContext, getAppOrigin } from '@/lib/briefing/delivery';
import { monitorCron } from '@/lib/cron-monitor';
import { assertCanSpend, chargeWorkflow, CreditsExhaustedError } from '@/lib/billing/meter';

export const runtime = 'nodejs';

const MAX_PER_TICK = 1000;
const MAX_CONCURRENCY = 8;
const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_BRIEF_HOUR = 7;

interface CandidateRow {
  spaceId: string;
  timezone: string | null;
  briefEnabled: boolean | null;
  briefHour: number | null;
}

async function generateOne(spaceId: string, forDate: string): Promise<'ok' | 'failed'> {
  try {
    // Credit gate (no-op unless CREDITS_ENFORCED). Skip the brief if the
    // account can't afford it; charged after a successful compose below.
    try {
      await assertCanSpend(spaceId, 'daily_briefing');
    } catch (err) {
      if (err instanceof CreditsExhaustedError) return 'failed';
      throw err;
    }
    const { brief, cardMeta } = await composeBrief(spaceId);
    const { data: row, error } = await supabase
      .from('Brief')
      .upsert(
        {
          spaceId,
          forDate,
          status: 'pending',
          payload: brief,
          cardMeta,
        },
        { onConflict: 'spaceId,forDate' },
      )
      .select('id')
      .single();
    if (error) {
      console.error(`[cron/daily-briefing] upsert failed for ${spaceId}:`, error.message);
      return 'failed';
    }

    await chargeWorkflow(spaceId, 'daily_briefing');

    // Inline delivery fan-out. Wrapped in its own try/catch so a Resend
    // / Telnyx hiccup never bubbles up and fails the brief generation —
    // the brief surface itself is canon, delivery is best-effort.
    try {
      const space = await loadDeliveryContext(spaceId);
      if (space && row) {
        await deliverBrief({
          briefId: row.id as string,
          brief,
          forDate,
          space,
          appOrigin: getAppOrigin(),
        });
      }
    } catch (deliveryErr) {
      console.error(`[cron/daily-briefing] delivery failed for ${spaceId}:`, deliveryErr);
    }

    return 'ok';
  } catch (err) {
    console.error(`[cron/daily-briefing] compose failed for ${spaceId}:`, err);
    return 'failed';
  }
}

async function handler(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/daily-briefing] CRON_SECRET is not set — rejecting request');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.CRON_DAILY_BRIEFING_DISABLED) {
    console.log('[cron/daily-briefing] CRON_DAILY_BRIEFING_DISABLED is set — skipping tick');
    return NextResponse.json({ status: 'disabled' });
  }

  const startedAt = Date.now();
  const at = new Date();

  // Read every space's brief settings in one query. SpaceSetting is the
  // truth source — spaces without a settings row get the defaults.
  const { data: settings, error } = await supabase
    .from('SpaceSetting')
    .select('spaceId, timezone, briefEnabled, briefHour')
    .eq('briefEnabled', true)
    .limit(MAX_PER_TICK);

  if (error) {
    console.error('[cron/daily-briefing] settings lookup failed:', error.message);
    return NextResponse.json({ error: 'Settings lookup failed' }, { status: 500 });
  }

  if (!settings || settings.length === 0) {
    return NextResponse.json({
      status: 'no-candidates',
      atIso: at.toISOString(),
      durationMs: Date.now() - startedAt,
    });
  }

  // Filter to the spaces whose local briefHour matches the current UTC
  // tick. forDate is computed in the space's timezone so the realtor's
  // brief is keyed on their local date.
  const due: { spaceId: string; forDate: string }[] = [];
  for (const row of settings as CandidateRow[]) {
    const timezone = row.timezone ?? DEFAULT_TIMEZONE;
    const briefHour = row.briefHour ?? DEFAULT_BRIEF_HOUR;
    const forDate = shouldGenerateFor(at, timezone, briefHour);
    if (forDate) due.push({ spaceId: row.spaceId, forDate });
  }

  if (due.length === 0) {
    return NextResponse.json({
      status: 'no-due',
      atIso: at.toISOString(),
      candidates: settings.length,
      durationMs: Date.now() - startedAt,
    });
  }

  const counts = { ok: 0, failed: 0 };
  for (let i = 0; i < due.length; i += MAX_CONCURRENCY) {
    const chunk = due.slice(i, i + MAX_CONCURRENCY);
    const results = await Promise.all(chunk.map((d) => generateOne(d.spaceId, d.forDate)));
    for (const r of results) counts[r] += 1;
  }

  return NextResponse.json({
    status: 'ok',
    atIso: at.toISOString(),
    candidates: settings.length,
    due: due.length,
    succeeded: counts.ok,
    failed: counts.failed,
    durationMs: Date.now() - startedAt,
  });
}

export const GET = monitorCron('daily-briefing', { crontab: '0 * * * *' }, handler);
