/**
 * Brief analytics — named query functions, one per question worth
 * answering. No dashboard, no admin route, no React. A team member
 * who wants an answer imports the function from a script, runs it,
 * reads the table.
 *
 * Today's surface: four functions answering the four questions the
 * telemetry design pass landed on. Add more when a real question
 * grows that demands it.
 *
 * All functions are READ-ONLY. They never write, never mutate.
 * Pass a Supabase client (so a script can use the service-role key);
 * defaults to the app's shared client for callers inside the API tier.
 */

import { supabase as defaultClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BriefCardMeta, BriefCardTap, SignalKind, SignalSource } from './types';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function rangeBounds(rangeDays: number): { since: string; until: string } {
  const now = Date.now();
  return {
    since: new Date(now - rangeDays * MS_PER_DAY).toISOString(),
    until: new Date(now).toISOString(),
  };
}

/**
 * What fraction of generated briefs got a 'seen' event?
 *
 * Open rate = (seenAt IS NOT NULL) / total briefs in window.
 * Low rate (< 30%) signals one of: cron is delivering at wrong time;
 * realtors are turning off briefEnabled; the surface isn't being
 * rendered when realtors visit the workspace.
 */
export async function briefOpenRate(
  rangeDays = 7,
  client: SupabaseClient = defaultClient,
): Promise<{ total: number; seen: number; rate: number }> {
  const { since, until } = rangeBounds(rangeDays);
  const { data, error } = await client
    .from('Brief')
    .select('id, seenAt')
    .gte('createdAt', since)
    .lt('createdAt', until);

  if (error || !data) return { total: 0, seen: 0, rate: 0 };
  const total = data.length;
  const seen = data.filter((r) => (r as { seenAt: string | null }).seenAt != null).length;
  return { total, seen, rate: total === 0 ? 0 : seen / total };
}

/**
 * For each (source, kind) bucket: how many cards were shown, how many
 * got tapped, what's the tap rate? Drives source effectiveness and
 * confidence calibration decisions together.
 *
 * A row where (pipeline, review) shows 412 times, gets tapped 287
 * times = 70% tap rate → source is working, calibration is sane.
 * A row where (gmail, reply) shows 312 times, gets tapped 12 times
 * = 4% tap rate → source is wrong OR the threshold is too aggressive.
 */
export async function sourceTapRates(
  rangeDays = 30,
  client: SupabaseClient = defaultClient,
): Promise<
  Array<{
    source: SignalSource;
    kind: SignalKind;
    shown: number;
    tapped: number;
    rate: number;
  }>
> {
  const { since, until } = rangeBounds(rangeDays);
  const { data, error } = await client
    .from('Brief')
    .select('cardMeta, cardTaps')
    .gte('createdAt', since)
    .lt('createdAt', until);

  if (error || !data) return [];

  const buckets = new Map<string, { source: SignalSource; kind: SignalKind; shown: number; tapped: number }>();

  for (const row of data) {
    const meta = (row as { cardMeta: BriefCardMeta[] | null }).cardMeta ?? [];
    const taps = (row as { cardTaps: BriefCardTap[] | null }).cardTaps ?? [];
    const tapKeys = new Set(taps.map((t) => `${t.cardIndex}`));

    for (const m of meta) {
      const key = `${m.source}|${m.kind}`;
      const existing = buckets.get(key) ?? { source: m.source, kind: m.kind, shown: 0, tapped: 0 };
      existing.shown += 1;
      if (tapKeys.has(`${m.cardIndex}`)) existing.tapped += 1;
      buckets.set(key, existing);
    }
  }

  return [...buckets.values()]
    .map((b) => ({ ...b, rate: b.shown === 0 ? 0 : b.tapped / b.shown }))
    .sort((a, b) => b.shown - a.shown);
}

/**
 * For each (source, kind) bucket, bin by confidence decile and report
 * tap rate per decile. A sane calibration shows tap rate climbing
 * with confidence. An inverted or flat curve says the confidence
 * numbers are theater — re-tune the source.
 *
 * Returned shape: rows of (source, kind, confidenceBucket, shown,
 * tapped, rate) where confidenceBucket is the floor of confidence × 10
 * (so 0.85 → 8, 0.95 → 9, 1.0 → 10).
 */
export async function confidenceCalibration(
  rangeDays = 30,
  client: SupabaseClient = defaultClient,
): Promise<
  Array<{
    source: SignalSource;
    kind: SignalKind;
    confidenceBucket: number;
    shown: number;
    tapped: number;
    rate: number;
  }>
> {
  const { since, until } = rangeBounds(rangeDays);
  const { data, error } = await client
    .from('Brief')
    .select('cardMeta, cardTaps')
    .gte('createdAt', since)
    .lt('createdAt', until);

  if (error || !data) return [];

  const buckets = new Map<
    string,
    { source: SignalSource; kind: SignalKind; confidenceBucket: number; shown: number; tapped: number }
  >();

  for (const row of data) {
    const meta = (row as { cardMeta: BriefCardMeta[] | null }).cardMeta ?? [];
    const taps = (row as { cardTaps: BriefCardTap[] | null }).cardTaps ?? [];
    const tapKeys = new Set(taps.map((t) => `${t.cardIndex}`));

    for (const m of meta) {
      const conf = Math.min(10, Math.max(0, Math.floor(m.confidence * 10)));
      const key = `${m.source}|${m.kind}|${conf}`;
      const existing =
        buckets.get(key) ?? { source: m.source, kind: m.kind, confidenceBucket: conf, shown: 0, tapped: 0 };
      existing.shown += 1;
      if (tapKeys.has(`${m.cardIndex}`)) existing.tapped += 1;
      buckets.set(key, existing);
    }
  }

  return [...buckets.values()]
    .map((b) => ({ ...b, rate: b.shown === 0 ? 0 : b.tapped / b.shown }))
    .sort((a, b) => {
      if (a.source !== b.source) return a.source < b.source ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.confidenceBucket - b.confidenceBucket;
    });
}

/**
 * Cohort: spaces with briefEnabled=true for ≥ cohortMinDays.
 * Control: spaces with briefEnabled=false (or never enabled).
 * Outcome: cancellation rate (approximated by subscription status).
 *
 * Returns: counts and cancellation rates per cohort so the team can
 * eyeball the delta. NOT statistically significant on its own —
 * intended as a sanity check, not a hypothesis test. Real causal
 * analysis would require randomizing the default at signup, which
 * is a product decision.
 */
export async function briefRetentionDelta(
  cohortMinDays = 14,
  client: SupabaseClient = defaultClient,
): Promise<{
  enabled: { count: number; canceled: number; rate: number };
  disabled: { count: number; canceled: number; rate: number };
}> {
  const enabledThreshold = new Date(Date.now() - cohortMinDays * MS_PER_DAY).toISOString();
  const { data, error } = await client
    .from('SpaceSetting')
    .select('spaceId, briefEnabled, briefEnabledAt, Space:spaceId(stripeSubscriptionStatus)');

  if (error || !data) {
    return {
      enabled: { count: 0, canceled: 0, rate: 0 },
      disabled: { count: 0, canceled: 0, rate: 0 },
    };
  }

  type Row = {
    briefEnabled: boolean;
    briefEnabledAt: string | null;
    Space: { stripeSubscriptionStatus: string | null } | null;
  };

  let enabledCount = 0;
  let enabledCanceled = 0;
  let disabledCount = 0;
  let disabledCanceled = 0;

  for (const row of data as unknown as Row[]) {
    const status = row.Space?.stripeSubscriptionStatus ?? null;
    const isCanceled = status === 'canceled' || status === 'past_due' || status === 'unpaid';

    if (row.briefEnabled && row.briefEnabledAt && row.briefEnabledAt < enabledThreshold) {
      enabledCount += 1;
      if (isCanceled) enabledCanceled += 1;
    } else if (!row.briefEnabled) {
      disabledCount += 1;
      if (isCanceled) disabledCanceled += 1;
    }
    // Rows with briefEnabled=true but briefEnabledAt within the cohort
    // window aren't counted — they haven't had time to test the
    // hypothesis. The honest answer is to wait.
  }

  return {
    enabled: {
      count: enabledCount,
      canceled: enabledCanceled,
      rate: enabledCount === 0 ? 0 : enabledCanceled / enabledCount,
    },
    disabled: {
      count: disabledCount,
      canceled: disabledCanceled,
      rate: disabledCount === 0 ? 0 : disabledCanceled / disabledCount,
    },
  };
}
