/**
 * Studio spend caps.
 *
 * The StudioGeneration table records `costUsd` on every row, but until now
 * nothing summed those costs into a usable signal. Per-user rate limits
 * (60 generations/hour) bounded throughput but not spend — at the most
 * expensive model ($0.50/call, e.g. seedance-video), a runaway agent or
 * compromised realtor account could burn $30/hour, $720/day, with zero
 * automated guard.
 *
 * This module owns the per-space daily cap. Both /api/studio/generate
 * and /api/studio/edit (plus the internal Modal-facing twins) call
 * `assertStudioSpendBudget` before running the model; if today's
 * spend ≥ the cap, the request is rejected before fal.ai is called.
 *
 * Cap is a single env-tunable knob (STUDIO_DAILY_SPEND_CAP_USD), default
 * $50/day per space — generous for a real working realtor, hard ceiling
 * on the abuse path. Set higher in env when a power user complains;
 * never silently expand it from code.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const DEFAULT_CAP_USD = 50;

function getCapUsd(): number {
  const raw = process.env.STUDIO_DAILY_SPEND_CAP_USD;
  if (!raw) return DEFAULT_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CAP_USD;
  return parsed;
}

/**
 * Sum StudioGeneration.costUsd for the given space over the last 24
 * hours. Best-effort: a DB hiccup logs a warning and returns 0 (we'd
 * rather let a generation through than block a paying realtor on a
 * transient outage). The rate limiter still bounds throughput.
 */
export async function getStudioSpendToday(spaceId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('StudioGeneration')
    .select('costUsd')
    .eq('spaceId', spaceId)
    .gte('createdAt', since);
  if (error) {
    logger.warn('[studio.spend] today-spend query failed — allowing', { spaceId }, error);
    return 0;
  }
  let total = 0;
  for (const row of (data ?? []) as { costUsd: number | string | null }[]) {
    const v = typeof row.costUsd === 'string' ? Number(row.costUsd) : row.costUsd;
    if (typeof v === 'number' && Number.isFinite(v)) total += v;
  }
  return total;
}

export interface SpendBudgetResult {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
}

/**
 * Check whether a space has any remaining Studio budget for the day.
 * Returns a structured result the caller can shape into a 429 with
 * useful copy ("you've used $48.30 of your $50 daily limit"). Never
 * throws — a DB failure returns allowed:true for graceful degradation.
 */
export async function checkStudioSpendBudget(spaceId: string): Promise<SpendBudgetResult> {
  const capUsd = getCapUsd();
  const spentUsd = await getStudioSpendToday(spaceId);
  return {
    allowed: spentUsd < capUsd,
    spentUsd,
    capUsd,
  };
}
