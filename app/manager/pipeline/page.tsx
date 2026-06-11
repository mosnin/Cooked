import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { getTeamMembers } from '@/lib/team-members';
import { dealHealth } from '@/lib/deals/health';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { formatCompact } from '@/lib/formatting';
import type { Metadata } from 'next';
import {
  PipelineClient,
  type PipelineDeal,
  type StageInfo,
  type RepInfo,
  type PipelineSummary,
} from './pipeline-client';

export const metadata: Metadata = { title: 'Pipeline — Teams' };

export default async function ManagerPipelinePage() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    redirect('/');
  }

  const { team } = ctx;

  // Get all rep members with their spaces
  const allMembers = await getTeamMembers(team.id, { includeSpaceName: true });
  const members = allMembers.filter((m) => m.role === 'rep_member');

  const spaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];

  // Build space -> rep lookup
  const spaceToRep = new Map<string, { userId: string; name: string }>();
  const reps: RepInfo[] = [];
  for (const m of members) {
    const name = m.User?.name ?? m.User?.email ?? 'Unknown';
    if (m.Space?.id) {
      spaceToRep.set(m.Space?.id, { userId: m.userId, name });
    }
    reps.push({ userId: m.userId, name });
  }

  // Fetch all deals across rep spaces. The health classifier needs
  // followUpAt / nextAction / nextActionDueAt alongside the card fields,
  // so we pull those here and reuse the same rows for both.
  const { data: dealsRaw } = spaceIds.length > 0
    ? await supabase
        .from('Deal')
        .select('id, spaceId, title, description, value, address, priority, closeDate, stageId, status, createdAt, updatedAt, followUpAt, nextAction, nextActionDueAt')
        .in('spaceId', spaceIds)
        .limit(5000)
    : { data: [] };

  // Fetch all deal stages across rep spaces
  const { data: stagesRaw } = spaceIds.length > 0
    ? await supabase
        .from('DealStage')
        .select('id, spaceId, name, color, position')
        .in('spaceId', spaceIds)
        .order('position', { ascending: true })
        .limit(1000)
    : { data: [] };

  // Build stage lookup
  const stageMap = new Map<string, { name: string; color: string; position: number }>();
  for (const s of (stagesRaw ?? []) as { id: string; spaceId: string; name: string; color: string; position: number }[]) {
    stageMap.set(s.id, { name: s.name, color: s.color, position: s.position });
  }

  // Deduplicate stage names across spaces for the pipeline chart
  const stageNames = new Map<string, StageInfo>();
  for (const s of (stagesRaw ?? []) as { id: string; name: string; color: string; position: number }[]) {
    if (!stageNames.has(s.name)) {
      stageNames.set(s.name, { name: s.name, color: s.color, position: s.position });
    }
  }
  const stages: StageInfo[] = Array.from(stageNames.values()).sort((a, b) => a.position - b.position);

  // Build deals list
  type DealRow = {
    id: string;
    spaceId: string;
    title: string;
    description: string | null;
    value: number | null;
    address: string | null;
    priority: string;
    closeDate: string | null;
    stageId: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    followUpAt: string | null;
    nextAction: string | null;
    nextActionDueAt: string | null;
  };

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let totalPipelineValue = 0;
  let activeDeals = 0;
  let dealsWonThisMonth = 0;
  let dealsLostThisMonth = 0;
  let atRiskCount = 0;
  let stuckCount = 0;
  // Per-agent risk rollup so the dashboard can surface "Alice has 3 stuck
  // deals" at a glance without the manager pivoting through every card.
  const riskByAgent = new Map<string, { agentName: string; atRisk: number; stuck: number }>();

  const deals: PipelineDeal[] = [];

  for (const d of (dealsRaw ?? []) as DealRow[]) {
    const rep = spaceToRep.get(d.spaceId);
    const stage = stageMap.get(d.stageId);

    // Classify deal health — dealHealth() already returns 'on-track' for
    // non-active deals, so we always call it and let it decide.
    const health = dealHealth({
      status: d.status as 'active' | 'won' | 'lost' | 'on_hold',
      updatedAt: new Date(d.updatedAt),
      closeDate: d.closeDate ? new Date(d.closeDate) : null,
      followUpAt: d.followUpAt ? new Date(d.followUpAt) : null,
      nextAction: d.nextAction,
      nextActionDueAt: d.nextActionDueAt ? new Date(d.nextActionDueAt) : null,
    });

    const deal: PipelineDeal = {
      id: d.id,
      title: d.title,
      value: d.value,
      priority: d.priority as 'LOW' | 'MEDIUM' | 'HIGH',
      closeDate: d.closeDate,
      status: d.status as 'active' | 'won' | 'lost' | 'on_hold',
      stageName: stage?.name ?? 'Unknown',
      stageColor: stage?.color ?? '#888',
      agentName: rep?.name ?? 'Unknown',
      agentUserId: rep?.userId ?? '',
      createdAt: d.createdAt,
      health: health.state,
      healthReason: health.reason,
    };

    deals.push(deal);

    // Aggregate summaries
    if (d.status === 'active' || d.status === 'on_hold') {
      totalPipelineValue += d.value ?? 0;
      activeDeals += 1;
    }

    if (health.state === 'at-risk' || health.state === 'stuck') {
      if (health.state === 'at-risk') atRiskCount += 1;
      else stuckCount += 1;
      const key = rep?.userId ?? 'unknown';
      const row = riskByAgent.get(key) ?? {
        agentName: rep?.name ?? 'Unknown',
        atRisk: 0,
        stuck: 0,
      };
      if (health.state === 'at-risk') row.atRisk += 1;
      else row.stuck += 1;
      riskByAgent.set(key, row);
    }

    const updatedAt = new Date(d.updatedAt);
    if (d.status === 'won' && updatedAt >= startOfMonth) {
      dealsWonThisMonth += 1;
    }
    if (d.status === 'lost' && updatedAt >= startOfMonth) {
      dealsLostThisMonth += 1;
    }
  }

  const summary: PipelineSummary = {
    totalPipelineValue,
    activeDeals,
    dealsWonThisMonth,
    dealsLostThisMonth,
    atRiskCount,
    stuckCount,
    // Sort descending by stuck then at-risk so the worst agent lands first.
    agentRisk: Array.from(riskByAgent.values()).sort(
      (a, b) => b.stuck - a.stuck || b.atRisk - a.atRisk,
    ),
  };

  // Status sentence — calm fact from the data already on the page.
  const statusSentence = (() => {
    if (activeDeals === 0) {
      return 'No active deals yet.';
    }
    return `${formatCompact(totalPipelineValue)} across ${activeDeals} active ${activeDeals === 1 ? 'deal' : 'deals'}.`;
  })();

  return (
    <div className="space-y-8 pb-56 md:pb-24">
      <header className="space-y-1.5">
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Pipeline
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence}</p>
      </header>

      <PipelineClient
        deals={deals}
        stages={stages}
        reps={reps}
        summary={summary}
      />
    </div>
  );
}
