/**
 * GET /api/manager/agent-activity?days=30
 *
 * Per-rep rollup of AgentActivityLog rows across the team's member
 * workspaces. Each lifecycle tool (book_demo, advance_deal_stage, route_lead,
 * send_property_packet, request_deal_review, draft_message) writes one log
 * row on success, plus log_activity_run for end-of-run summaries. This
 * endpoint groups them by rep and bucket so the manager sees who did
 * what at a glance.
 *
 * Window: 1–90 days, default 30. Capped at 5,000 rows; spaces with very
 * active agents past the cap will under-report — fine for a rollup view.
 *
 * Buckets (action_type → bucket):
 *   demo_booked          → demos
 *   deal_stage_advanced  → stageMoves
 *   review_requested     → reviews
 *   message_drafted      → drafts
 *   packet_drafted       → drafts
 *   lead_routed_out      → routedOut
 *   lead_routed_in       → routedIn
 *   anything else        → runs (typically log_activity_run summaries)
 *
 * Auth: any manager member of the team. Reps don't see this view
 * (they see their own activity feed scoped to their space).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getManagerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

// ── Types ────────────────────────────────────────────────────────────────────

type Bucket =
  | 'demos'
  | 'stageMoves'
  | 'reviews'
  | 'drafts'
  | 'routedOut'
  | 'routedIn'
  | 'runs';

interface RepRollup {
  userId: string;
  name: string | null;
  email: string | null;
  spaceId: string;
  spaceSlug: string | null;
  totals: {
    all: number;
    completed: number;
    queued: number;
    failed: number;
    demos: number;
    stageMoves: number;
    reviews: number;
    drafts: number;
    routedOut: number;
    routedIn: number;
    runs: number;
  };
  lastActivityAt: string | null;
}

interface ResponseShape {
  windowDays: number;
  generatedAt: string;
  reps: RepRollup[];
  team: {
    totals: RepRollup['totals'];
    repCount: number;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bucketFor(actionType: string): Bucket {
  switch (actionType) {
    case 'demo_booked':         return 'demos';
    case 'deal_stage_advanced': return 'stageMoves';
    case 'review_requested':    return 'reviews';
    case 'message_drafted':
    case 'packet_drafted':      return 'drafts';
    case 'lead_routed_out':     return 'routedOut';
    case 'lead_routed_in':      return 'routedIn';
    default:                    return 'runs';
  }
}

function emptyTotals(): RepRollup['totals'] {
  return {
    all: 0, completed: 0, queued: 0, failed: 0,
    demos: 0, stageMoves: 0, reviews: 0, drafts: 0,
    routedOut: 0, routedIn: 0, runs: 0,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const ctx = await getManagerMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const daysRaw = parseInt(url.searchParams.get('days') ?? '30', 10);
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(90, daysRaw)) : 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // 1. Rep members of this team
  const { data: memberships, error: memErr } = await supabase
    .from('TeamMembership')
    .select('userId, role')
    .eq('teamId', ctx.team.id);
  if (memErr) {
    logger.error('[manager/agent-activity] member fetch failed', { teamId: ctx.team.id }, memErr);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
  const memberUserIds = (memberships ?? []).map((m) => m.userId as string);

  if (memberUserIds.length === 0) {
    return NextResponse.json<ResponseShape>({
      windowDays: days,
      generatedAt: new Date().toISOString(),
      reps: [],
      team: { totals: emptyTotals(), repCount: 0 },
    });
  }

  // 2. Spaces owned by those members (the spaceId on AgentActivityLog rows)
  const { data: spacesData, error: spacesErr } = await supabase
    .from('Space')
    .select('id, slug, ownerId')
    .in('ownerId', memberUserIds);
  if (spacesErr) {
    logger.error('[manager/agent-activity] space fetch failed', { teamId: ctx.team.id }, spacesErr);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
  const spaces = (spacesData ?? []) as { id: string; slug: string; ownerId: string }[];
  const spaceIds = spaces.map((s) => s.id);

  if (spaceIds.length === 0) {
    return NextResponse.json<ResponseShape>({
      windowDays: days,
      generatedAt: new Date().toISOString(),
      reps: [],
      team: { totals: emptyTotals(), repCount: 0 },
    });
  }

  // 3. User display info for the rollup
  const { data: usersData, error: usersErr } = await supabase
    .from('User')
    .select('id, name, email')
    .in('id', memberUserIds);
  if (usersErr) {
    logger.error('[manager/agent-activity] user fetch failed', { teamId: ctx.team.id }, usersErr);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
  const userById = new Map(
    ((usersData ?? []) as { id: string; name: string | null; email: string | null }[]).map(
      (u) => [u.id, u],
    ),
  );

  // 4. AgentActivityLog rows in the window. Capped at 5k so a single
  //    runaway space can't blow the response. Spaces past the cap will
  //    under-report — surface that in metadata if it ever bites us.
  const { data: logs, error: logsErr } = await supabase
    .from('AgentActivityLog')
    .select('spaceId, actionType, outcome, createdAt')
    .in('spaceId', spaceIds)
    .gte('createdAt', since)
    .order('createdAt', { ascending: false })
    .limit(5000);
  if (logsErr) {
    logger.error('[manager/agent-activity] log fetch failed', { teamId: ctx.team.id }, logsErr);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }

  // 5. Group by space → rep
  const rollupBySpace = new Map<string, RepRollup>();
  for (const space of spaces) {
    const user = userById.get(space.ownerId);
    rollupBySpace.set(space.id, {
      userId: space.ownerId,
      name: user?.name ?? null,
      email: user?.email ?? null,
      spaceId: space.id,
      spaceSlug: space.slug,
      totals: emptyTotals(),
      lastActivityAt: null,
    });
  }

  const teamTotals = emptyTotals();

  for (const row of (logs ?? []) as Array<{
    spaceId: string;
    actionType: string;
    outcome: string;
    createdAt: string;
  }>) {
    const r = rollupBySpace.get(row.spaceId);
    if (!r) continue;

    r.totals.all += 1;
    teamTotals.all += 1;

    if (row.outcome === 'completed') { r.totals.completed += 1; teamTotals.completed += 1; }
    else if (row.outcome === 'queued_for_approval') { r.totals.queued += 1; teamTotals.queued += 1; }
    else if (row.outcome === 'failed') { r.totals.failed += 1; teamTotals.failed += 1; }

    const bucket = bucketFor(row.actionType);
    r.totals[bucket] += 1;
    teamTotals[bucket] += 1;

    if (!r.lastActivityAt || row.createdAt > r.lastActivityAt) {
      r.lastActivityAt = row.createdAt;
    }
  }

  // 6. Sort reps: most active first, then alphabetical for the dead-quiet ones
  const reps = Array.from(rollupBySpace.values()).sort((a, b) => {
    if (b.totals.all !== a.totals.all) return b.totals.all - a.totals.all;
    const an = (a.name ?? a.email ?? '').toLowerCase();
    const bn = (b.name ?? b.email ?? '').toLowerCase();
    return an.localeCompare(bn);
  });

  return NextResponse.json<ResponseShape>({
    windowDays: days,
    generatedAt: new Date().toISOString(),
    reps,
    team: {
      totals: teamTotals,
      repCount: reps.length,
    },
  });
}
