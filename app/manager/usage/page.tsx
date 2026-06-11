/**
 * /manager/usage — Team AI spend aggregated across all member reps.
 *
 * Three sections:
 *   1. Totals strip  — total tokens, total cost, total turns (this month).
 *   2. Per-rep   — divide-y breakdown sorted by cost desc. This is the
 *                       team-specific value: who spent what.
 *   3. Per-provider  — mirrors the rep UsageSection: provider label,
 *                       total tokens, cost, cache hit rate where available.
 *
 * Scoping: all TeamMembership spaces (owner + admins + rep_members),
 * queried with .in('spaceId', spaceIds) for the current calendar month.
 *
 * Server component — no client interactivity needed. Plain server-rendered
 * rows; no chart libs added.
 */

import { redirect } from 'next/navigation';
import { getTeamMembers } from '@/lib/team-members';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { supabase } from '@/lib/supabase';
import { PROVIDER_LABELS, CACHING_PROVIDERS } from '@/lib/llm';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  CAPTION,
  META,
  SECTION_RHYTHM,
  STAT_NUMBER_COMPACT,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';
import { BarChart2 } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Usage — Team' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function providerLabel(prefix: string): string {
  return PROVIDER_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type UsageRow = {
  spaceId: string;
  provider: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
};

type ProviderRollup = {
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  cacheHitRate: number;
};

type RepRollup = {
  spaceId: string;
  name: string;
  totalTokens: number;
  costUsd: number;
  turns: number;
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ManagerUsagePage() {
  // Gate — managers and admins only.
  const ctx = await resolveManagerContext();
  if (!ctx) redirect('/');

  const { team } = ctx;

  // ── Resolve member spaces (all roles — owner pays for everyone's usage) ────
  const allMembers = await getTeamMembers(team.id, { includeSpaceName: true });

  const spaceIds = allMembers.map((m) => m.Space?.id).filter(Boolean) as string[];

  // spaceId → rep name lookup.
  const spaceToName = new Map<string, string>();
  for (const m of allMembers) {
    const name = m.User?.name ?? m.User?.email ?? 'Unknown';
    if (m.Space?.id) {
      spaceToName.set(m.Space.id, name);
    }
  }

  // ── Query ChatUsage for the current calendar month ────────────────────────
  // "This month" is the natural window a manager thinks in (billing cycles,
  // team reviews). Matches the status sentence copy below.
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();

  const { data: rawRows } = spaceIds.length > 0
    ? await supabase
        .from('ChatUsage')
        .select('spaceId, provider, promptTokens, completionTokens, cachedTokens, costUsd')
        .in('spaceId', spaceIds)
        .gte('createdAt', monthStart)
    : { data: [] as UsageRow[] };

  const rows = (rawRows ?? []) as UsageRow[];

  // ── Aggregation pass — one loop over raw rows ─────────────────────────────
  let totalTokens = 0;
  let totalCost = 0;
  let totalTurns = 0;

  const repMap = new Map<string, RepRollup>();
  const providerMap = new Map<string, ProviderRollup>();

  for (const r of rows) {
    const provider = r.provider ?? 'unknown';
    if (provider === 'unknown') continue; // skip legacy pre-Phase-2 rows

    const input = r.promptTokens ?? 0;
    const output = r.completionTokens ?? 0;
    const cached = r.cachedTokens ?? 0;
    const cost = Number(r.costUsd ?? 0);
    const tokens = input + output;

    totalTokens += tokens;
    totalCost += cost;
    totalTurns += 1;

    // Per-rep rollup
    const existing = repMap.get(r.spaceId) ?? {
      spaceId: r.spaceId,
      name: spaceToName.get(r.spaceId) ?? 'Unknown',
      totalTokens: 0,
      costUsd: 0,
      turns: 0,
    };
    existing.totalTokens += tokens;
    existing.costUsd += cost;
    existing.turns += 1;
    repMap.set(r.spaceId, existing);

    // Per-provider rollup
    const ep = providerMap.get(provider) ?? {
      provider,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      cacheHitRate: 0,
    };
    ep.inputTokens += input;
    ep.outputTokens += output;
    ep.cachedTokens += cached;
    ep.costUsd += cost;
    providerMap.set(provider, ep);
  }

  // Compute per-provider cache hit rates and sort by spend desc.
  const providers: ProviderRollup[] = [];
  for (const p of providerMap.values()) {
    p.cacheHitRate = p.inputTokens > 0
      ? Math.round((p.cachedTokens / p.inputTokens) * 100)
      : 0;
    providers.push(p);
  }
  providers.sort((a, b) => b.costUsd - a.costUsd);

  // Sort reps by cost desc.
  const reps: RepRollup[] = Array.from(repMap.values()).sort(
    (a, b) => b.costUsd - a.costUsd,
  );

  // ── Status sentence ────────────────────────────────────────────────────────
  const monthName = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

  const statusSentence = (() => {
    if (rows.length === 0) return `No Koala usage recorded for ${monthName} yet.`;
    const parts: string[] = [];
    parts.push(`${fmtCost(totalCost)} spent across ${reps.length} ${reps.length === 1 ? 'rep' : 'reps'}`);
    parts.push(`${totalTurns.toLocaleString()} ${totalTurns === 1 ? 'turn' : 'turns'} this month`);
    return parts.join(' · ') + '.';
  })();

  const isEmpty = rows.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={cn('max-w-5xl mx-auto pb-56 md:pb-24', SECTION_RHYTHM)}>

      {/* Status-sentence header — per STYLESHEET §The status-sentence pattern */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Team.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Usage
        </h1>
        <p className={BODY_MUTED}>{statusSentence}</p>
      </header>

      {isEmpty ? (
        /* Empty state — dashed-border house style per STYLESHEET §Empty states */
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <div className="flex justify-center mb-3">
            <BarChart2 size={24} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm text-foreground">No usage yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Koala activity across your member reps will appear here.
          </p>
        </div>
      ) : (
        <div className={SECTION_RHYTHM}>

          {/* ── Totals strip — hairline-divider grid per STYLESHEET §Surfaces ── */}
          <section
            className="grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
            aria-label="This month's totals"
          >
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Total tokens</p>
              <p className={cn(STAT_NUMBER_COMPACT, 'tabular-nums')} style={TITLE_FONT}>
                {fmtTokens(totalTokens)}
              </p>
            </div>
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Total cost</p>
              <p className={cn(STAT_NUMBER_COMPACT, 'tabular-nums')} style={TITLE_FONT}>
                {fmtCost(totalCost)}
              </p>
            </div>
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Turns</p>
              <p className={cn(STAT_NUMBER_COMPACT, 'tabular-nums')} style={TITLE_FONT}>
                {totalTurns.toLocaleString()}
              </p>
            </div>
          </section>

          {/* ── Per-rep breakdown ───────────────────────────────────────── */}
          <section className="space-y-3">
            <p className={SECTION_LABEL}>By rep</p>

            {/* Column header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 items-center px-1 pb-1">
              <p className={SECTION_LABEL}>Rep</p>
              <p className={cn(SECTION_LABEL, 'w-20 text-right')}>Tokens</p>
              <p className={cn(SECTION_LABEL, 'w-16 text-right')}>Cost</p>
              <p className={cn(SECTION_LABEL, 'w-14 text-right')}>Turns</p>
            </div>

            <StaggerList className="divide-y divide-border/60">
              {reps.map((r) => (
                <StaggerItem key={r.spaceId}>
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 items-center py-3 px-1 transition-colors duration-150 hover:bg-foreground/[0.04]">
                    {/* Rep name */}
                    <p className="text-sm text-foreground truncate">{r.name}</p>

                    {/* Tokens */}
                    <p className={cn('text-sm tabular-nums text-muted-foreground w-20 text-right')}>
                      {fmtTokens(r.totalTokens)}
                    </p>

                    {/* Cost */}
                    <p
                      className="text-sm tabular-nums text-foreground font-medium w-16 text-right"
                      style={TITLE_FONT}
                    >
                      {fmtCost(r.costUsd)}
                    </p>

                    {/* Turns */}
                    <p className={cn(CAPTION, 'tabular-nums w-14 text-right')}>
                      {r.turns.toLocaleString()}
                    </p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerList>

            <p className={cn(META, 'text-right pt-1')}>
              {reps.length} {reps.length === 1 ? 'rep' : 'reps'} · {monthName}
            </p>
          </section>

          {/* ── Per-provider breakdown — mirrors UsageSection ──────────────── */}
          {providers.length > 0 && (
            <section className="space-y-3 border-t border-border/60 pt-5">
              <p className={SECTION_LABEL}>By provider</p>

              <ul className="divide-y divide-border/60">
                {providers.map((p) => (
                  <li
                    key={p.provider}
                    className="py-3 px-1 flex items-center justify-between gap-4 transition-colors duration-150 hover:bg-foreground/[0.04]"
                  >
                    {/* Provider name */}
                    <p className="text-sm text-foreground min-w-[120px]">
                      {providerLabel(p.provider)}
                    </p>

                    {/* Token count + cache hit rate (right side) */}
                    <div className="flex items-baseline gap-x-4 flex-wrap justify-end">
                      <p className={cn(CAPTION, 'tabular-nums')}>
                        {fmtTokens(p.inputTokens + p.outputTokens)} tokens
                      </p>

                      {CACHING_PROVIDERS.has(p.provider) && (
                        <p className={cn(CAPTION, 'tabular-nums')}>
                          {p.cacheHitRate}% cached
                        </p>
                      )}

                      <p
                        className="text-sm tabular-nums text-foreground font-medium"
                        style={TITLE_FONT}
                      >
                        {fmtCost(p.costUsd)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
