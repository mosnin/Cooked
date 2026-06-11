/**
 * GET /api/broker/morning
 *
 * The broker's morning narration — ONE prioritized action the broker should
 * do RIGHT NOW. Not a dashboard, not a snapshot, not a list. A chief of
 * staff's opening line: the loudest signal on the team, framed as a calm
 * question the broker can answer with a tap.
 *
 * Priority ladder (descending urgency):
 *   1. stuck-deals      — highest (days × value) score across the team.
 *   2. unassigned-leads — brokerage-tagged Contacts sitting in the queue.
 *   3. overloaded       — a realtor whose open work (active deals + open
 *                         leads) exceeds 15 — the canonical team_health
 *                         threshold from agent/tools/broker/team.py.
 *   4. underused        — a realtor with open work below 3 who's still
 *                         active in the last 30 days (canonical team_health
 *                         underused signal). Newly-invited dormant members
 *                         don't surface — only currently-active realtors
 *                         going quiet.
 *   5. milestone        — GCI MTD crossed a round threshold; celebrate the
 *                         top performer in the same breath.
 *   6. fallback         — quiet morning, team healthy.
 *
 * Response shape:
 *   { headline: string,
 *     suggestedPrompt: string | null,
 *     stats: { realtors, activeDeals, gciMtd } }
 *
 * `suggestedPrompt` is non-null on branches 1-4 (the "want me to ..."
 * affordance); the component routes the broker into /broker/chippi with the
 * prompt pre-filled. Branches 5 and 6 have no action, so the headline
 * renders non-interactive.
 *
 * The thresholds and definitions mirror agent/tools/broker/ exactly — the
 * Python tools are the canonical math for "what's happening on the team".
 * If they drift, Chippi's narrated answer and this headline will disagree,
 * which is the worst kind of inconsistency.
 *
 * Auth: broker_owner or broker_admin. Realtor-only members get 403 — they
 * have their own /chippi morning story.
 */
import { NextResponse } from 'next/server';
import { requireBroker } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { getBrokerageMembers } from '@/lib/brokerage-members';

export interface BrokerMorningResponse {
  /**
   * The single sentence the broker reads first thing. Formed as
   * "<fact> — <call-to-action>." so the component can render the
   * call-to-action in slightly stronger weight without parsing HTML.
   */
  headline: string;
  /**
   * Text to prefill into /broker/chippi when the broker taps the headline.
   * Null on the milestone + fallback branches, where there's nothing to do.
   */
  suggestedPrompt: string | null;
  /**
   * The hairline-divider stats row below the headline. Context, not focal.
   */
  stats: {
    realtors: number;
    activeDeals: number;
    gciMtd: number;
  };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Stuck-deal threshold — exactly mirrors find_stuck_deals(min_days=7) in
// agent/tools/broker/pipeline.py:42 so the row pill and Chippi answer the
// same question with the same math.
const STUCK_MIN_DAYS = 7;

// team_health canonical thresholds — see agent/tools/broker/team.py:55-57.
// Keep these in lockstep with the Python tool; the broker hears one number
// across the surface.
const OVERLOADED_OPEN_THRESHOLD = 15;
const UNDERUSED_OPEN_THRESHOLD = 3;
const RECENT_ACTIVE_WINDOW_DAYS = 30;

// Outbound activity types used for the "recently active" check — same set
// the realtors page and team_health use to define "responding".
const RESPONSE_OUTBOUND_TYPES = ['call', 'email', 'meeting'] as const;

// GCI milestones the broker actually wants to hear about. Crossed-this-month
// only — we don't re-celebrate hitting $50K every day.
const GCI_MILESTONES = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** First name only — broker speaks about realtors the way they call them. */
function firstName(full: string): string {
  const trimmed = (full ?? '').trim();
  if (!trimmed) return 'They';
  return trimmed.split(/\s+/)[0];
}

/** Round half-up to one decimal for the GCI display, e.g. 18432.7 → $18.4K. */
function thousandsK(n: number): string {
  return `$${(n / 1_000).toFixed(1)}K`;
}

interface MemberRow {
  userId: string;
  name: string;
  spaceId: string;
}

interface RealtorLoad {
  userId: string;
  name: string;
  spaceId: string;
  activeDeals: number;
  openLeads: number;
  /** Sum of active deals + open leads — the canonical team_health open-load proxy. */
  openLoad: number;
  /** True when the realtor has any outbound activity in the last 30 days. */
  recentlyActive: boolean;
}

interface StuckDealRow {
  id: string;
  spaceId: string;
  value: number;
  daysStuck: number;
}

/**
 * The largest milestone strictly less than `gciMtd` that's also at least
 * 80% of the current value — i.e. "we just crossed this." Returns null when
 * GCI hasn't crossed anything meaningful yet.
 */
function recentlyCrossedMilestone(gciMtd: number): number | null {
  const crossed = GCI_MILESTONES.filter((m) => gciMtd >= m);
  if (crossed.length === 0) return null;
  const highest = crossed[crossed.length - 1];
  // Don't keep celebrating $50K when we're at $200K — only celebrate if the
  // milestone is within the recent past (current value < 2x milestone).
  if (gciMtd >= highest * 2) return null;
  return highest;
}

export async function GET() {
  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { brokerage } = ctx;

  // ── Resolve the team ─────────────────────────────────────────────────────
  const members = await getBrokerageMembers(brokerage.id, {
    includeOnboard: true,
  });
  const memberRows: MemberRow[] = members
    .map((m) => ({
      userId: m.userId,
      name: m.User?.name ?? m.User?.email ?? 'Realtor',
      spaceId: m.Space?.id ?? '',
    }))
    .filter((m): m is MemberRow => Boolean(m.spaceId));

  const spaceIds = memberRows.map((m) => m.spaceId);
  const spaceToMember = new Map(
    memberRows.map((m) => [m.spaceId, { userId: m.userId, name: m.name }]),
  );

  const now = Date.now();
  const stuckCutoffIso = new Date(now - STUCK_MIN_DAYS * MS_PER_DAY).toISOString();
  const recentActivityCutoffIso = new Date(
    now - RECENT_ACTIVE_WINDOW_DAYS * MS_PER_DAY,
  ).toISOString();
  const monthStartIso = (() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  })();

  // ── Aggregate the swarm in one parallel volley ──────────────────────────
  // Six queries; nothing fancier than what /broker/realtors already does.
  // Each is brokerage-scoped through `spaceId IN (...)` or
  // `brokerageId = ...` so RLS doesn't leak across brokerages even if
  // someone bypasses requireBroker().
  const [
    allActiveDealsRes,
    stuckCandidatesRes,
    openLeadsRes,
    unassignedLeadsRes,
    recentActivityRes,
    wonMtdRes,
  ] = await Promise.all([
    // Every active deal — just spaceId for the per-realtor active-deals count
    // and the stats.activeDeals total.
    spaceIds.length > 0
      ? supabase
          .from('Deal')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .eq('status', 'active')
          .limit(10000)
      : Promise.resolve({ data: [] as Array<{ spaceId: string }> }),

    // Stuck-deal candidates — definition mirrors find_stuck_deals exactly:
    // status='active' AND updatedAt <= now() - STUCK_MIN_DAYS. The Python
    // tool then ranks by daysSince × value; we do the same below.
    spaceIds.length > 0
      ? supabase
          .from('Deal')
          .select('id, spaceId, value, updatedAt')
          .in('spaceId', spaceIds)
          .eq('status', 'active')
          .lte('updatedAt', stuckCutoffIso)
          .limit(5000)
      : Promise.resolve({ data: [] as Array<{ id: string; spaceId: string; value: number | null; updatedAt: string | null }> }),

    // Open leads per realtor — Contact WHERE type='QUALIFICATION'. This is
    // the same definition team_health uses for "open_leads". The broker's
    // load number = active deals + open leads.
    spaceIds.length > 0
      ? supabase
          .from('Contact')
          .select('spaceId')
          .in('spaceId', spaceIds)
          .eq('type', 'QUALIFICATION')
          .limit(10000)
      : Promise.resolve({ data: [] as Array<{ spaceId: string }> }),

    // Unassigned brokerage leads — same predicates as
    // app/broker/leads/page.tsx and find_unassigned_leads:
    // brokerageId match, tag includes 'brokerage-lead', NOT 'assigned'.
    supabase
      .from('Contact')
      .select('id, tags')
      .eq('brokerageId', brokerage.id)
      .contains('tags', ['brokerage-lead'])
      .limit(2000),

    // Most-recent outbound activity per space, for the "recently active"
    // check. We over-fetch by limit and dedupe in JS rather than firing N
    // per-space queries.
    spaceIds.length > 0
      ? supabase
          .from('ContactActivity')
          .select('spaceId, createdAt')
          .in('spaceId', spaceIds)
          .in('type', [...RESPONSE_OUTBOUND_TYPES])
          .gte('createdAt', recentActivityCutoffIso)
          .limit(20000)
      : Promise.resolve({ data: [] as Array<{ spaceId: string; createdAt: string }> }),

    // Won deals MTD — for GCI milestone + the top performer.
    spaceIds.length > 0
      ? supabase
          .from('Deal')
          .select('spaceId, value, commissionRate')
          .in('spaceId', spaceIds)
          .eq('status', 'won')
          .gte('updatedAt', monthStartIso)
          .limit(5000)
      : Promise.resolve({ data: [] as Array<{ spaceId: string; value: number | null; commissionRate: number | null }> }),
  ]);

  // ── Stuck deals: rank by (days × value), pick the top realtor ───────────
  const stuckBySpace = new Map<string, StuckDealRow[]>();
  for (const d of (stuckCandidatesRes.data ?? []) as Array<{
    id: string;
    spaceId: string;
    value: number | null;
    updatedAt: string | null;
  }>) {
    const updated = d.updatedAt ? new Date(d.updatedAt).getTime() : now;
    if (!isFinite(updated)) continue;
    const daysStuck = Math.max(0, Math.floor((now - updated) / MS_PER_DAY));
    const arr = stuckBySpace.get(d.spaceId) ?? [];
    arr.push({
      id: d.id,
      spaceId: d.spaceId,
      value: Number(d.value ?? 0),
      daysStuck,
    });
    stuckBySpace.set(d.spaceId, arr);
  }
  let topStuckSpaceId: string | null = null;
  let topStuckScore = 0;
  let topStuckCount = 0;
  let topStuckOldest = 0;
  for (const [spaceId, rows] of stuckBySpace) {
    if (rows.length === 0) continue;
    // (days × value) sum is the score — same formula as find_stuck_deals
    // applied per realtor instead of per deal. Floor of $1 on value so a
    // priceless inquiry still registers a non-zero score.
    const score = rows.reduce(
      (acc, r) => acc + r.daysStuck * Math.max(1, r.value),
      0,
    );
    const oldest = rows.reduce((acc, r) => Math.max(acc, r.daysStuck), 0);
    if (score > topStuckScore) {
      topStuckScore = score;
      topStuckSpaceId = spaceId;
      topStuckCount = rows.length;
      topStuckOldest = oldest;
    }
  }

  // ── Unassigned leads — count ─────────────────────────────────────────────
  const unassignedCount = (
    (unassignedLeadsRes.data ?? []) as Array<{ tags: string[] | null }>
  ).filter((c) => !(c.tags ?? []).includes('assigned')).length;

  // ── Per-realtor open load (active deals + open leads) ───────────────────
  const activeBySpace = new Map<string, number>();
  for (const d of (allActiveDealsRes.data ?? []) as Array<{ spaceId: string }>) {
    activeBySpace.set(d.spaceId, (activeBySpace.get(d.spaceId) ?? 0) + 1);
  }
  const openLeadsBySpace = new Map<string, number>();
  for (const c of (openLeadsRes.data ?? []) as Array<{ spaceId: string }>) {
    openLeadsBySpace.set(c.spaceId, (openLeadsBySpace.get(c.spaceId) ?? 0) + 1);
  }
  const recentlyActiveSpaces = new Set<string>();
  for (const a of (recentActivityRes.data ?? []) as Array<{ spaceId: string }>) {
    recentlyActiveSpaces.add(a.spaceId);
  }
  const loads: RealtorLoad[] = memberRows.map((m) => {
    const activeDeals = activeBySpace.get(m.spaceId) ?? 0;
    const openLeads = openLeadsBySpace.get(m.spaceId) ?? 0;
    return {
      userId: m.userId,
      name: m.name,
      spaceId: m.spaceId,
      activeDeals,
      openLeads,
      openLoad: activeDeals + openLeads,
      recentlyActive: recentlyActiveSpaces.has(m.spaceId),
    };
  });

  // Overloaded = highest open_load AND open_load > 15. Single-realtor team
  // never trips this — the broker can't redistribute to themselves.
  let overloaded: RealtorLoad | null = null;
  if (loads.length >= 2) {
    const sorted = [...loads].sort((a, b) => b.openLoad - a.openLoad);
    const top = sorted[0];
    if (top.openLoad > OVERLOADED_OPEN_THRESHOLD) {
      overloaded = top;
    }
  }

  // Underused = lowest open_load AND open_load < 3 AND recently active.
  // The "recently active" gate is what makes this calm chief-of-staff
  // copy: we don't call out a realtor who's already on vacation or hasn't
  // started. Same guard as team_health._load_signal.
  let underused: RealtorLoad | null = null;
  if (loads.length >= 2) {
    const candidates = loads
      .filter((r) => r.openLoad < UNDERUSED_OPEN_THRESHOLD && r.recentlyActive)
      .sort((a, b) => a.openLoad - b.openLoad);
    if (candidates.length > 0) underused = candidates[0];
  }

  // ── GCI MTD + top performer ──────────────────────────────────────────────
  // Formula matches lib/commissions.ts and revenue.commission_report:
  // gci = value * commissionRate / 100 per won deal in the window.
  const gciBySpace = new Map<string, number>();
  let gciTotal = 0;
  for (const d of (wonMtdRes.data ?? []) as Array<{
    spaceId: string;
    value: number | null;
    commissionRate: number | null;
  }>) {
    const v = Number(d.value ?? 0);
    const rate = Number(d.commissionRate ?? 0);
    const gci = (v * rate) / 100;
    if (!isFinite(gci) || gci <= 0) continue;
    gciBySpace.set(d.spaceId, (gciBySpace.get(d.spaceId) ?? 0) + gci);
    gciTotal += gci;
  }
  let topPerformer: { name: string; gci: number } | null = null;
  for (const [spaceId, gci] of gciBySpace) {
    const m = spaceToMember.get(spaceId);
    if (!m) continue;
    if (!topPerformer || gci > topPerformer.gci) {
      topPerformer = { name: m.name, gci };
    }
  }

  // ── Compose the headline + suggested prompt ──────────────────────────────
  // The em-dash break is load-bearing: the component splits on " — " so the
  // post-dash clause renders at slightly stronger weight. Compose every
  // branch with exactly one em-dash so that pattern holds.
  let headline = "Quiet morning. Team's healthy.";
  let suggestedPrompt: string | null = null;

  // 1. Stuck deals — highest priority.
  if (topStuckSpaceId && topStuckCount >= 1) {
    const member = spaceToMember.get(topStuckSpaceId);
    if (member) {
      const fn = firstName(member.name);
      const dealWord = topStuckCount === 1 ? 'stuck deal' : 'stuck deals';
      const dayWord = topStuckOldest === 1 ? 'day' : 'days';
      headline =
        topStuckCount === 1
          ? `${fn} has a deal stuck ${topStuckOldest} ${dayWord} — want me to ping ${fn}?`
          : `${fn} has ${topStuckCount} ${dealWord} over ${topStuckOldest} ${dayWord} — want me to ping ${fn}?`;
      suggestedPrompt =
        topStuckCount === 1
          ? `Help me check in with ${fn} on a stuck deal.`
          : `Help me check in with ${fn} on ${topStuckCount} stuck deals.`;
    }
  }
  // 2. Unassigned leads.
  else if (unassignedCount > 0) {
    const n = unassignedCount;
    const leadWord = n === 1 ? 'lead' : 'leads';
    headline = `${n} ${leadWord} sitting unassigned — want me to route ${n === 1 ? 'it' : 'them'} to your fewest-loaded realtor?`;
    suggestedPrompt =
      n === 1
        ? 'Route the unassigned lead to the realtor with the lightest load.'
        : `Route the ${n} unassigned leads to the realtor with the lightest load.`;
  }
  // 3. Overloaded realtor.
  else if (overloaded) {
    const fn = firstName(overloaded.name);
    // Fact framing — never "Bob is slow," always "Bob's at 18 active vs
    // threshold 15." Mirrors the row-pill voice from /broker/realtors.
    headline = `${fn}'s at ${overloaded.openLoad} open vs team threshold ${OVERLOADED_OPEN_THRESHOLD} — want to redistribute?`;
    suggestedPrompt = `Show me ${fn}'s pipeline and suggest 3 deals to hand off.`;
  }
  // 4. Underused realtor.
  else if (underused) {
    const fn = firstName(underused.name);
    headline =
      underused.openLoad === 0
        ? `${fn}'s quiet — no open work this week — want me to send ${fn} the next 3 leads?`
        : `${fn}'s quiet — only ${underused.openLoad} open — want me to send ${fn} the next 3 leads?`;
    suggestedPrompt = `Send ${fn} the next 3 incoming leads.`;
  }
  // 5. Commission milestone — celebration, no action.
  else {
    const milestone = recentlyCrossedMilestone(gciTotal);
    if (milestone && topPerformer && topPerformer.gci > 0) {
      const fn = firstName(topPerformer.name);
      headline = `You crossed ${thousandsK(milestone)} GCI this month — top performer: ${fn} with ${thousandsK(topPerformer.gci)}.`;
      suggestedPrompt = null;
    } else if (milestone) {
      headline = `You crossed ${thousandsK(milestone)} GCI this month — keep the momentum.`;
      suggestedPrompt = null;
    }
    // 6. Fallback — already initialised above.
  }

  // ── Stats row (context, not focal) ───────────────────────────────────────
  const totalActiveDeals = (allActiveDealsRes.data ?? []).length;
  const response: BrokerMorningResponse = {
    headline,
    suggestedPrompt,
    stats: {
      realtors: memberRows.length,
      activeDeals: totalActiveDeals,
      gciMtd: Math.round(gciTotal),
    },
  };
  return NextResponse.json(response);
}
