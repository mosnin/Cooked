'use client';

/**
 * AnalyticsClient — interactive funnel + table breakdown for the brokerage
 * analytics page.
 *
 * Design rules (STYLESHEET.md):
 *   - Neutral-first: funnel bars are bg-foreground/[0.08] on bg-foreground/[0.03]
 *     track. No brand orange, no emerald/amber/violet decorative fills.
 *   - Spacing: space-y-6 (SECTION_RHYTHM) between all major blocks.
 *   - Tab indicator: framer-motion layoutId shared element (the iOS move).
 *   - Conversion numbers: tabular-nums + TITLE_FONT serif on the focal stat;
 *     muted plain text elsewhere — not badged with color.
 *   - Table "Won" column: muted, not emerald; data is data, not a status signal.
 *   - StaggerList/StaggerItem on the agent card grid so rows land in sequence.
 *   - No buyer funnel tab — buyer fields have no server data; dead UI is cut.
 */

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { SECTION_LABEL, TITLE_FONT, BODY_MUTED, CAPTION, META } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentFunnelData {
  userId: string;
  name: string;
  email: string;
  role: string;
  totalLeads: number;
  qualification: number;
  tours: number;
  applications: number;
  activeDeals: number;
  wonDeals: number;
  lostDeals: number;
  totalDeals: number;
  wonValue: number;
  leadToTour: number;
  tourToApp: number;
  appToDeal: number;
  overallConversion: number;
}

interface Props {
  agents: AgentFunnelData[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

function initials(name: string) {
  return name
    .split(/[\s@]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Neutral funnel bar ────────────────────────────────────────────────────────
//
// STYLESHEET rule: neutral-first. Every bar uses the same foreground fill
// so the shape of the funnel is the signal — not the color.

function FunnelBar({
  label,
  value,
  maxValue,
}: {
  label: string;
  value: number;
  maxValue: number;
}) {
  const pct = maxValue > 0 ? Math.max((value / maxValue) * 100, value > 0 ? 2 : 0) : 0;

  return (
    <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
      <span className={cn(CAPTION, 'text-right')}>
        {label}
      </span>
      <div className="relative h-6 rounded-sm overflow-hidden bg-foreground/[0.04]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-foreground/[0.12] transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
        <span className="absolute inset-y-0 left-2 flex items-center text-xs tabular-nums text-foreground font-medium">
          {value}
        </span>
      </div>
    </div>
  );
}

// ── Step conversion label between funnel rows ─────────────────────────────────

function StepRate({ pct }: { pct: number }) {
  return (
    <div className="pl-[calc(6rem+0.75rem)]">
      <span className={cn(META, 'tabular-nums')}>{pct}% pass-through</span>
    </div>
  );
}

// ── Agent funnel card ─────────────────────────────────────────────────────────

function AgentFunnelCard({ agent }: { agent: AgentFunnelData }) {
  const max = agent.totalLeads;

  return (
    <section className="rounded-xl border border-border/70 bg-background px-4 py-4 space-y-3">
      {/* Header row: avatar + name + focal conversion % */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center text-xs font-medium text-foreground flex-shrink-0">
          {initials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate text-foreground">{agent.name}</p>
          <p className={cn(CAPTION, 'truncate')}>{agent.role}</p>
        </div>
        {/* Focal number: serif Times, tabular-nums */}
        <div className="text-right flex-shrink-0">
          <p
            className="text-[21px] leading-tight tracking-tight tabular-nums text-foreground"
            style={TITLE_FONT}
          >
            {agent.overallConversion}%
          </p>
          <p className={CAPTION}>lead to win</p>
        </div>
      </div>

      {/* Funnel bars: neutral fills, consistent label column */}
      <div className="space-y-1.5 pt-1">
        <FunnelBar label="Leads" value={agent.totalLeads} maxValue={max} />
        <StepRate pct={agent.leadToTour} />
        <FunnelBar label="Tours" value={agent.tours} maxValue={max} />
        <StepRate pct={agent.tourToApp} />
        <FunnelBar label="Applications" value={agent.applications} maxValue={max} />
        <StepRate pct={agent.appToDeal} />
        <FunnelBar label="Deals" value={agent.totalDeals} maxValue={max} />
        <FunnelBar label="Won" value={agent.wonDeals} maxValue={max} />
      </div>

      {/* Sub-rates footer: quiet, muted */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/60">
        <div className="text-center">
          <p className="text-xs tabular-nums font-medium text-foreground">{agent.leadToTour}%</p>
          <p className={cn(CAPTION, 'mt-0.5')}>Lead to tour</p>
        </div>
        <div className="text-center">
          <p className="text-xs tabular-nums font-medium text-foreground">{agent.tourToApp}%</p>
          <p className={cn(CAPTION, 'mt-0.5')}>Tour to app</p>
        </div>
        <div className="text-center">
          <p className="text-xs tabular-nums font-medium text-foreground">{agent.appToDeal}%</p>
          <p className={cn(CAPTION, 'mt-0.5')}>App to deal</p>
        </div>
      </div>
    </section>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function AnalyticsClient({ agents }: Props) {
  const [view, setView] = useState<'funnel' | 'table'>('funnel');
  const [sortBy, setSortBy] = useState<'name' | 'leads' | 'conversion'>('leads');

  const sorted = useMemo(() => {
    const copy = [...agents];
    if (sortBy === 'name') copy.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'leads') copy.sort((a, b) => b.totalLeads - a.totalLeads);
    else if (sortBy === 'conversion') copy.sort((a, b) => b.overallConversion - a.overallConversion);
    return copy;
  }, [agents, sortBy]);

  // Team totals — computed from the full agent list (not sorted slice)
  const teamTotals = useMemo(() => {
    const t = agents.reduce(
      (acc, a) => ({
        totalLeads: acc.totalLeads + a.totalLeads,
        tours: acc.tours + a.tours,
        applications: acc.applications + a.applications,
        totalDeals: acc.totalDeals + a.totalDeals,
        wonDeals: acc.wonDeals + a.wonDeals,
        wonValue: acc.wonValue + a.wonValue,
      }),
      { totalLeads: 0, tours: 0, applications: 0, totalDeals: 0, wonDeals: 0, wonValue: 0 },
    );
    return {
      ...t,
      leadToTour: t.totalLeads > 0 ? Math.round((t.tours / t.totalLeads) * 100) : 0,
      tourToApp: t.tours > 0 ? Math.round((t.applications / t.tours) * 100) : 0,
      appToDeal: t.applications > 0 ? Math.round((t.totalDeals / t.applications) * 100) : 0,
      overallConversion: t.totalLeads > 0 ? Math.round((t.wonDeals / t.totalLeads) * 100) : 0,
    };
  }, [agents]);

  const views = [
    { id: 'funnel' as const, label: 'Funnels' },
    { id: 'table' as const, label: 'Table' },
  ];

  return (
    <div className="space-y-6">

      {/* ── Team funnel summary ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border/70 bg-background px-4 sm:px-5 py-5 space-y-4">
        <div className="flex items-end justify-between gap-4 pb-3 border-b border-border/60">
          <div className="space-y-0.5">
            <p className={SECTION_LABEL}>Team funnel</p>
            <p className={BODY_MUTED}>Rental pipeline, all agents.</p>
          </div>
          {/* Focal number for the section */}
          <div className="text-right flex-shrink-0">
            <p
              className="text-[25px] leading-tight tracking-tight tabular-nums text-foreground"
              style={TITLE_FONT}
            >
              {teamTotals.overallConversion}%
            </p>
            <p className={CAPTION}>lead to win</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <FunnelBar label="Leads" value={teamTotals.totalLeads} maxValue={teamTotals.totalLeads} />
          <StepRate pct={teamTotals.leadToTour} />
          <FunnelBar label="Tours" value={teamTotals.tours} maxValue={teamTotals.totalLeads} />
          <StepRate pct={teamTotals.tourToApp} />
          <FunnelBar label="Applications" value={teamTotals.applications} maxValue={teamTotals.totalLeads} />
          <StepRate pct={teamTotals.appToDeal} />
          <FunnelBar label="Deals" value={teamTotals.totalDeals} maxValue={teamTotals.totalLeads} />
          <FunnelBar label="Won" value={teamTotals.wonDeals} maxValue={teamTotals.totalLeads} />
        </div>
      </section>

      {/* ── View toggle + sort control ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap border-b border-border/60 pb-0">
        {/* Tab strip — framer-motion layoutId for the sliding underline */}
        <div role="tablist" aria-label="View" className="flex items-center">
          {views.map(({ id, label }) => {
            const isActive = view === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setView(id)}
                className={cn(
                  'relative inline-flex items-center px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
                {isActive && (
                  <motion.span
                    layoutId="analytics-view-underline"
                    className="absolute bottom-[-1px] left-2 right-2 h-[2px] rounded-full bg-foreground"
                    transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
                    aria-hidden
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Sort control */}
        <div className="flex items-center gap-2 pb-1">
          <label htmlFor="analytics-sort" className={SECTION_LABEL}>Sort</label>
          <select
            id="analytics-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="text-sm border border-border/70 rounded-md px-2 h-8 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-1 focus:ring-offset-background transition-colors"
          >
            <option value="leads">Leads</option>
            <option value="conversion">Conversion</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {/* ── Funnel view ─────────────────────────────────────────────────────── */}
      {view === 'funnel' && (
        sorted.length > 0 ? (
          <StaggerList key={`funnel-${sortBy}`} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sorted.map((agent) => (
              <StaggerItem key={agent.userId}>
                <AgentFunnelCard agent={agent} />
              </StaggerItem>
            ))}
          </StaggerList>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className="text-sm text-foreground">No agents with data yet.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Lead activity will appear here once realtors are active.
            </p>
          </div>
        )
      )}

      {/* ── Table view ──────────────────────────────────────────────────────── */}
      {view === 'table' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60">
                <th className={cn(SECTION_LABEL, 'text-left px-3 py-2')}>Agent</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2')}>Leads</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2')}>Tours</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2 hidden md:table-cell')}>Apps</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2')}>Deals</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2 hidden sm:table-cell')}>Won</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2 hidden lg:table-cell')}>Won value</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2')}>L to T</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2 hidden md:table-cell')}>T to A</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2 hidden md:table-cell')}>A to D</th>
                <th className={cn(SECTION_LABEL, 'text-right px-3 py-2')}>Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-10 text-center">
                    <span className={BODY_MUTED}>No agent data yet.</span>
                  </td>
                </tr>
              )}
              {sorted.map((a) => (
                <tr
                  key={a.userId}
                  className="hover:bg-foreground/[0.04] transition-colors duration-150"
                >
                  {/* Agent */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-full bg-foreground/[0.06] flex items-center justify-center text-[10px] font-medium text-foreground flex-shrink-0">
                        {initials(a.name)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate text-foreground">{a.name}</p>
                        <p className={cn(CAPTION, 'truncate')}>{a.role}</p>
                      </div>
                    </div>
                  </td>
                  {/* Volume numbers: tabular-nums, muted weight */}
                  <td className="px-3 py-3 text-right tabular-nums text-sm font-medium text-foreground">{a.totalLeads}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">{a.tours}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden md:table-cell">{a.applications}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">{a.totalDeals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden sm:table-cell">{a.wonDeals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden lg:table-cell">{formatCompact(a.wonValue)}</td>
                  {/* Rate columns */}
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">{a.leadToTour}%</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden md:table-cell">{a.tourToApp}%</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden md:table-cell">{a.appToDeal}%</td>
                  {/* Overall conversion: tabular serif, the focal data point per row */}
                  <td className="px-3 py-3 text-right">
                    <span
                      className="tabular-nums text-sm font-medium text-foreground"
                      style={TITLE_FONT}
                    >
                      {a.overallConversion}%
                    </span>
                  </td>
                </tr>
              ))}

              {/* Team totals row — quiet emphasis, foreground/[0.04] bg */}
              {sorted.length > 0 && (
                <tr className="bg-foreground/[0.04]">
                  <td className="px-3 py-3">
                    <p className={cn(SECTION_LABEL, 'pl-[calc(1.75rem+0.625rem)]')}>Team</p>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm font-medium text-foreground">{teamTotals.totalLeads}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">{teamTotals.tours}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden md:table-cell">{teamTotals.applications}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">{teamTotals.totalDeals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden sm:table-cell">{teamTotals.wonDeals}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden lg:table-cell">{formatCompact(teamTotals.wonValue)}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground">{teamTotals.leadToTour}%</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden md:table-cell">{teamTotals.tourToApp}%</td>
                  <td className="px-3 py-3 text-right tabular-nums text-sm text-muted-foreground hidden md:table-cell">{teamTotals.appToDeal}%</td>
                  <td className="px-3 py-3 text-right">
                    <span
                      className="tabular-nums text-sm font-medium text-foreground"
                      style={TITLE_FONT}
                    >
                      {teamTotals.overallConversion}%
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}
