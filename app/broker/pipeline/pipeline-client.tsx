'use client';

import { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
} from 'lucide-react';
import { formatCompact } from '@/lib/formatting';
import { SECTION_LABEL, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export type PipelineDeal = {
  id: string;
  title: string;
  value: number | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  closeDate: string | null;
  status: 'active' | 'won' | 'lost' | 'on_hold';
  stageName: string;
  stageColor: string;
  agentName: string;
  agentUserId: string;
  createdAt: string;
  /**
   * Health classification from lib/deals/health.ts. Non-active deals
   * always land as 'on-track' — the classifier treats closed deals as
   * out-of-scope for risk tracking.
   */
  health: 'on-track' | 'at-risk' | 'stuck';
  /** Short human reason, e.g. "18 days in this stage". Empty for on-track. */
  healthReason: string;
};

export type StageInfo = {
  name: string;
  color: string;
  position: number;
};

export type RealtorInfo = {
  userId: string;
  name: string;
};

export type PipelineSummary = {
  totalPipelineValue: number;
  activeDeals: number;
  dealsWonThisMonth: number;
  dealsLostThisMonth: number;
  atRiskCount: number;
  stuckCount: number;
  /** Per-agent rollup, sorted most-stuck first. Empty when no risks. */
  agentRisk: Array<{ agentName: string; atRisk: number; stuck: number }>;
};

type Props = {
  deals: PipelineDeal[];
  stages: StageInfo[];
  realtors: RealtorInfo[];
  summary: PipelineSummary;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const priorityTone: Record<string, string> = {
  HIGH: 'text-rose-700 dark:text-rose-400',
  MEDIUM: 'text-amber-700 dark:text-amber-400',
  LOW: 'text-muted-foreground',
};

const statusTone: Record<string, string> = {
  active: 'text-foreground',
  won: 'text-emerald-700 dark:text-emerald-400',
  lost: 'text-rose-700 dark:text-rose-400',
  on_hold: 'text-muted-foreground',
};

const statusLabels: Record<string, string> = {
  active: 'Active',
  won: 'Won',
  lost: 'Lost',
  on_hold: 'On hold',
};

// ── Component ────────────────────────────────────────────────────────────────

export function PipelineClient({ deals, stages, realtors, summary }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [realtorFilter, setRealtorFilter] = useState<string>('all');
  const [expandedRealtors, setExpandedRealtors] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<'value' | 'closeDate' | 'createdAt'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);

  // Filtered deals
  const filteredDeals = useMemo(() => {
    return deals.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (realtorFilter !== 'all' && d.agentUserId !== realtorFilter) return false;
      return true;
    });
  }, [deals, statusFilter, realtorFilter]);

  // Sorted deals
  const sortedDeals = useMemo(() => {
    return [...filteredDeals].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'value') {
        cmp = (a.value ?? 0) - (b.value ?? 0);
      } else if (sortField === 'closeDate') {
        const da = a.closeDate ? new Date(a.closeDate).getTime() : 0;
        const db = b.closeDate ? new Date(b.closeDate).getTime() : 0;
        cmp = da - db;
      } else {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [filteredDeals, sortField, sortAsc]);

  // Pipeline by stage (across all agents)
  const stageAggregates = useMemo(() => {
    const counts = new Map<string, { count: number; value: number }>();
    for (const d of filteredDeals) {
      const prev = counts.get(d.stageName) ?? { count: 0, value: 0 };
      counts.set(d.stageName, {
        count: prev.count + 1,
        value: prev.value + (d.value ?? 0),
      });
    }
    return stages.map((s) => ({
      ...s,
      count: counts.get(s.name)?.count ?? 0,
      value: counts.get(s.name)?.value ?? 0,
    }));
  }, [filteredDeals, stages]);

  const maxStageCount = Math.max(...stageAggregates.map((s) => s.count), 1);

  // Per-agent breakdown
  const agentGroups = useMemo(() => {
    const map = new Map<string, { name: string; deals: PipelineDeal[] }>();
    for (const r of realtors) {
      map.set(r.userId, { name: r.name, deals: [] });
    }
    for (const d of filteredDeals) {
      const group = map.get(d.agentUserId);
      if (group) group.deals.push(d);
    }
    return Array.from(map.entries())
      .map(([userId, data]) => ({ userId, ...data }))
      .sort((a, b) => b.deals.length - a.deals.length);
  }, [filteredDeals, realtors]);

  function toggleRealtor(userId: string) {
    setExpandedRealtors((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function handleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  return (
    <div className="space-y-10">
      {/* ── Snapshot — four numbers, paper-flat hairline grid. Mirrors */}
      {/* the broker home commission grid: gap-px on a border-bg makes  */}
      {/* the dividers themselves the structure. */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/70 bg-border/60">
        {[
          { label: 'Pipeline', value: formatCompact(summary.totalPipelineValue), foot: `${summary.activeDeals} active ${summary.activeDeals === 1 ? 'deal' : 'deals'}` },
          { label: 'Active', value: String(summary.activeDeals), foot: 'in flight right now' },
          { label: 'Won this month', value: String(summary.dealsWonThisMonth), foot: summary.dealsWonThisMonth === 1 ? 'deal closed' : 'deals closed' },
          { label: 'Lost this month', value: String(summary.dealsLostThisMonth), foot: summary.dealsLostThisMonth === 1 ? 'deal lost' : 'deals lost' },
        ].map(({ label, value, foot }) => (
          <div key={label} className="bg-background px-4 py-4">
            <p className={SECTION_LABEL}>{label}</p>
            <p
              className="text-[25px] leading-tight tracking-tight tabular-nums mt-1.5 text-foreground"
              style={TITLE_FONT}
            >
              {value}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">{foot}</p>
          </div>
        ))}
      </section>

      {/* ── Risk strip. Paper-flat, hairline. Meaning still comes through */}
      {/* the rose / amber dots — no heavy card chrome. */}
      {summary.atRiskCount === 0 && summary.stuckCount === 0 && summary.activeDeals > 0 && (
        <section className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3 flex items-start gap-3">
          <span className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">Everything&apos;s healthy.</p>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Nothing stuck or at risk across {summary.activeDeals} active deal
              {summary.activeDeals === 1 ? '' : 's'}.
            </p>
          </div>
        </section>
      )}
      {(summary.atRiskCount > 0 || summary.stuckCount > 0) && (
        <section className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3.5 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-medium">Needs your attention.</p>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                {summary.stuckCount > 0 && (
                  <>
                    <span className="font-medium text-rose-700 dark:text-rose-400 tabular-nums">{summary.stuckCount}</span>{' '}
                    stuck
                  </>
                )}
                {summary.stuckCount > 0 && summary.atRiskCount > 0 && <span> · </span>}
                {summary.atRiskCount > 0 && (
                  <>
                    <span className="font-medium text-amber-700 dark:text-amber-400 tabular-nums">{summary.atRiskCount}</span>{' '}
                    at risk
                  </>
                )}
              </p>
            </div>
          </div>
          {summary.agentRisk.length > 0 && (
            <ul className="divide-y divide-border/60 -mx-4 px-4">
              {summary.agentRisk.slice(0, 6).map((row) => (
                <li
                  key={row.agentName}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm"
                >
                  <span className="truncate min-w-0">{row.agentName}</span>
                  <span className="flex items-center gap-3 flex-shrink-0 text-[13px] tabular-nums">
                    {row.stuck > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-rose-700 dark:text-rose-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        {row.stuck} stuck
                      </span>
                    )}
                    {row.atRisk > 0 && (
                      <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {row.atRisk} at risk
                      </span>
                    )}
                  </span>
                </li>
              ))}
              {summary.agentRisk.length > 6 && (
                <li className="py-2 text-[11px] text-muted-foreground">
                  +{summary.agentRisk.length - 6} more
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {/* ── Filter strip. Paper-flat row, no card. */}
      <section className="flex flex-wrap items-center gap-4 pb-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <label htmlFor="pipeline-status" className={SECTION_LABEL}>Status</label>
          <select
            id="pipeline-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-border/70 rounded-md px-2 h-8 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
            <option value="on_hold">On hold</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="pipeline-agent" className={SECTION_LABEL}>Agent</label>
          <select
            id="pipeline-agent"
            value={realtorFilter}
            onChange={(e) => setRealtorFilter(e.target.value)}
            className="text-sm border border-border/70 rounded-md px-2 h-8 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All agents</option>
            {realtors.map((r) => (
              <option key={r.userId} value={r.userId}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <p className={cn(BODY_MUTED, 'ml-auto text-[13px] tabular-nums')}>
          {filteredDeals.length} {filteredDeals.length === 1 ? 'deal' : 'deals'}
        </p>
      </section>

      {/* ── Pipeline by stage — hairline section, no card chrome. */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>Pipeline by stage</h2>
        </div>

        {stageAggregates.length === 0 ? (
          <DashedEmpty>No stages yet.</DashedEmpty>
        ) : (
          <ul className="divide-y divide-border/60">
            {stageAggregates.map((stage) => (
              <li key={stage.name} className="py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: stage.color }}
                      aria-hidden
                    />
                    <span className="text-sm font-medium truncate">{stage.name}</span>
                  </div>
                  <div className="text-right flex items-baseline gap-2 flex-shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{stage.count}</span>
                    {stage.value > 0 && (
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatCompact(stage.value)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(stage.count > 0 ? 4 : 0, (stage.count / maxStageCount) * 100)}%`,
                      backgroundColor: stage.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Per-agent breakdown — hairline-divided rows. */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>By agent</h2>
        </div>

        {agentGroups.length === 0 ? (
          <DashedEmpty>No realtors yet.</DashedEmpty>
        ) : (
          <ul className="divide-y divide-border/60">
            {agentGroups.map((agent) => {
              const isExpanded = expandedRealtors.has(agent.userId);
              const agentValue = agent.deals.reduce((s, d) => s + (d.value ?? 0), 0);
              const agentActive = agent.deals.filter((d) => d.status === 'active').length;
              const agentWon = agent.deals.filter((d) => d.status === 'won').length;

              return (
                <li key={agent.userId}>
                  <button
                    onClick={() => toggleRealtor(agent.userId)}
                    aria-expanded={isExpanded}
                    className="w-full flex items-center gap-3 py-3 text-left hover:bg-foreground/[0.04] transition-colors rounded-md -mx-2 px-2"
                  >
                    {isExpanded ? (
                      <ChevronDown size={13} className="text-muted-foreground flex-shrink-0" />
                    ) : (
                      <ChevronRight size={13} className="text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="w-7 h-7 rounded-full bg-foreground/[0.06] flex items-center justify-center font-semibold text-xs text-foreground flex-shrink-0">
                      {agent.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{agent.name}</p>
                    </div>
                    <div className="hidden sm:flex items-center gap-4 text-[13px] text-muted-foreground flex-shrink-0 tabular-nums">
                      <span>{agent.deals.length} {agent.deals.length === 1 ? 'deal' : 'deals'}</span>
                      <span>{agentActive} active</span>
                      <span className="text-emerald-700 dark:text-emerald-400">{agentWon} won</span>
                      {agentValue > 0 && (
                        <span className="font-semibold text-foreground">
                          {formatCompact(agentValue)}
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && agent.deals.length > 0 && (
                    <div className="pb-3">
                      <div className="overflow-x-auto -mx-2">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/60">
                              <th className="text-left px-2 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Title</th>
                              <th className="text-left px-2 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Stage</th>
                              <th className="text-right px-2 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Value</th>
                              <th className="text-left px-2 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Priority</th>
                              <th className="text-left px-2 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Status</th>
                              <th className="text-right px-2 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Close</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {agent.deals.map((deal) => (
                              <tr key={deal.id} className="hover:bg-foreground/[0.04] transition-colors">
                                <td className="px-2 py-2.5 font-medium max-w-[220px]">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <HealthDot health={deal.health} reason={deal.healthReason} />
                                    <span className="truncate">{deal.title}</span>
                                  </div>
                                </td>
                                <td className="px-2 py-2.5">
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                      style={{ backgroundColor: deal.stageColor }}
                                    />
                                    <span className="text-[13px]">{deal.stageName}</span>
                                  </div>
                                </td>
                                <td className="px-2 py-2.5 text-right tabular-nums">
                                  {deal.value != null ? formatCurrency(deal.value) : '—'}
                                </td>
                                <td className={cn('px-2 py-2.5 text-[13px]', priorityTone[deal.priority] ?? '')}>
                                  {deal.priority.charAt(0) + deal.priority.slice(1).toLowerCase()}
                                </td>
                                <td className={cn('px-2 py-2.5 text-[13px]', statusTone[deal.status] ?? '')}>
                                  {statusLabels[deal.status] ?? deal.status}
                                </td>
                                <td className="px-2 py-2.5 text-right text-[13px] text-muted-foreground">
                                  {formatDate(deal.closeDate)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── All deals — hairline-divided rows. */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>All deals</h2>
        </div>

        {sortedDeals.length === 0 ? (
          <DashedEmpty>No deals match these filters.</DashedEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Title</th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Agent</th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Stage</th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                    <button
                      onClick={() => handleSort('value')}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Value
                      <ArrowUpDown size={10} />
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Priority</th>
                  <th className="text-left px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">Status</th>
                  <th className="text-right px-3 py-2 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                    <button
                      onClick={() => handleSort('closeDate')}
                      className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Close
                      <ArrowUpDown size={10} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {sortedDeals.map((deal) => (
                  <tr key={deal.id} className="hover:bg-foreground/[0.04] transition-colors">
                    <td className="px-3 py-3 font-medium max-w-[240px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <HealthDot health={deal.health} reason={deal.healthReason} />
                        <span className="truncate">{deal.title}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{deal.agentName}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: deal.stageColor }}
                        />
                        <span className="text-[13px]">{deal.stageName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {deal.value != null ? formatCurrency(deal.value) : '—'}
                    </td>
                    <td className={cn('px-3 py-3 text-[13px]', priorityTone[deal.priority] ?? '')}>
                      {deal.priority.charAt(0) + deal.priority.slice(1).toLowerCase()}
                    </td>
                    <td className={cn('px-3 py-3 text-[13px]', statusTone[deal.status] ?? '')}>
                      {statusLabels[deal.status] ?? deal.status}
                    </td>
                    <td className="px-3 py-3 text-right text-[13px] text-muted-foreground">
                      {formatDate(deal.closeDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Canonical dashed empty container — matches the broker home placeholder
 * vocabulary. Keep the copy first-person so Chippi stays the narrator.
 */
function DashedEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
      <p className={cn(BODY_MUTED, 'text-[13px]')}>{children}</p>
    </div>
  );
}

/**
 * Indicator next to a deal title for its health state.
 *
 * On-track renders nothing (visual noise at 50+ deals). At-risk and stuck
 * use BOTH colour and shape so the signal survives red/green colourblind
 * vision — at 2px, tint alone was indistinguishable (audit finding):
 *   - at-risk → filled amber dot (3x3).
 *   - stuck   → filled rose dot (3x3) with a visible ring so the outline
 *               reads even in monochrome.
 */
function HealthDot({ health, reason }: { health: PipelineDeal['health']; reason: string }) {
  if (health === 'on-track') return null;
  const isStuck = health === 'stuck';
  const colorClass = isStuck
    ? 'bg-rose-500 ring-2 ring-rose-300 dark:ring-rose-900'
    : 'bg-amber-500';
  const label = isStuck ? 'Stuck' : 'At risk';
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${colorClass}`}
      title={reason ? `${label} — ${reason}` : label}
      aria-label={reason ? `${label}: ${reason}` : label}
    />
  );
}
