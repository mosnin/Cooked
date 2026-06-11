import { redirect } from 'next/navigation';
import { getManagerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { AgentActivityClient, type RepRollup, type ResponseShape } from './agent-activity-client';

const DEFAULT_WINDOW_DAYS = 30;
const ROLLUP_LOG_CAP = 5000;

type Bucket =
  | 'demos'
  | 'stageMoves'
  | 'reviews'
  | 'drafts'
  | 'routedOut'
  | 'routedIn'
  | 'runs';

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

// Compute the rollup directly here on the server — saves the API
// round-trip for the initial paint. The client refetches via
// /api/manager/agent-activity when the rep changes the window.
async function rollupForTeam(teamId: string, windowDays: number): Promise<ResponseShape> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const generatedAt = new Date().toISOString();

  const { data: memberships } = await supabase
    .from('TeamMembership')
    .select('userId')
    .eq('teamId', teamId);
  const memberUserIds = (memberships ?? []).map((m) => m.userId as string);

  if (memberUserIds.length === 0) {
    return {
      windowDays,
      generatedAt,
      reps: [],
      team: { totals: emptyTotals(), repCount: 0 },
    };
  }

  const { data: spacesData } = await supabase
    .from('Space')
    .select('id, slug, ownerId')
    .in('ownerId', memberUserIds);
  const spaces = (spacesData ?? []) as Array<{ id: string; slug: string; ownerId: string }>;
  const spaceIds = spaces.map((s) => s.id);

  if (spaceIds.length === 0) {
    return {
      windowDays,
      generatedAt,
      reps: [],
      team: { totals: emptyTotals(), repCount: 0 },
    };
  }

  const { data: usersData } = await supabase
    .from('User')
    .select('id, name, email')
    .in('id', memberUserIds);
  const userById = new Map(
    ((usersData ?? []) as Array<{ id: string; name: string | null; email: string | null }>).map(
      (u) => [u.id, u],
    ),
  );

  const { data: logs } = await supabase
    .from('AgentActivityLog')
    .select('spaceId, actionType, outcome, createdAt')
    .in('spaceId', spaceIds)
    .gte('createdAt', since)
    .order('createdAt', { ascending: false })
    .limit(ROLLUP_LOG_CAP);

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

  const reps = Array.from(rollupBySpace.values()).sort((a, b) => {
    if (b.totals.all !== a.totals.all) return b.totals.all - a.totals.all;
    const an = (a.name ?? a.email ?? '').toLowerCase();
    const bn = (b.name ?? b.email ?? '').toLowerCase();
    return an.localeCompare(bn);
  });

  return {
    windowDays,
    generatedAt,
    reps,
    team: { totals: teamTotals, repCount: reps.length },
  };
}

export default async function ManagerAgentActivityPage() {
  const ctx = await getManagerMemberContext();
  if (!ctx) redirect('/');

  const initial = await rollupForTeam(ctx.team.id, DEFAULT_WINDOW_DAYS);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-56 md:pb-24">
      <header className="space-y-1.5">
        <p className="text-sm text-muted-foreground">Koala.</p>
        <h1
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          What Koala did
        </h1>
        <p className="text-sm text-muted-foreground">
          Across {ctx.team.name}. Updates as your team works.
        </p>
      </header>

      <AgentActivityClient initial={initial} teamName={ctx.team.name} />
    </div>
  );
}
