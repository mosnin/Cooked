import { redirect } from 'next/navigation';
import Link from 'next/link';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { supabase } from '@/lib/supabase';
import { dealHealth, HEALTH_META } from '@/lib/deals/health';
import {
  avgTimeToCloseDays,
  conversionRate,
  stageBottlenecks,
  type DealMetricRow,
  type DealStatus,
  type StageMetricRow,
} from '@/lib/deal-metrics';
import { formatCurrency, formatCompact } from '@/lib/formatting';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_RHYTHM,
  SECTION_LABEL,
  STAT_NUMBER,
  STAT_NUMBER_COMPACT,
  CAPTION,
  META,
  CHIPPI_PILL,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import type { Metadata } from 'next';
import { ArrowUpRight } from 'lucide-react';

export const metadata: Metadata = { title: 'Revenue Forecast — Brokerage' };

// ── Types ─────────────────────────────────────────────────────────────────────

type DealRow = {
  id: string;
  spaceId: string;
  title: string;
  value: number | null;
  commissionRate: number | null;
  closeDate: string | null;
  stageId: string | null;
  status: string;
  updatedAt: string;
  stageChangedAt: string | null;
  followUpAt: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
};

type StageRow = { id: string; name: string };

// ── Forecast model ────────────────────────────────────────────────────────────
//
// Won deals this month: GCI is realized — use commissionRate on the deal if
// set; otherwise fall back to the brokerage's defaultBrokerRate (same proxy
// the brief page uses for MTD commission KPI).
//
// Active deals: projected GCI = dealGci * closingProbability, where:
//
//   closingProbability is determined by two signals in priority order:
//     1. closeDate relative to this calendar month
//     2. dealHealth state (on-track / at-risk / stuck)
//
//   Table:
//     closeDate in this month  + on-track  → 0.65
//     closeDate in this month  + at-risk   → 0.40
//     closeDate in this month  + stuck     → 0.15
//     closeDate past (overdue) + any       → 0.10  (stuck > 30 days past)
//     closeDate next month / null + on-track → 0.20
//     closeDate next month / null + at-risk  → 0.10
//     closeDate next month / null + stuck    → 0.05
//
// Commission source priority:
//   1. deal.commissionRate (set per-deal by the realtor)
//   2. brokerage.defaultBrokerRate (brokerage-wide default, ~ 2%)
//   3. Hard fallback: 0.02 (2%) — same as commissions page

function closingProbability(
  closeDate: Date | null,
  health: 'on-track' | 'at-risk' | 'stuck',
  monthStart: Date,
  monthEnd: Date,
): number {
  const now = new Date();

  if (closeDate) {
    // Overdue (past close date, deal still active)
    if (closeDate < now) {
      return health === 'stuck' ? 0.05 : 0.10;
    }
    // Closing this calendar month
    if (closeDate >= monthStart && closeDate <= monthEnd) {
      if (health === 'on-track') return 0.65;
      if (health === 'at-risk') return 0.40;
      return 0.15; // stuck
    }
  }

  // No close date or closing in a future month
  if (health === 'on-track') return 0.20;
  if (health === 'at-risk') return 0.10;
  return 0.05; // stuck
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BrokerForecastPage() {
  const ctx = await resolveBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage } = ctx;

  // Commission rate defaults — same defensive cast as commissions/page.tsx
  const b = brokerage as unknown as {
    defaultAgentRate?: number | null;
    defaultBrokerRate?: number | null;
  };
  const defaultBrokerRate =
    typeof b.defaultBrokerRate === 'number' ? b.defaultBrokerRate : 0.02;

  // Resolve all member spaces (same pattern as deals/page.tsx)
  const allMembers = await getBrokerageMembers(brokerage.id, {
    includeSpaceName: true,
  });

  const memberSpaceIds = allMembers
    .map((m) => m.Space?.id)
    .filter(Boolean) as string[];

  const ownerSpaceIds: string[] = [];
  if (memberSpaceIds.length === 0) {
    const { data: ownerSpaces } = await supabase
      .from('Space')
      .select('id')
      .eq('ownerId', brokerage.ownerId)
      .limit(10);
    ownerSpaceIds.push(
      ...((ownerSpaces ?? []).map((s: { id: string }) => s.id)),
    );
  }

  const spaceIds = [...new Set([...memberSpaceIds, ...ownerSpaceIds])];

  // Space to realtor name lookup
  const spaceToRealtor = new Map<string, string>();
  for (const m of allMembers) {
    const sid = m.Space?.id;
    if (!sid) continue;
    spaceToRealtor.set(sid, m.User?.name ?? m.User?.email ?? 'Unknown');
  }

  // Month boundaries (UTC — consistent with commissions page month grouping)
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const monthName = now.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

  if (spaceIds.length === 0) {
    return <EmptyPage brokerageName={brokerage.name} monthName={monthName} />;
  }

  // Fetch won deals this month (closedAt proxy: updatedAt on status='won',
  // same as brief page commission KPI)
  const { data: wonRaw } = await supabase
    .from('Deal')
    .select('id, spaceId, value, commissionRate, updatedAt')
    .in('spaceId', spaceIds)
    .eq('status', 'won')
    .gte('updatedAt', monthStart.toISOString())
    .lte('updatedAt', monthEnd.toISOString())
    .limit(2000);

  // Fetch active deals for projection
  const { data: activeRaw } = await supabase
    .from('Deal')
    .select(
      'id, spaceId, title, value, commissionRate, closeDate, stageId, status, updatedAt, stageChangedAt, followUpAt, nextAction, nextActionDueAt',
    )
    .in('spaceId', spaceIds)
    .eq('status', 'active')
    .order('value', { ascending: false })
    .limit(2000);

  // Fetch closed deals (won + lost, all time) for per-realtor conversion and
  // time-to-close. Read-only, scoped to the same member spaces. We pull the
  // close-metric columns (createdAt/closedAt/stageChangedAt/status/stageId) that
  // lib/deal-metrics.ts needs — these were added in the deal_close_metrics
  // migration. Active deals already live in activeRaw; we union them in below so
  // the per-realtor rollup sees the full pipeline, not just the closed tail.
  const { data: closedRaw } = await supabase
    .from('Deal')
    .select('id, spaceId, status, stageId, createdAt, closedAt, stageChangedAt')
    .in('spaceId', spaceIds)
    .in('status', ['won', 'lost'])
    .limit(4000);

  // Fetch stage names so we can display the deal's current stage
  const allStageIds = Array.from(
    new Set(
      ((activeRaw ?? []) as DealRow[])
        .map((d) => d.stageId)
        .filter(Boolean) as string[],
    ),
  );

  const { data: stagesRaw } = allStageIds.length > 0
    ? await supabase
        .from('DealStage')
        .select('id, name')
        .in('id', allStageIds)
        .limit(500)
    : { data: [] as StageRow[] };

  const stageMap = new Map(
    ((stagesRaw ?? []) as StageRow[]).map((s) => [s.id, s.name]),
  );

  // ── Won this month ─────────────────────────────────────────────────────────

  let wonGci = 0;
  let wonCount = 0;
  // Realized GCI this month, per realtor space — feeds the per-realtor rollup.
  const realizedBySpace = new Map<string, number>();
  for (const d of (wonRaw ?? []) as Array<{
    id: string;
    spaceId: string;
    value: number | null;
    commissionRate: number | null;
    updatedAt: string;
  }>) {
    const rate =
      d.commissionRate != null ? d.commissionRate / 100 : defaultBrokerRate;
    const gci = (d.value ?? 0) * rate;
    wonGci += gci;
    wonCount += 1;
    realizedBySpace.set(d.spaceId, (realizedBySpace.get(d.spaceId) ?? 0) + gci);
  }

  // ── Active deal projections ────────────────────────────────────────────────

  type ProjectedDeal = {
    id: string;
    spaceId: string;
    title: string;
    realtorName: string;
    value: number;
    gci: number;
    projectedGci: number;
    probability: number;
    health: 'on-track' | 'at-risk' | 'stuck';
    healthReason: string;
    stageLabel: string;
    closeDate: Date | null;
    closeDateLabel: string | null;
  };

  const projectedDeals: ProjectedDeal[] = [];
  let totalProjectedGci = 0;

  for (const d of (activeRaw ?? []) as DealRow[]) {
    const closeDate = d.closeDate ? new Date(d.closeDate) : null;
    const stageChangedAt = d.stageChangedAt ? new Date(d.stageChangedAt) : null;
    const updatedAt = new Date(d.updatedAt);
    const followUpAt = d.followUpAt ? new Date(d.followUpAt) : null;
    const nextActionDueAt = d.nextActionDueAt ? new Date(d.nextActionDueAt) : null;

    const healthResult = dealHealth({
      status: d.status as 'active' | 'won' | 'lost' | 'on_hold',
      stageChangedAt,
      updatedAt,
      closeDate,
      followUpAt,
      nextAction: d.nextAction,
      nextActionDueAt,
    });

    const rate =
      d.commissionRate != null ? d.commissionRate / 100 : defaultBrokerRate;
    const value = d.value ?? 0;
    const gci = value * rate;
    const prob = closingProbability(closeDate, healthResult.state, monthStart, monthEnd);
    const projectedGci = gci * prob;
    totalProjectedGci += projectedGci;

    let closeDateLabel: string | null = null;
    if (closeDate) {
      closeDateLabel = closeDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }

    const stageLabel = d.stageId ? (stageMap.get(d.stageId) ?? 'Unknown stage') : 'No stage';
    const realtorName = spaceToRealtor.get(d.spaceId) ?? 'Unknown';

    projectedDeals.push({
      id: d.id,
      spaceId: d.spaceId,
      title: d.title,
      realtorName,
      value,
      gci,
      projectedGci,
      probability: prob,
      health: healthResult.state,
      healthReason: healthResult.reason,
      stageLabel,
      closeDate,
      closeDateLabel,
    });
  }

  // Total projected = won already + weighted active
  const totalForecast = wonGci + totalProjectedGci;

  // ── Top 3 swing deals ──────────────────────────────────────────────────────
  // Criteria: highest projected GCI among deals that are either closing this
  // month OR at-risk/stuck (the deals that can be nudged to move the number).
  const swingPool = projectedDeals
    .filter((d) => {
      const closingThisMonth =
        d.closeDate !== null &&
        d.closeDate >= monthStart &&
        d.closeDate <= monthEnd;
      return closingThisMonth || d.health !== 'on-track';
    })
    .sort((a, b) => b.projectedGci - a.projectedGci)
    .slice(0, 3);

  // If we have fewer than 3 from the pool, fill from the highest-value
  // remaining active deals so there are always up to 3 shown
  if (swingPool.length < 3) {
    const poolIds = new Set(swingPool.map((d) => d.id));
    const extras = projectedDeals
      .filter((d) => !poolIds.has(d.id))
      .sort((a, b) => b.projectedGci - a.projectedGci)
      .slice(0, 3 - swingPool.length);
    swingPool.push(...extras);
  }

  const activeCount = projectedDeals.length;

  // ── Per-realtor performance context ────────────────────────────────────────
  // For each realtor space we fold together: their active deals (from
  // activeRaw) and their closed deals (from closedRaw) into DealMetricRow[],
  // then run the pure metrics. avgTimeToClose + conversion read the closed
  // tail; bottlenecks read the active set. Projected GCI sums their weighted
  // active deals; realized GCI is this-month won (realizedBySpace).
  type RealtorMetricRow = DealMetricRow & { spaceId: string };

  const metricRowsBySpace = new Map<string, RealtorMetricRow[]>();
  const pushRow = (row: RealtorMetricRow) => {
    const list = metricRowsBySpace.get(row.spaceId);
    if (list) list.push(row);
    else metricRowsBySpace.set(row.spaceId, [row]);
  };

  for (const d of (activeRaw ?? []) as DealRow[]) {
    pushRow({
      id: d.id,
      spaceId: d.spaceId,
      status: 'active',
      stageId: d.stageId ?? '',
      createdAt: d.updatedAt, // active deals don't drive time-to-close
      closedAt: null,
      stageChangedAt: d.stageChangedAt,
    });
  }
  for (const d of (closedRaw ?? []) as Array<{
    id: string;
    spaceId: string;
    status: string;
    stageId: string | null;
    createdAt: string;
    closedAt: string | null;
    stageChangedAt: string | null;
  }>) {
    pushRow({
      id: d.id,
      spaceId: d.spaceId,
      status: d.status as DealStatus,
      stageId: d.stageId ?? '',
      createdAt: d.createdAt,
      closedAt: d.closedAt,
      stageChangedAt: d.stageChangedAt,
    });
  }

  // Projected GCI per space (sum of weighted active deals).
  const projectedBySpace = new Map<string, number>();
  for (const deal of projectedDeals) {
    projectedBySpace.set(
      deal.spaceId,
      (projectedBySpace.get(deal.spaceId) ?? 0) + deal.projectedGci,
    );
  }

  type RealtorRollup = {
    spaceId: string;
    name: string;
    avgClose: number | null;
    conversion: number | null;
    projected: number;
    realized: number;
    activeCount: number;
  };

  const realtorSpaceIds = new Set<string>([
    ...metricRowsBySpace.keys(),
    ...realizedBySpace.keys(),
  ]);

  const realtorRollups: RealtorRollup[] = Array.from(realtorSpaceIds)
    .map((sid) => {
      const rows = metricRowsBySpace.get(sid) ?? [];
      const activeForSpace = rows.filter((r) => r.status === 'active').length;
      return {
        spaceId: sid,
        name: spaceToRealtor.get(sid) ?? 'Unknown',
        avgClose: avgTimeToCloseDays(rows),
        conversion: conversionRate(rows),
        projected: projectedBySpace.get(sid) ?? 0,
        realized: realizedBySpace.get(sid) ?? 0,
        activeCount: activeForSpace,
      };
    })
    // Show realtors with anything in flight or realized this month first; drop
    // dead spaces with no signal at all so the table reads as the live roster.
    .filter(
      (r) =>
        r.activeCount > 0 ||
        r.realized > 0 ||
        r.avgClose !== null ||
        r.conversion !== null,
    )
    .sort((a, b) => b.projected + b.realized - (a.projected + a.realized));

  // ── Deal bottlenecks (where deals stall) ───────────────────────────────────
  // Run across the brokerage's active deals. Stages come from the same set we
  // already resolved for the active deals' current stages.
  const bottleneckStages: StageMetricRow[] = ((stagesRaw ?? []) as StageRow[]).map(
    (s) => ({ id: s.id, name: s.name }),
  );
  const activeMetricRows: DealMetricRow[] = ((activeRaw ?? []) as DealRow[]).map(
    (d) => ({
      id: d.id,
      status: 'active',
      stageId: d.stageId ?? '',
      createdAt: d.updatedAt,
      closedAt: null,
      stageChangedAt: d.stageChangedAt,
    }),
  );
  const bottleneckReport = stageBottlenecks(
    activeMetricRows,
    bottleneckStages,
    now,
  );
  // Stages that actually hold active deals, worst-stall first.
  const stallStages = bottleneckReport.stages
    .filter((s) => s.count > 0)
    .sort((a, b) => b.avgAgeDays - a.avgAgeDays);

  // ── Status sentence ────────────────────────────────────────────────────────

  const wonLabel = formatCompact(wonGci);
  const inFlightLabel = formatCompact(totalProjectedGci);
  const forecastLabel = formatCurrency(totalForecast);

  const pace =
    totalForecast === 0
      ? 'Quiet month so far.'
      : wonGci > totalProjectedGci
        ? `On pace for ${forecastLabel} this month. ${wonLabel} already won, ${inFlightLabel} in flight.`
        : `Projected ${forecastLabel} this month. ${wonLabel} already won, ${inFlightLabel} in flight.`;

  // ── Render ─────────────────────────────────────────────────────────────────

  const hasAnything = wonCount > 0 || activeCount > 0;

  return (
    <div className={cn('max-w-5xl mx-auto pb-12', SECTION_RHYTHM)}>
      {/* Status-sentence header */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>{brokerage.name}.</p>
        <h1 className={H1} style={TITLE_FONT}>
          {monthName} revenue
        </h1>
        <p className={BODY_MUTED}>{pace}</p>
      </header>

      {!hasAnything ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">Nothing in the pipeline yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Active deals will appear here once your team adds them.
          </p>
        </div>
      ) : (
        <>
          {/* Focal projected number */}
          <section className="space-y-1">
            <p className={SECTION_LABEL}>Projected GCI, {monthName}</p>
            <p className={cn(STAT_NUMBER)} style={TITLE_FONT}>
              {formatCurrency(totalForecast)}
            </p>
            <p className={cn(CAPTION, 'tabular-nums')}>
              {activeCount} active deal{activeCount === 1 ? '' : 's'} in the model
              {defaultBrokerRate != null && (
                <> &middot; default rate {Math.round(defaultBrokerRate * 100)}%</>
              )}
            </p>
          </section>

          {/* Hairline stat strip */}
          <section
            className="grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
            aria-label="Revenue snapshot"
          >
            <div className="bg-background px-4 py-4">
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {formatCompact(wonGci)}
              </p>
              <p className={cn(CAPTION, 'mt-1')}>
                Won so far
                {wonCount > 0 && (
                  <> &middot; {wonCount} deal{wonCount === 1 ? '' : 's'}</>
                )}
              </p>
            </div>
            <div className="bg-background px-4 py-4">
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {formatCompact(totalProjectedGci)}
              </p>
              <p className={cn(CAPTION, 'mt-1')}>In flight (weighted)</p>
            </div>
            <div className="bg-background px-4 py-4">
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {formatCompact(totalForecast)}
              </p>
              <p className={cn(CAPTION, 'mt-1')}>Total projected</p>
            </div>
          </section>

          {/* The 3 deals that swing it */}
          <section>
            <div className="flex items-center gap-3 pb-3 border-b border-border/60">
              <h2 className={SECTION_LABEL}>Deals that swing it</h2>
              {swingPool.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {swingPool.length}
                </span>
              )}
            </div>

            {swingPool.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center mt-4">
                <p className="text-sm text-foreground">No deals closing or at risk this month.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Deals with a close date this month will appear here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {swingPool.map((deal) => {
                  const chippiPrompt = `What can we do to close "${deal.title}" (${deal.realtorName}) this month?`;
                  const chippiHref = `/broker?prompt=${encodeURIComponent(chippiPrompt)}`;
                  const healthMeta = HEALTH_META[deal.health];

                  return (
                    <li key={deal.id} className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        {/* Deal identity */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground truncate">
                              {deal.title}
                            </p>
                            {/* Health pill */}
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0',
                                deal.health === 'on-track' &&
                                  'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
                                deal.health === 'at-risk' &&
                                  'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
                                deal.health === 'stuck' &&
                                  'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
                              )}
                            >
                              <span
                                className={cn('w-1.5 h-1.5 rounded-full', healthMeta.dotClass)}
                              />
                              {healthMeta.label}
                              {deal.healthReason && (
                                <span className="opacity-70"> &middot; {deal.healthReason}</span>
                              )}
                            </span>
                          </div>

                          {/* Metadata row */}
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5">
                            <span className={META}>{deal.realtorName}</span>
                            <span className={META}>{deal.stageLabel}</span>
                            {deal.closeDateLabel && (
                              <span className={META}>closes {deal.closeDateLabel}</span>
                            )}
                          </div>
                        </div>

                        {/* Right side: numbers + Chippi link */}
                        <div className="flex-shrink-0 text-right space-y-1.5">
                          <p
                            className="text-[17px] leading-snug tracking-tight tabular-nums text-foreground"
                            style={TITLE_FONT}
                          >
                            {formatCompact(deal.gci)}
                          </p>
                          <p className={cn(META, 'tabular-nums')}>
                            {formatCompact(deal.value)} deal &middot; {Math.round(deal.probability * 100)}% likely
                          </p>
                          <Link
                            href={chippiHref}
                            className={cn(CHIPPI_PILL, 'h-7 px-3 text-[11px]')}
                          >
                            Ask Chippi
                            <ArrowUpRight size={11} />
                          </Link>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Per-realtor performance context */}
          <section>
            <div className="flex items-center gap-3 pb-3 border-b border-border/60">
              <h2 className={SECTION_LABEL}>By realtor</h2>
              {realtorRollups.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {realtorRollups.length}
                </span>
              )}
            </div>

            {realtorRollups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center mt-4">
                <p className="text-sm text-foreground">No realtor activity yet.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Each realtor&rsquo;s forecast and pace will appear here as deals move.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60">
                {realtorRollups.map((r) => {
                  const forecast = r.projected + r.realized;
                  return (
                    <li key={r.spaceId} className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        {/* Realtor identity + pace */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {r.name}
                          </p>
                          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5">
                            <span className={META}>
                              {r.activeCount} active deal{r.activeCount === 1 ? '' : 's'}
                            </span>
                            <span className={META}>
                              {r.conversion !== null
                                ? `${Math.round(r.conversion * 100)}% close rate`
                                : 'no close rate yet'}
                            </span>
                            <span className={META}>
                              {r.avgClose !== null
                                ? `${Math.round(r.avgClose)}d to close`
                                : 'no close history'}
                            </span>
                          </div>
                        </div>

                        {/* Right side: projected vs realized */}
                        <div className="flex-shrink-0 text-right space-y-1">
                          <p
                            className="text-[17px] leading-snug tracking-tight tabular-nums text-foreground"
                            style={TITLE_FONT}
                          >
                            {formatCompact(forecast)}
                          </p>
                          <p className={cn(META, 'tabular-nums')}>
                            {formatCompact(r.realized)} won &middot;{' '}
                            {formatCompact(r.projected)} in flight
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Where deals stall */}
          <section>
            <div className="flex items-center gap-3 pb-3 border-b border-border/60">
              <h2 className={SECTION_LABEL}>Where deals stall</h2>
              {stallStages.length > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {stallStages.length}
                </span>
              )}
            </div>

            {stallStages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center mt-4">
                <p className="text-sm text-foreground">Nothing stuck right now.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Stages holding active deals will show their average age here.
                </p>
              </div>
            ) : (
              <>
                {bottleneckReport.worstStage && (
                  <p className={cn(BODY_MUTED, 'mt-4')}>
                    Deals sit longest in{' '}
                    <span className="text-foreground font-medium">
                      {bottleneckReport.worstStage.stageName}
                    </span>
                    {' '}&middot; {Math.round(bottleneckReport.worstStage.avgAgeDays)}d on
                    average across {bottleneckReport.worstStage.count} active deal
                    {bottleneckReport.worstStage.count === 1 ? '' : 's'}.
                  </p>
                )}
                <ul className="divide-y divide-border/60 mt-4">
                  {stallStages.map((s) => (
                    <li
                      key={s.stageId}
                      className="py-3 flex items-center justify-between gap-4"
                    >
                      <span className="text-sm text-foreground truncate">
                        {s.stageName}
                      </span>
                      <div className="flex-shrink-0 flex items-center gap-3">
                        <span className={cn(META, 'tabular-nums')}>
                          {s.count} deal{s.count === 1 ? '' : 's'}
                        </span>
                        <span
                          className="text-[15px] leading-none tabular-nums text-foreground"
                          style={TITLE_FONT}
                        >
                          {Math.round(s.avgAgeDays)}d
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {/* Forecast model note */}
          <p className={cn(CAPTION, 'text-muted-foreground/70')}>
            Projected GCI = realized won deals + weighted active deals. Active deal weight is set
            by close date and health: 65% (closing this month, on track), 40% (at risk), 15%
            (stuck). Deals without a close date or closing in a future month carry 20%, 10%, or
            5% by health. Commission source: per-deal rate when set, otherwise brokerage default
            ({Math.round(defaultBrokerRate * 100)}%).
          </p>
        </>
      )}
    </div>
  );
}

// ── Empty state when brokerage has no members/spaces ─────────────────────────

function EmptyPage({
  brokerageName,
  monthName,
}: {
  brokerageName: string;
  monthName: string;
}) {
  return (
    <div className={cn('max-w-5xl mx-auto pb-12', SECTION_RHYTHM)}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>{brokerageName}.</p>
        <h1 className={H1} style={TITLE_FONT}>
          {monthName} revenue
        </h1>
        <p className={BODY_MUTED}>No active team members yet.</p>
      </header>

      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
        <p className="text-sm text-foreground">Nothing in the pipeline yet.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Invite your first realtor and their deals will appear here.
        </p>
      </div>
    </div>
  );
}
