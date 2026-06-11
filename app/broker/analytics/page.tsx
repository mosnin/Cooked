/**
 * /broker/analytics -- Brokerage conversion funnel + per-agent breakdown.
 *
 * Shows the rental-funnel metrics aggregated across all member spaces.
 * Gated with resolveBrokerContext() (broker_owner + broker_admin only).
 *
 * Structure:
 *   1. Status-sentence header (muted greeting -> serif h1 -> headline stat).
 *   2. Hairline-divider KPI strip (leads, won, pipeline value, team conversion).
 *   3. Client component: lead-type tab, team funnel, agent breakdown.
 */

import { redirect } from 'next/navigation';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { supabase } from '@/lib/supabase';
import type { Metadata } from 'next';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  STAT_NUMBER_COMPACT,
  SECTION_RHYTHM,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import { AnalyticsClient, type AgentFunnelData } from './analytics-client';

export const metadata: Metadata = { title: 'Analytics -- Brokerage' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BrokerAnalyticsPage() {
  // Gate: broker_owner + broker_admin only.
  const ctx = await resolveBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage } = ctx;

  // Fetch all members with their spaces.
  const members = await getBrokerageMembers(brokerage.id, { includeSpaceName: true });
  const spaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];

  // Fetch contacts and deals across all member spaces.
  const [contactsRes, dealsRes] = await Promise.all([
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('id, spaceId, type')
          .in('spaceId', spaceIds)
          .limit(50000)
      : Promise.resolve({ data: [] }),
    spaceIds.length > 0
      ? supabase
          .from('Deal')
          .select('id, spaceId, status, value')
          .in('spaceId', spaceIds)
          .limit(50000)
      : Promise.resolve({ data: [] }),
  ]);

  const contacts = (contactsRes.data ?? []) as { id: string; spaceId: string; type: string }[];
  const deals = (dealsRes.data ?? []) as {
    id: string;
    spaceId: string;
    status: string;
    value: number | null;
  }[];

  // Build per-space stat buckets.
  type SpaceStats = {
    totalLeads: number;
    qualification: number;
    tour: number;
    application: number;
    activeDeals: number;
    wonDeals: number;
    lostDeals: number;
    wonValue: number;
  };

  const statsBySpace: Record<string, SpaceStats> = {};
  const blank = (): SpaceStats => ({
    totalLeads: 0,
    qualification: 0,
    tour: 0,
    application: 0,
    activeDeals: 0,
    wonDeals: 0,
    lostDeals: 0,
    wonValue: 0,
  });

  for (const c of contacts) {
    if (!statsBySpace[c.spaceId]) statsBySpace[c.spaceId] = blank();
    const s = statsBySpace[c.spaceId];
    s.totalLeads++;
    const t = (c.type ?? 'QUALIFICATION').toUpperCase();
    if (t === 'QUALIFICATION') s.qualification++;
    else if (t === 'TOUR') s.tour++;
    else if (t === 'APPLICATION') s.application++;
  }

  for (const d of deals) {
    if (!statsBySpace[d.spaceId]) statsBySpace[d.spaceId] = blank();
    const s = statsBySpace[d.spaceId];
    if (d.status === 'active') s.activeDeals++;
    else if (d.status === 'won') {
      s.wonDeals++;
      s.wonValue += d.value ?? 0;
    } else if (d.status === 'lost') s.lostDeals++;
  }

  // Build per-agent funnel data for the client component.
  const agentData: AgentFunnelData[] = members
    .filter((m) => m.Space?.id)
    .map((m) => {
      const sid = m.Space?.id ?? '';
      const s = statsBySpace[sid] ?? blank();
      const totalDeals = s.activeDeals + s.wonDeals + s.lostDeals;
      return {
        userId: m.userId,
        name: m.User?.name ?? m.User?.email ?? 'Unknown',
        email: m.User?.email ?? '',
        role:
          m.role === 'broker_owner'
            ? 'Owner'
            : m.role === 'broker_admin'
              ? 'Admin'
              : 'Realtor',
        totalLeads: s.totalLeads,
        qualification: s.qualification,
        tours: s.tour,
        applications: s.application,
        activeDeals: s.activeDeals,
        wonDeals: s.wonDeals,
        lostDeals: s.lostDeals,
        totalDeals,
        wonValue: s.wonValue,
        leadToTour: s.totalLeads > 0 ? Math.round((s.tour / s.totalLeads) * 100) : 0,
        tourToApp: s.tour > 0 ? Math.round((s.application / s.tour) * 100) : 0,
        appToDeal: s.application > 0 ? Math.round((totalDeals / s.application) * 100) : 0,
        overallConversion:
          s.totalLeads > 0 ? Math.round((s.wonDeals / s.totalLeads) * 100) : 0,
      };
    });

  // Team-level KPIs for the static strip (server-rendered, no client needed).
  const totalLeads = agentData.reduce((a, x) => a + x.totalLeads, 0);
  const totalWon = agentData.reduce((a, x) => a + x.wonDeals, 0);
  const totalPipelineValue = agentData.reduce((a, x) => a + x.wonValue, 0);
  const teamConversion =
    totalLeads > 0 ? Math.round((totalWon / totalLeads) * 100) : 0;
  const activeAgents = agentData.filter((a) => a.totalLeads > 0).length;

  // Status sentence -- one calm line under the h1.
  const statusSentence = (() => {
    if (totalLeads === 0) return 'No lead activity recorded yet.';
    const parts: string[] = [];
    parts.push(
      `${totalLeads.toLocaleString()} ${totalLeads === 1 ? 'lead' : 'leads'} across ${activeAgents} ${activeAgents === 1 ? 'agent' : 'agents'}`,
    );
    parts.push(`${teamConversion}% lead-to-win`);
    return parts.join(', ') + '.';
  })();

  const isEmpty = totalLeads === 0;

  return (
    <div className={cn('max-w-5xl mx-auto pb-56 md:pb-24', SECTION_RHYTHM)}>

      {/* Status-sentence header -- per STYLESHEET the-status-sentence-pattern */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Brokerage.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Analytics
        </h1>
        <p className={BODY_MUTED}>{statusSentence}</p>
      </header>

      {isEmpty ? (
        /* Empty state -- dashed-border house style per STYLESHEET Empty states */
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">No activity yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Lead and deal data across your member realtors will appear here.
          </p>
        </div>
      ) : (
        <div className={SECTION_RHYTHM}>

          {/* KPI strip -- hairline-divider grid per STYLESHEET Surfaces */}
          <section
            className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
            aria-label="Team totals"
          >
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Total leads</p>
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {totalLeads.toLocaleString()}
              </p>
            </div>
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Deals won</p>
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {totalWon.toLocaleString()}
              </p>
            </div>
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Pipeline value</p>
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {formatCompact(totalPipelineValue)}
              </p>
            </div>
            <div className="bg-background px-4 py-4 space-y-0.5">
              <p className={SECTION_LABEL}>Lead to win</p>
              <p className={cn(STAT_NUMBER_COMPACT)} style={TITLE_FONT}>
                {teamConversion}%
              </p>
            </div>
          </section>

          {/* Agent funnel + table -- all client interactivity */}
          <AnalyticsClient agents={agentData} />

        </div>
      )}
    </div>
  );
}
