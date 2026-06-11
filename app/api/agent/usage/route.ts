/**
 * GET /api/agent/usage
 *
 * Returns today's token usage for the space plus Phase 2 caching
 * telemetry — cache hit rate and a per-provider breakdown — so the
 * Settings → Usage surface can show whether prompt caching is actually
 * paying off. Reads the shared helper `lib/usage/today-token-usage.ts`
 * for the daily-budget total so display and chat-budget enforcement
 * cannot drift apart.
 *
 * The per-provider breakdown comes from the last 7 days of ChatUsage
 * rows — one day is too noisy (a single big turn distorts everything),
 * 30 days hides recent regressions. Seven days is the trailing window
 * the realtor mentally lives in.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { getTodayTokenUsage } from '@/lib/usage/today-token-usage';

interface ProviderRollup {
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitRate: number;
}

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { total: used } = await getTodayTokenUsage(space.id);

  const { data: agentSettings } = await supabase
    .from('AgentSettings')
    .select('dailyTokenBudget')
    .eq('spaceId', space.id)
    .maybeSingle();

  const limit = (agentSettings?.dailyTokenBudget as number | null) ?? 50_000;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  // Reset time: midnight UTC today
  const now = new Date();
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

  // ── Phase 2 cache telemetry — last 7 days, per provider. ───────────────
  // Pre-Phase-2 rows have provider='unknown' and cachedTokens=0; we filter
  // them out of the breakdown so legacy mass doesn't drag the rates down.
  // The overall hit rate sums cached and input across rows the provider
  // could have served from cache.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: usageRows } = await supabase
    .from('ChatUsage')
    .select('provider, promptTokens, completionTokens, cachedTokens')
    .eq('spaceId', space.id)
    .gte('createdAt', sevenDaysAgo);

  const providerMap = new Map<string, ProviderRollup>();
  let totalInput = 0;
  let totalCached = 0;
  for (const row of usageRows ?? []) {
    const r = row as {
      provider: string | null;
      promptTokens: number | null;
      completionTokens: number | null;
      cachedTokens: number | null;
    };
    const provider = r.provider ?? 'unknown';
    if (provider === 'unknown') continue; // legacy rows
    const inputTokens = r.promptTokens ?? 0;
    const outputTokens = r.completionTokens ?? 0;
    const cachedTokens = r.cachedTokens ?? 0;
    totalInput += inputTokens;
    totalCached += cachedTokens;
    const existing = providerMap.get(provider) ?? {
      provider,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheHitRate: 0,
    };
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.cachedTokens += cachedTokens;
    providerMap.set(provider, existing);
  }

  const providers: ProviderRollup[] = [];
  for (const r of providerMap.values()) {
    r.cacheHitRate = r.inputTokens > 0
      ? Math.round((r.cachedTokens / r.inputTokens) * 100)
      : 0;
    providers.push(r);
  }
  // Largest spend first — the realtor's eye lands on what matters.
  providers.sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens));

  const cacheHitRate = totalInput > 0
    ? Math.round((totalCached / totalInput) * 100)
    : 0;

  return NextResponse.json({
    used,
    limit,
    pct,
    resetsAt,
    cacheHitRate,
    cachedTokens: totalCached,
    inputTokens: totalInput,
    providers,
  });
}
