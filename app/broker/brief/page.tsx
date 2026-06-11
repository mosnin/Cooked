import { getBrokerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { redirect } from 'next/navigation';
import {
  Building2,
  Briefcase,
  Inbox,
  ChevronRight,
  ArrowRight,
  ArrowUpRight,
  Mail,
} from 'lucide-react';
import Link from 'next/link';
import { formatCompact, formatCurrency } from '@/lib/formatting';
import { SECTION_LABEL, TITLE_FONT, CHIPPI_PILL, CAPTION, META, STAT_NUMBER_COMPACT } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { dealHealth } from '@/lib/deals/health';
import { TeamActivityFeed } from '@/components/broker/team-activity-feed';
import { BrokerMorningStory } from '@/components/broker/broker-morning-story';
import { DraftImpactCard } from '@/components/broker/draft-impact-card';
import {
  aggregateDraftStats,
  draftStatsWindowStart,
  type DraftStatsRow,
} from '@/lib/draft-stats';
import { MemberDashboard } from '../member-dashboard';

// ── Revenue forecast helpers (mirrors app/broker/forecast/page.tsx) ──────────
//
// Closing probability table:
//   closeDate this month + on-track → 0.65 | at-risk → 0.40 | stuck → 0.15
//   closeDate past (overdue)         → 0.10 (stuck → 0.05)
//   no close date / future month    → on-track 0.20 | at-risk 0.10 | stuck 0.05

function closingProbability(
  closeDate: Date | null,
  health: 'on-track' | 'at-risk' | 'stuck',
  monthStart: Date,
  monthEnd: Date,
): number {
  const now = new Date();
  if (closeDate) {
    if (closeDate < now) return health === 'stuck' ? 0.05 : 0.10;
    if (closeDate >= monthStart && closeDate <= monthEnd) {
      if (health === 'on-track') return 0.65;
      if (health === 'at-risk') return 0.40;
      return 0.15;
    }
  }
  if (health === 'on-track') return 0.20;
  if (health === 'at-risk') return 0.10;
  return 0.05;
}

type ActiveDealRow = {
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

// ── End revenue forecast helpers ─────────────────────────────────────────────

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default async function BrokerBriefPage() {
  const ctx = await getBrokerMemberContext();
  if (!ctx) redirect('/');

  // realtor_member sees their own work surface, not the swarm.
  if (ctx.membership.role === 'realtor_member') {
    return <MemberDashboard ctx={ctx} />;
  }

  const { brokerage } = ctx;
  const members = await getBrokerageMembers(ctx.brokerage.id, {
    includeOnboard: true,
    includeSpaceName: true,
  });

  const spaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];

  // Make sure the broker owner's space is included — brokerage leads land
  // there before being routed.
  const { data: ownerSpaceRow } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', ctx.brokerage.ownerId)
    .maybeSingle();
  if (ownerSpaceRow?.id && !spaceIds.includes(ownerSpaceRow.id)) {
    spaceIds.push(ownerSpaceRow.id);
  }

  // Aggregate the swarm in one parallel volley. Each query is scoped to the
  // brokerage's set of spaces.
  const [
    applicationCountRes,
    leadCountRes,
    dealRows,
    wonDealRows,
    invitationsRes,
    draftRows,
    draftStatsRows,
  ] = await Promise.all([
      spaceIds.length > 0
        ? supabase
            .from('Contact')
            .select('*', { count: 'exact', head: true })
            .in('spaceId', spaceIds)
            .contains('tags', ['application-link'])
        : Promise.resolve({ count: 0 }),
      spaceIds.length > 0
        ? supabase
            .from('Contact')
            .select('*', { count: 'exact', head: true })
            .in('spaceId', spaceIds)
            .contains('tags', ['new-lead'])
        : Promise.resolve({ count: 0 }),
      spaceIds.length > 0
        ? supabase
            .from('Deal')
            .select('spaceId, value')
            .in('spaceId', spaceIds)
            .eq('status', 'active')
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      spaceIds.length > 0
        ? supabase
            .from('Deal')
            .select('spaceId, value')
            .in('spaceId', spaceIds)
            .eq('status', 'won')
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      supabase
        .from('Invitation')
        .select('id, email, roleToAssign, createdAt')
        .eq('brokerageId', brokerage.id)
        .eq('status', 'pending')
        .order('createdAt', { ascending: false })
        .limit(6),
      spaceIds.length > 0
        ? supabase
            .from('AgentDraft')
            .select('spaceId')
            .in('spaceId', spaceIds)
            .eq('status', 'pending')
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
      // Decided drafts in the 30-day window — feeds the Draft impact card.
      // Same shape `aggregateDraftStats` expects; brokerage-wide rollup.
      spaceIds.length > 0
        ? supabase
            .from('AgentDraft')
            .select('feedback_action, edit_distance, decision_ms, outcome_signal')
            .in('spaceId', spaceIds)
            .not('feedback_action', 'is', null)
            .gte('createdAt', draftStatsWindowStart())
            .then((r) => r.data ?? [])
        : Promise.resolve([]),
    ]);

  const draftStats = aggregateDraftStats((draftStatsRows ?? []) as DraftStatsRow[]);

  // Commission KPI — GCI = value * commissionRate / 100 on won deals whose
  // updatedAt falls in the window. Mirrors `agent/tools/broker/revenue.py`
  // (the documented closedAt proxy is updatedAt on status='won' rows).
  const nowDate = new Date();
  const mtdStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
  const ytdStart = new Date(Date.UTC(nowDate.getUTCFullYear(), 0, 1));

  const wonYtdRowsRes =
    spaceIds.length > 0
      ? await supabase
          .from('Deal')
          .select('spaceId, value, commissionRate, updatedAt')
          .in('spaceId', spaceIds)
          .eq('status', 'won')
          .gte('updatedAt', ytdStart.toISOString())
          .limit(10000)
      : { data: [] as Array<{ spaceId: string; value: number | null; commissionRate: number | null; updatedAt: string }> };

  const wonYtdRows = (wonYtdRowsRes.data ?? []) as Array<{
    spaceId: string;
    value: number | null;
    commissionRate: number | null;
    updatedAt: string;
  }>;

  let mtdCommission = 0;
  let ytdCommission = 0;
  let mtdDealsClosed = 0;
  const mtdBySpace: Record<string, number> = {};
  const mtdStartMs = mtdStart.getTime();
  for (const d of wonYtdRows) {
    const gci =
      d.value != null && d.commissionRate != null ? (d.value * d.commissionRate) / 100 : 0;
    ytdCommission += gci;
    const updatedMs = new Date(d.updatedAt).getTime();
    if (updatedMs >= mtdStartMs) {
      mtdCommission += gci;
      mtdDealsClosed += 1;
      if (gci > 0) {
        mtdBySpace[d.spaceId] = (mtdBySpace[d.spaceId] ?? 0) + gci;
      }
    }
  }

  // Top realtor MTD — owner name keyed off the spaceId → space.ownerId map
  // from the `members` rows we already fetched. We only label the cell when
  // someone actually earned non-zero GCI this month.
  let topRealtorMtd: { name: string; amount: number } | null = null;
  let topSpaceId: string | null = null;
  let topAmount = 0;
  for (const [sId, amt] of Object.entries(mtdBySpace)) {
    if (amt > topAmount) {
      topAmount = amt;
      topSpaceId = sId;
    }
  }
  if (topSpaceId) {
    const owner = members.find((m) => m.Space?.id === topSpaceId);
    const name = owner?.User?.name?.split(' ')[0] ?? owner?.User?.name ?? 'Realtor';
    topRealtorMtd = { name, amount: topAmount };
  }

  // ── Revenue forecast (brief read) ─────────────────────────────────────────
  // Reuses the forecast model from app/broker/forecast/page.tsx.
  // Won GCI: same MTD window + defaultBrokerRate fallback already computed above.
  // Active GCI: weighted by closingProbability × dealHealth — one extra query.

  const b = brokerage as unknown as { defaultBrokerRate?: number | null };
  const defaultBrokerRate =
    typeof b.defaultBrokerRate === 'number' ? b.defaultBrokerRate : 0.02;

  // Won GCI this month from the already-fetched wonYtdRows (filtered to MTD)
  let revWonGci = 0;
  for (const d of wonYtdRows) {
    const updatedMs = new Date(d.updatedAt).getTime();
    if (updatedMs >= mtdStartMs) {
      const rate = d.commissionRate != null ? d.commissionRate / 100 : defaultBrokerRate;
      revWonGci += (d.value ?? 0) * rate;
    }
  }

  // Active deals with full fields needed for health + probability
  const { data: revActiveRaw } = spaceIds.length > 0
    ? await supabase
        .from('Deal')
        .select(
          'id, spaceId, title, value, commissionRate, closeDate, stageId, status, updatedAt, stageChangedAt, followUpAt, nextAction, nextActionDueAt',
        )
        .in('spaceId', spaceIds)
        .eq('status', 'active')
        .order('value', { ascending: false })
        .limit(2000)
    : { data: [] as ActiveDealRow[] };

  const monthStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  const monthName = nowDate.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });

  let revInFlightGci = 0;
  let revTopDealTitle = '';
  let revTopDealGci = 0;
  let revTopDealId = '';
  let revTopDealProb = 0;

  for (const d of (revActiveRaw ?? []) as ActiveDealRow[]) {
    const closeDate = d.closeDate ? new Date(d.closeDate) : null;
    const healthResult = dealHealth({
      status: d.status as 'active' | 'won' | 'lost' | 'on_hold',
      stageChangedAt: d.stageChangedAt ? new Date(d.stageChangedAt) : null,
      updatedAt: new Date(d.updatedAt),
      closeDate,
      followUpAt: d.followUpAt ? new Date(d.followUpAt) : null,
      nextAction: d.nextAction,
      nextActionDueAt: d.nextActionDueAt ? new Date(d.nextActionDueAt) : null,
    });
    const rate = d.commissionRate != null ? d.commissionRate / 100 : defaultBrokerRate;
    const gci = (d.value ?? 0) * rate;
    const prob = closingProbability(closeDate, healthResult.state, monthStart, monthEnd);
    const projectedGci = gci * prob;
    revInFlightGci += projectedGci;
    if (projectedGci > revTopDealGci) {
      revTopDealGci = projectedGci;
      revTopDealTitle = d.title;
      revTopDealId = d.id;
      revTopDealProb = prob;
    }
  }

  const revTotalForecast = revWonGci + revInFlightGci;
  const revActiveCount = (revActiveRaw ?? []).length;
  const revHasPipeline = revActiveCount > 0 || revWonGci > 0;

  const revPaceSentence = revTotalForecast === 0
    ? null
    : `On pace for ${formatCurrency(revTotalForecast)}. ${formatCompact(revWonGci)} won, ${formatCompact(revInFlightGci)} in flight.`;

  // ── End revenue forecast ────────────────────────────────────────────────────

  // Speed-to-lead SLA counts — only queried when slaEnabled is on.
  // Two numbers: leads currently breaching (needs action) + leads Chippi
  // escalated to the broker today (proof of work).
  let slaEnabled = false;
  let needsResponse = 0;
  let escalatedToday = 0;
  if (brokerage.slaEnabled && spaceIds.length > 0) {
    slaEnabled = true;
    const todayStart = new Date(
      Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()),
    ).toISOString();
    const firstThreshold = new Date(
      Date.now() - brokerage.slaFirstResponseMinutes * 60000,
    ).toISOString();

    const [needsRes, escalatedRes] = await Promise.all([
      // Currently-breaching: routed, never contacted, older than slaFirstResponseMinutes.
      supabase
        .from('Contact')
        .select('*', { count: 'exact', head: true })
        .in('spaceId', spaceIds)
        .contains('tags', ['assigned-by-broker'])
        .is('lastContactedAt', null)
        .lte('createdAt', firstThreshold),
      // Escalated today: BrokerNotification rows Chippi created today for this brokerage.
      supabase
        .from('BrokerNotification')
        .select('*', { count: 'exact', head: true })
        .eq('brokerageId', brokerage.id)
        .eq('type', 'review_requested')
        .gte('createdAt', todayStart)
        .filter('metadata->>kind', 'eq', 'lead_sla_breach'),
    ]);

    needsResponse = needsRes.count ?? 0;
    escalatedToday = escalatedRes.count ?? 0;
  }

  const [applicationRows, leadRows] = await Promise.all([
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .contains('tags', ['application-link'])
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .contains('tags', ['new-lead'])
          .then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  const appsBySpace = (applicationRows as { spaceId: string }[]).reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const leadsBySpace = (leadRows as { spaceId: string }[]).reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1;
      return acc;
    },
    {},
  );
  const dealsBySpace = (dealRows as { spaceId: string; value: number | null }[]).reduce<
    Record<string, { count: number; value: number }>
  >((acc, r) => {
    if (!acc[r.spaceId]) acc[r.spaceId] = { count: 0, value: 0 };
    acc[r.spaceId].count += 1;
    acc[r.spaceId].value += r.value ?? 0;
    return acc;
  }, {});
  const draftsBySpace = (draftRows as { spaceId: string }[]).reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const pendingInvitations = (invitationsRes.data ?? []) as Array<{
    id: string;
    email: string;
    roleToAssign: string;
    createdAt: string;
  }>;

  const activeMembers = members.filter((m) => m.User?.onboard).length;
  const totalApplications = applicationCountRes.count ?? 0;
  const totalLeads = leadCountRes.count ?? 0;
  const totalDeals = Object.values(dealsBySpace).reduce((a, b) => a + b.count, 0);
  const totalPipeline = Object.values(dealsBySpace).reduce((a, b) => a + b.value, 0);
  const totalWonValue = (wonDealRows as { spaceId: string; value: number | null }[]).reduce(
    (sum, d) => sum + (d.value ?? 0),
    0,
  );
  const totalPendingDrafts = Object.values(draftsBySpace).reduce((a, b) => a + b, 0);

  const hasSettings = !!(brokerage.name && (brokerage.logoUrl || brokerage.websiteUrl));

  // Sort members by current activity load (active drafts + new leads + active deals)
  // so the broker scans the busiest realtors first. Owner row stays pinned to top.
  const memberRows = members
    .map((m) => {
      const sId = m.Space?.id;
      const apps = sId ? appsBySpace[sId] ?? 0 : 0;
      const leads = sId ? leadsBySpace[sId] ?? 0 : 0;
      const deals = sId ? dealsBySpace[sId] ?? { count: 0, value: 0 } : { count: 0, value: 0 };
      const drafts = sId ? draftsBySpace[sId] ?? 0 : 0;
      return { member: m, apps, leads, deals, drafts };
    })
    .sort((a, b) => {
      // Owner first, then by drafts pending desc, then by deals desc
      if (a.member.role === 'broker_owner' && b.member.role !== 'broker_owner') return -1;
      if (b.member.role === 'broker_owner' && a.member.role !== 'broker_owner') return 1;
      if (a.drafts !== b.drafts) return b.drafts - a.drafts;
      return b.deals.count - a.deals.count;
    });

  return (
    <div className="max-w-5xl mx-auto space-y-12 pb-12">
      {/* Header — canonical three-line pattern. Muted greeting (with the
          team name as the calm anchor), serif Times h1 from BrokerMorningStory
          carrying Chippi's chief-of-staff sentence, and the small hairline
          stats row inside the story handles the context numbers. No second
          muted line — two stat surfaces stacked read as noise. */}
      <header className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          {getGreeting()}. {brokerage.name}.
        </p>
        <BrokerMorningStory />
      </header>

      {/* Chippi — the focal entry. The broker's chief of staff is the home of
          this page, not its fourth section. A calm, paper-flat doorway: serif
          name, one line of what it does, a quiet pill into /broker/chippi.
          No orange wash, no shadow — the surface stays out of the way and the
          invitation is the loud note. */}
      <Link
        href="/broker"
        className="group/chippi block rounded-xl border border-border/70 bg-card px-5 py-5 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0 space-y-1">
            <p
              className="text-[21px] leading-snug tracking-tight text-foreground"
              style={TITLE_FONT}
            >
              Talk to Chippi
            </p>
            <p className="text-sm text-muted-foreground">
              Ask about team health, reassign a lead, flag a deal, send an announcement.
            </p>
          </div>
          <span className={cn(CHIPPI_PILL, 'flex-shrink-0')}>
            Open
            <ArrowUpRight size={15} />
          </span>
        </div>
      </Link>

      {/* First-run nudge — only when the team hasn't been set up yet.
          Neutral icon: this is a settings affordance, not Chippi speaking,
          so orange would be unearned. */}
      {!hasSettings && (
        <section className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 flex items-start gap-3">
          <Building2 size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-0.5">
            <p className="text-sm font-medium">Finish setting up your team</p>
            <p className="text-[13px] text-muted-foreground">
              Add a logo, website, and intake form details so leads see a polished surface.
            </p>
          </div>
          <Link
            href="/broker/settings"
            className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
          >
            Open settings
            <ArrowRight size={12} />
          </Link>
        </section>
      )}

      {/* Snapshot — three numbers the broker actually cares about.
          Uses TITLE_FONT + SECTION_LABEL so the snapshot vocabulary
          matches the Commission grid below; one numeric vocabulary
          on the whole page. */}
      <section className="grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
        <div className="bg-background p-4">
          <p className={SECTION_LABEL}>Pipeline</p>
          <p
            className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
            style={TITLE_FONT}
          >
            ${formatCompact(totalPipeline)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {totalDeals} active deal{totalDeals === 1 ? '' : 's'}
          </p>
        </div>
        <div className="bg-background p-4">
          <p className={SECTION_LABEL}>Won</p>
          <p
            className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
            style={TITLE_FONT}
          >
            ${formatCompact(totalWonValue)}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">closed this period</p>
        </div>
        <div className="bg-background p-4">
          <p className={SECTION_LABEL}>Funnel</p>
          <p
            className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
            style={TITLE_FONT}
          >
            {totalLeads}&nbsp;→&nbsp;{totalApplications}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1">leads → applications</p>
        </div>
      </section>

      {/* Commission — money is the loudest signal. Hairline-divider grid
          mirrors deal-quick-panel.tsx's snapshot vocabulary. Section header
          drills into /broker/commissions for the per-deal breakdown. */}
      <section>
        <Link
          href="/broker/commissions"
          className="group/commission flex items-center gap-3 pb-3 border-b border-border/60"
        >
          <h2 className={SECTION_LABEL}>Commission</h2>
          <ArrowRight
            size={11}
            className="text-muted-foreground/40 group-hover/commission:text-muted-foreground transition-colors"
          />
        </Link>
        <div className="grid grid-cols-4 gap-px bg-border/70 rounded-xl overflow-hidden border border-border/70 mt-4">
          <div className="bg-background p-4">
            <p className={SECTION_LABEL}>MTD commission</p>
            <p
              className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
              style={TITLE_FONT}
            >
              {formatCompact(mtdCommission)}
            </p>
          </div>
          <div className="bg-background p-4">
            <p className={SECTION_LABEL}>YTD commission</p>
            <p
              className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
              style={TITLE_FONT}
            >
              {formatCompact(ytdCommission)}
            </p>
          </div>
          <div className="bg-background p-4">
            <p className={SECTION_LABEL}>Top realtor (MTD)</p>
            <p
              className="text-2xl tracking-tight mt-1.5 text-foreground truncate"
              style={TITLE_FONT}
            >
              {topRealtorMtd ? topRealtorMtd.name : <span className="text-muted-foreground">—</span>}
            </p>
            {topRealtorMtd && (
              <p className="text-[11px] text-muted-foreground tabular-nums mt-1">
                {formatCompact(topRealtorMtd.amount)}
              </p>
            )}
          </div>
          <div className="bg-background p-4">
            <p className={SECTION_LABEL}>Deals closed MTD</p>
            <p
              className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
              style={TITLE_FONT}
            >
              {mtdDealsClosed}
            </p>
          </div>
        </div>
        {mtdCommission === 0 && (
          <p className="text-[13px] text-muted-foreground mt-3">
            Quiet — no deals closed this month yet.
          </p>
        )}
      </section>

      {/* Revenue — projected GCI for the month at a glance.
          Focal number in serif Times + one-line pace read + the single biggest
          deal to watch. Computation mirrors app/broker/forecast/page.tsx. */}
      <section>
        <Link
          href="/broker/forecast"
          className="group/revenue flex items-center gap-3 pb-3 border-b border-border/60"
        >
          <h2 className={SECTION_LABEL}>Revenue</h2>
          <ArrowRight
            size={11}
            className="text-muted-foreground/40 group-hover/revenue:text-muted-foreground transition-colors"
          />
        </Link>

        {!revHasPipeline ? (
          <p className="text-[13px] text-muted-foreground mt-3">
            No active pipeline yet.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {/* Focal projected number */}
            <div>
              <p
                className={cn(STAT_NUMBER_COMPACT, 'tabular-nums')}
                style={TITLE_FONT}
              >
                {formatCurrency(revTotalForecast)}
              </p>
              {revPaceSentence && (
                <p className={cn(CAPTION, 'mt-1')}>
                  {revPaceSentence}
                </p>
              )}
            </div>

            {/* Stat strip: won + in flight */}
            <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
              <div className="bg-background px-4 py-3">
                <p className={SECTION_LABEL}>Won so far</p>
                <p
                  className="text-[17px] leading-snug tracking-tight tabular-nums text-foreground mt-1"
                  style={TITLE_FONT}
                >
                  {formatCompact(revWonGci)}
                </p>
              </div>
              <div className="bg-background px-4 py-3">
                <p className={SECTION_LABEL}>In flight (weighted)</p>
                <p
                  className="text-[17px] leading-snug tracking-tight tabular-nums text-foreground mt-1"
                  style={TITLE_FONT}
                >
                  {formatCompact(revInFlightGci)}
                </p>
              </div>
            </div>

            {/* Biggest deal to watch */}
            {revTopDealTitle && (
              <div className="flex items-center justify-between gap-4 pt-1">
                <div className="min-w-0">
                  <p className={SECTION_LABEL}>Biggest deal to watch</p>
                  <p className="text-sm text-foreground mt-0.5 truncate">{revTopDealTitle}</p>
                  <p className={cn(META, 'mt-0.5')}>
                    {formatCompact(revTopDealGci)} projected &middot; {Math.round(revTopDealProb * 100)}% likely
                  </p>
                </div>
                <Link
                  href="/broker/forecast"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                >
                  Full forecast
                  <ArrowUpRight size={11} />
                </Link>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Speed to lead — only when slaEnabled is on */}
      {slaEnabled && (
        <section>
          <div className="flex items-center gap-3 pb-3 border-b border-border/60">
            <h2 className={SECTION_LABEL}>Speed to lead</h2>
          </div>
          <p className="text-sm text-foreground mt-3">
            {needsResponse > 0 ? (
              <>
                <span className="font-medium">
                  {needsResponse} {needsResponse === 1 ? 'lead needs' : 'leads need'} a first response.
                </span>
                {escalatedToday > 0 && (
                  <span className="text-muted-foreground">
                    {' '}Chippi escalated {escalatedToday} {escalatedToday === 1 ? 'lead' : 'leads'} to you today.
                  </span>
                )}
              </>
            ) : escalatedToday > 0 ? (
              <span className="text-muted-foreground">
                Every lead has been answered. Chippi escalated {escalatedToday} {escalatedToday === 1 ? 'lead' : 'leads'} to you today.
              </span>
            ) : (
              <span className="text-muted-foreground">Every lead has been answered.</span>
            )}
          </p>
        </section>
      )}

      {/* Pending invitations — only when there are some */}
      {pendingInvitations.length > 0 && (
        <section>
          <div className="flex items-center gap-3 pb-3 border-b border-border/60">
            <h2 className={SECTION_LABEL}>Pending invitations</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {pendingInvitations.length}
            </span>
            <Link
              href="/broker/invitations"
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Manage
              <ArrowRight size={11} />
            </Link>
          </div>
          <ul className="divide-y divide-border/60">
            {pendingInvitations.map((inv) => {
              const role =
                inv.roleToAssign === 'broker_owner'
                  ? 'Owner'
                  : inv.roleToAssign === 'broker_admin'
                    ? 'Admin'
                    : 'Realtor';
              return (
                <li key={inv.id} className="py-3 flex items-center gap-3 text-sm">
                  <Mail size={13} className="text-muted-foreground flex-shrink-0" />
                  <span className="font-medium text-foreground truncate">{inv.email}</span>
                  <span className="text-xs text-muted-foreground">{role}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
                    sent {new Date(inv.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* The swarm — your team today */}
      <section>
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>Your team</h2>
          {activeMembers > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">{activeMembers}</span>
          )}
          <Link
            href="/broker/members"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage
            <ArrowRight size={11} />
          </Link>
        </div>

        {memberRows.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className="text-sm text-foreground">Your team, in here.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Invite your first realtor and their work will land in this view.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {memberRows.map(({ member, leads, deals, drafts, apps }) => {
              const name = member.User?.name ?? 'Unnamed realtor';
              const initial = name.charAt(0).toUpperCase();
              // A teammate row opens the broker-scoped realtor detail page.
              // /s/<slug>/* requires owning that space, so a broker can't open a
              // teammate's own dashboard — it 404s. /broker/realtors/<userId> is
              // the broker's view of that realtor (the same link the Realtors
              // list uses). The broker's own chief of staff lives at /broker/chippi.
              const href = member.userId ? `/broker/realtors/${member.userId}` : '#';
              const role =
                member.role === 'broker_owner'
                  ? 'Owner'
                  : member.role === 'broker_admin'
                    ? 'Admin'
                    : 'Realtor';
              const onboard = !!member.User?.onboard;
              return (
                <li key={member.id}>
                  <Link
                    href={href}
                    className="group/row flex items-center gap-3 py-3 -mx-2 px-2 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-sm font-semibold text-muted-foreground">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-foreground truncate">{name}</span>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">{role}</span>
                        {!onboard && (
                          <span className="text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
                            invited — not joined
                          </span>
                        )}
                      </div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground mt-0.5">
                        {deals.count > 0 && (
                          <span className="inline-flex items-center gap-1 tabular-nums whitespace-nowrap">
                            <Briefcase size={10} />
                            {deals.count} deal{deals.count === 1 ? '' : 's'} · ${formatCompact(deals.value)}
                          </span>
                        )}
                        {apps > 0 && (
                          <span className="tabular-nums whitespace-nowrap">
                            {apps} application{apps === 1 ? '' : 's'}
                          </span>
                        )}
                        {leads > 0 && (
                          <span className="tabular-nums whitespace-nowrap">
                            {leads} new lead{leads === 1 ? '' : 's'}
                          </span>
                        )}
                        {drafts > 0 && (
                          <span className="inline-flex items-center gap-1 text-orange-600 dark:text-orange-400 tabular-nums font-medium whitespace-nowrap">
                            <Inbox size={10} />
                            {drafts} draft{drafts === 1 ? '' : 's'} pending
                          </span>
                        )}
                        {deals.count === 0 && apps === 0 && leads === 0 && drafts === 0 && onboard && (
                          <span>quiet — nothing in flight</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight
                      size={13}
                      className="flex-shrink-0 text-muted-foreground/0 group-hover/row:text-muted-foreground/60 transition-colors"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Draft impact — how Chippi's drafts have actually been landing across
          the team over the last 30 days. Sits below the team list so the
          realtor row remains the focal element of the page. */}
      <DraftImpactCard stats={draftStats} />

      {/* What the team did — proof of work across the swarm */}
      <section>
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>What the team did</h2>
        </div>
        <div className="pt-4">
          <TeamActivityFeed />
        </div>
      </section>
    </div>
  );
}
