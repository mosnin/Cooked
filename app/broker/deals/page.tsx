import { redirect } from 'next/navigation';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { supabase } from '@/lib/supabase';
import { dealHealth, HEALTH_META } from '@/lib/deals/health';
import { formatCompact } from '@/lib/formatting';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_RHYTHM,
} from '@/lib/typography';
import { cn } from '@/lib/utils';
import { BrokerKanbanBoard } from './broker-kanban-board';
import type { BrokerDealItem } from './broker-deal-card';
import type { BrokerKanbanColumn } from './broker-kanban-board';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Deals — Brokerage' };

// ── Types ────────────────────────────────────────────────────────────────────

type DealRow = {
  id: string;
  spaceId: string;
  title: string;
  value: number | null;
  commissionRate: number | null;
  address: string | null;
  closeDate: string | null;
  stageId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  stageChangedAt: string | null;
  followUpAt: string | null;
  nextAction: string | null;
  nextActionDueAt: string | null;
};

type StageRow = {
  id: string;
  name: string;
  color: string;
  position: number;
  spaceId: string;
};

/**
 * Stage-column mapping.
 *
 * Because each realtor can have custom stage names, we build columns from
 * the actual stages present in the data rather than a fixed canonical list.
 * The algorithm:
 *
 *  1. Collect every distinct stage name (case-insensitive key).
 *  2. Track the lowest position seen for each name across all pipelines —
 *     this is a reasonable proxy for "how early in the pipeline is this
 *     stage?" when realtors name them the same.
 *  3. Pick one representative color per name (from the stage whose position
 *     is the lowest — i.e. the "official" first occurrence).
 *  4. Sort columns by that minimum-position, ascending.
 *
 * The result: the broker sees a kanban whose column order mirrors the
 * realtor pipeline direction even across mixed stage names.
 */
function buildColumns(
  stages: StageRow[],
  dealsWithRealtor: Array<BrokerDealItem & { stageId: string }>,
): BrokerKanbanColumn[] {
  // Normalize key: lowercase + trim
  const key = (name: string) => name.toLowerCase().trim();

  // Per-name: track min position, representative name (first seen), color
  const nameMap = new Map<
    string,
    { id: string; name: string; color: string; minPosition: number }
  >();

  for (const stage of stages) {
    const k = key(stage.name);
    const existing = nameMap.get(k);
    if (!existing || stage.position < existing.minPosition) {
      nameMap.set(k, {
        // Use the stage id that has the lowest position as the column id
        // (deterministic, stable across renders)
        id: existing && existing.minPosition <= stage.position ? existing.id : stage.id,
        name: existing && existing.minPosition <= stage.position ? existing.name : stage.name,
        color: existing && existing.minPosition <= stage.position ? existing.color : stage.color,
        minPosition: Math.min(existing?.minPosition ?? Infinity, stage.position),
      });
    }
  }

  // Build stageId → column key lookup so we can slot each deal fast
  const stageIdToKey = new Map<string, string>();
  for (const stage of stages) {
    stageIdToKey.set(stage.id, key(stage.name));
  }

  // Sort columns by minPosition
  const sortedColumns = Array.from(nameMap.entries()).sort(
    ([, a], [, b]) => a.minPosition - b.minPosition,
  );

  // Build columns with empty deal lists first
  const columnMap = new Map<string, BrokerKanbanColumn>();
  for (const [k, meta] of sortedColumns) {
    columnMap.set(k, {
      id: meta.id,
      name: meta.name,
      color: meta.color,
      deals: [],
    });
  }

  // Slot deals into columns. Deals whose stageId has no matching stage get
  // an "Other" column at the end.
  const unmapped: Array<BrokerDealItem & { stageId: string }> = [];
  for (const deal of dealsWithRealtor) {
    const colKey = stageIdToKey.get(deal.stageId);
    if (colKey && columnMap.has(colKey)) {
      columnMap.get(colKey)!.deals.push(deal);
    } else {
      unmapped.push(deal);
    }
  }

  const result = Array.from(columnMap.values());

  if (unmapped.length > 0) {
    result.push({
      id: 'other',
      name: 'Other',
      color: '#6b7280',
      deals: unmapped,
    });
  }

  // Within each column: sort stuck/at-risk first, then by value descending.
  const HEALTH_RANK: Record<string, number> = { stuck: 0, 'at-risk': 1, 'on-track': 2 };
  for (const col of result) {
    col.deals.sort((a, b) => {
      const ha = dealHealth({
        status: a.status,
        stageChangedAt: a.stageChangedAt,
        updatedAt: a.updatedAt,
        closeDate: a.closeDate,
        followUpAt: a.followUpAt,
        nextAction: a.nextAction,
        nextActionDueAt: a.nextActionDueAt,
      });
      const hb = dealHealth({
        status: b.status,
        stageChangedAt: b.stageChangedAt,
        updatedAt: b.updatedAt,
        closeDate: b.closeDate,
        followUpAt: b.followUpAt,
        nextAction: b.nextAction,
        nextActionDueAt: b.nextActionDueAt,
      });
      const rankDiff = (HEALTH_RANK[ha.state] ?? 2) - (HEALTH_RANK[hb.state] ?? 2);
      if (rankDiff !== 0) return rankDiff;
      return (b.value ?? 0) - (a.value ?? 0);
    });
  }

  // Drop empty columns — a broker pipeline with all-empty columns is noise.
  return result.filter((c) => c.deals.length > 0);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function BrokerDealsPage() {
  const ctx = await resolveBrokerContext();
  if (!ctx) redirect('/');

  const { brokerage } = ctx;

  // Resolve ALL brokerage members — same pattern as the previous page.
  const allMembers = await getBrokerageMembers(brokerage.id, {
    includeSpaceName: true,
  });

  const memberSpaceIds = allMembers
    .map((m) => m.Space?.id)
    .filter(Boolean) as string[];

  // Belt-and-suspenders: if owner has a space not in memberships, include it.
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

  // Build spaceId to realtor name lookup
  const spaceToRealtor = new Map<string, string>();
  for (const m of allMembers) {
    const sid = m.Space?.id;
    if (!sid) continue;
    spaceToRealtor.set(sid, m.User?.name ?? m.User?.email ?? 'Unknown');
  }

  // Fetch active deals only — the kanban shows the live pipeline.
  // Won/lost/on-hold deals are closed chapter; the broker oversight
  // story is about what's in-flight right now.
  const { data: dealsRaw } = spaceIds.length > 0
    ? await supabase
        .from('Deal')
        .select(
          'id, spaceId, title, value, commissionRate, address, closeDate, stageId, status, createdAt, updatedAt, stageChangedAt, followUpAt, nextAction, nextActionDueAt',
        )
        .in('spaceId', spaceIds)
        .eq('status', 'active')
        .order('createdAt', { ascending: false })
        .limit(5000)
    : { data: [] as DealRow[] };

  // Fetch stages for all spaces
  const { data: stagesRaw } = spaceIds.length > 0
    ? await supabase
        .from('DealStage')
        .select('id, name, color, position, spaceId')
        .in('spaceId', spaceIds)
        .order('position', { ascending: true })
        .limit(2000)
    : { data: [] as StageRow[] };

  const stages = (stagesRaw ?? []) as StageRow[];

  // ── Enrich deals with realtor names ──────────────────────────────────────

  const allDeals: Array<BrokerDealItem & { stageId: string }> = [];

  let totalValue = 0;
  let atRiskCount = 0;

  for (const d of (dealsRaw ?? []) as DealRow[]) {
    const realtorName = spaceToRealtor.get(d.spaceId) ?? 'Unknown';

    const stageChangedAt = d.stageChangedAt ? new Date(d.stageChangedAt) : null;
    const updatedAt = new Date(d.updatedAt);
    const closeDate = d.closeDate ? new Date(d.closeDate) : null;
    const followUpAt = d.followUpAt ? new Date(d.followUpAt) : null;
    const nextActionDueAt = d.nextActionDueAt ? new Date(d.nextActionDueAt) : null;

    const health = dealHealth({
      status: d.status as 'active' | 'won' | 'lost' | 'on_hold',
      stageChangedAt,
      updatedAt,
      closeDate,
      followUpAt,
      nextAction: d.nextAction,
      nextActionDueAt,
    });

    if (health.state !== 'on-track') atRiskCount += 1;
    totalValue += d.value ?? 0;

    allDeals.push({
      id: d.id,
      title: d.title,
      address: d.address,
      value: d.value,
      commissionRate: d.commissionRate,
      status: 'active',
      stageChangedAt,
      updatedAt,
      closeDate,
      followUpAt,
      nextAction: d.nextAction,
      nextActionDueAt,
      realtorName,
      // Pass stageId for column slotting; not in BrokerDealItem interface
      stageId: d.stageId,
    });
  }

  // ── Build columns ─────────────────────────────────────────────────────────

  const columns = buildColumns(stages, allDeals);

  // ── Status sentence ───────────────────────────────────────────────────────

  const activeCount = allDeals.length;
  const statusSentence = (() => {
    if (activeCount === 0) return 'No active deals across your brokerage yet.';
    const parts: string[] = [];
    parts.push(
      `${formatCompact(totalValue)} across ${activeCount} active ${activeCount === 1 ? 'deal' : 'deals'}`,
    );
    if (atRiskCount > 0) {
      parts.push(
        `${atRiskCount} ${atRiskCount === 1 ? 'deal needs' : 'deals need'} attention`,
      );
    }
    return `${parts.join(', ')}.`;
  })();

  return (
    <div className={cn('max-w-[1500px] mx-auto pb-12', SECTION_RHYTHM)}>
      {/* Status-sentence header — per STYLESHEET.md §The status-sentence pattern */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Brokerage.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Deals
        </h1>
        <p className={BODY_MUTED}>{statusSentence}</p>
      </header>

      <BrokerKanbanBoard columns={columns} />
    </div>
  );
}
