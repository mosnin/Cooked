'use client';

/**
 * Usage — how much of Chippi's daily budget is spent, and how much of
 * Chippi's input is being served from the provider prompt cache.
 *
 * Two questions the realtor cares about:
 *   1. Do I have room left today?  → today's % of the daily budget
 *   2. Is Chippi caching well?     → 7-day cache hit rate + per-provider chips
 *
 * No cost dollar amount, no per-tool breakdown. If the realtor needs the
 * deeper picture they can go to Developer → Usage. This is the calm view.
 *
 * Reads /api/agent/usage.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { BODY_MUTED, CAPTION, STAT_NUMBER, TITLE_FONT } from '@/lib/typography';
import { CACHING_PROVIDERS, PROVIDER_LABELS } from '@/lib/llm';

interface ProviderRollup {
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheHitRate: number;
}

interface UsageData {
  used: number;
  limit: number;
  pct: number;
  resetsAt: string;
  cacheHitRate: number;
  cachedTokens: number;
  inputTokens: number;
  providers: ProviderRollup[];
}

function resetLine(resetsAt: string): string {
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'Resets soon.';
  const hours = Math.round(ms / 3_600_000);
  if (hours < 1) return 'Resets within the hour.';
  if (hours === 1) return 'Resets in 1 hour.';
  return `Resets in ${hours} hours.`;
}

function providerLabel(prefix: string): string {
  return PROVIDER_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

/**
 * Returns the Chippi-voice nudge when a CACHING-capable provider is below
 * 30% hit rate — implies the prefix isn't stabilizing yet (fresh workspace,
 * model just switched, prompt drift). Returns null when every cache-
 * capable provider is above the threshold OR the realtor only uses non-
 * caching providers (no point nudging about a cache the provider doesn't
 * offer).
 */
function cacheNudge(providers: ProviderRollup[]): string | null {
  const low = providers.find(
    (p) => CACHING_PROVIDERS.has(p.provider) && p.inputTokens > 1000 && p.cacheHitRate < 30,
  );
  if (!low) return null;
  return "I'll cache more of my context as we work together.";
}

export function UsageSection() {
  const [data, setData] = useState<UsageData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/agent/usage');
        if (!res.ok) throw new Error('usage fetch failed');
        const json = (await res.json()) as UsageData;
        if (active) {
          setData(json);
          setState('ready');
        }
      } catch {
        if (active) setState('error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const pct = data ? Math.max(0, Math.min(100, Math.round(data.pct))) : 0;
  const showCacheBlock = Boolean(data && data.inputTokens > 0);
  const nudge = data ? cacheNudge(data.providers) : null;

  return (
    <div className="space-y-6">
      <p className={BODY_MUTED}>How much of Chippi&apos;s daily budget is spent.</p>

      {state === 'loading' && <p className={CAPTION}>Checking usage…</p>}

      {state === 'error' && (
        <p className={CAPTION}>Couldn&apos;t load usage right now — usually temporary.</p>
      )}

      {state === 'ready' && data && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className={STAT_NUMBER} style={TITLE_FONT}>
                {pct}%
              </p>
              <p className={CAPTION}>{resetLine(data.resetsAt)}</p>
            </div>

            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Daily budget used"
            >
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${pct}%` }}
              />
            </div>

            <p className={cn(CAPTION, 'tabular-nums')}>
              {data.used.toLocaleString()} of {data.limit.toLocaleString()} tokens used today.
            </p>
          </div>

          {showCacheBlock && (
            <div className="space-y-3 border-t border-border/60 pt-5">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className={STAT_NUMBER} style={TITLE_FONT}>
                    {data.cacheHitRate}%
                  </p>
                  <p className={CAPTION}>Cache hit rate over the last 7 days.</p>
                </div>
                <p className={cn(CAPTION, 'tabular-nums')}>
                  {data.cachedTokens.toLocaleString()} of {data.inputTokens.toLocaleString()} input
                  tokens cached.
                </p>
              </div>

              {data.providers.length > 1 && (
                <ul className="space-y-1.5 pt-1">
                  {data.providers.map((p) => (
                    <li
                      key={p.provider}
                      className={cn(CAPTION, 'tabular-nums flex items-baseline gap-x-2')}
                    >
                      <span className="text-foreground">{providerLabel(p.provider)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {(p.inputTokens + p.outputTokens).toLocaleString()} tokens
                      </span>
                      {CACHING_PROVIDERS.has(p.provider) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{p.cacheHitRate}% cached</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {nudge && <p className={CAPTION}>{nudge}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
