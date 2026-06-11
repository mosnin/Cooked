import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { getTeamMembers } from '@/lib/team-members';
import type { Metadata } from 'next';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { ManagerLeadsClient, type LeadRow, type RepOption, type AssignedLeadProgress } from './manager-leads-client';

export const metadata: Metadata = { title: 'Leads — Teams' };

export default async function ManagerLeadsPage() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    redirect('/');
  }

  const { team } = ctx;

  // 1. TEAM LEADS — from team intake form
  // Primary path: teamId is set.
  const { data: teamAllByTeamId } = await supabase
    .from('Contact')
    .select('id, name, email, phone, budget, scoreLabel, leadScore, leadType, tags, createdAt, notes, applicationData, applicationStatusNote')
    .eq('teamId', team.id)
    .order('createdAt', { ascending: false })
    .limit(500);

  // Legacy compatibility: include team-tagged leads that were saved into
  // the manager owner's space before teamId was consistently populated.
  const { data: ownerSpaces } = await supabase
    .from('Space')
    .select('id')
    .eq('ownerId', team.ownerId)
    .limit(10);
  const ownerSpaceIds = (ownerSpaces ?? []).map((s: { id: string }) => s.id);

  const { data: teamUnassignedLegacy } = ownerSpaceIds.length > 0
    ? await supabase
        .from('Contact')
        .select('id, name, email, phone, budget, scoreLabel, leadScore, leadType, tags, createdAt, notes, applicationData, applicationStatusNote')
        .in('spaceId', ownerSpaceIds)
        .is('teamId', null)
        .contains('tags', ['team-lead'])
        .order('createdAt', { ascending: false })
        .limit(200)
    : { data: [] };
  const teamAll = [
    ...(teamAllByTeamId ?? []),
    ...((teamUnassignedLegacy ?? []).filter(
      (c: any) => !(teamAllByTeamId ?? []).some((p: any) => p.id === c.id)
    )),
  ];
  const teamUnassigned = teamAll.filter((c: any) => !(c.tags ?? []).includes('assigned'));
  const teamAssigned = teamAll.filter((c: any) => (c.tags ?? []).includes('assigned'));

  // 2. MEMBER LEADS — from individual rep intake forms, visible to admins
  const allMembers = await getTeamMembers(team.id, { includeSpaceName: true });
  const memberSpaceIds = allMembers.map((m) => m.Space?.id).filter(Boolean) as string[];

  // Team leads list should only include leads captured via team intake.
  const unassignedRaw = teamUnassigned ?? [];

  const assignedRaw = teamAssigned ?? [];
  const members = allMembers;

  // Get lead counts per rep space
  const repSpaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];
  const { data: leadCounts } = repSpaceIds.length > 0
    ? await supabase
        .from('Contact')
        .select('spaceId')
        .in('spaceId', repSpaceIds)
        .limit(10000)
    : { data: [] };

  const countBySpace = (leadCounts ?? []).reduce<Record<string, number>>(
    (acc, r: { spaceId: string }) => {
      acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1;
      return acc;
    },
    {}
  );

  const reps: RepOption[] = members.map((m) => ({
    userId: m.userId,
    name: m.User?.name ?? null,
    email: m.User?.email ?? '',
    spaceId: m.Space?.id ?? null,
    leadCount: m.Space?.id ? (countBySpace[m.Space?.id] ?? 0) : 0,
  }));

  type RawContact = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    budget: number | null;
    scoreLabel: string | null;
    leadScore: number | null;
    tags: string[];
    createdAt: string;
    notes: string | null;
    applicationData: Record<string, unknown> | null;
    applicationStatusNote?: string | null;
  };

  // Build a map of userId -> rep name for resolving assignments
  const repNameMap = new Map<string, string>();
  for (const m of members) {
    repNameMap.set(m.userId, m.User?.name ?? m.User?.email ?? 'Unknown');
  }

  // ── Parse assignment metadata from assigned contacts ──────────────────
  type AssignmentMeta = {
    assignedTo: string;
    assignedToName: string;
    assignedContactId: string;
    assignedSpaceId: string;
    assignedAt: string;
  };

  const assignmentMap = new Map<string, AssignmentMeta>();
  const repContactIds: string[] = [];

  for (const c of (assignedRaw ?? []) as RawContact[]) {
    if (c.applicationStatusNote) {
      try {
        const meta = JSON.parse(c.applicationStatusNote) as AssignmentMeta;
        assignmentMap.set(c.id, meta);
        if (meta.assignedContactId) {
          repContactIds.push(meta.assignedContactId);
        }
      } catch {
        // Legacy format or invalid JSON — fall back to notes parsing
      }
    }
  }

  // ── Fetch rep-side contact progress for assigned leads ────────────
  type RepContact = {
    id: string;
    type: string;
    leadScore: number | null;
    scoreLabel: string | null;
    followUpAt: string | null;
    lastContactedAt: string | null;
    updatedAt: string;
  };

  const { data: repContacts } = repContactIds.length > 0
    ? await supabase
        .from('Contact')
        .select('id, type, leadScore, scoreLabel, followUpAt, lastContactedAt, updatedAt')
        .in('id', repContactIds)
        .limit(500)
    : { data: [] };

  const repContactMap = new Map<string, RepContact>();
  for (const rc of (repContacts ?? []) as RepContact[]) {
    repContactMap.set(rc.id, rc);
  }

  // ── Fetch deals linked to rep-side contacts ───────────────────────
  const { data: dealContactLinks } = repContactIds.length > 0
    ? await supabase
        .from('DealContact')
        .select('dealId, contactId')
        .in('contactId', repContactIds)
        .limit(500)
    : { data: [] };

  const contactHasDeal = new Set<string>();
  for (const dc of (dealContactLinks ?? []) as { dealId: string; contactId: string }[]) {
    contactHasDeal.add(dc.contactId);
  }

  // ── Build progress map keyed by manager contact ID ─────────────────────
  const progressMap = new Map<string, AssignedLeadProgress>();

  for (const [managerContactId, meta] of assignmentMap) {
    const rc = repContactMap.get(meta.assignedContactId);
    progressMap.set(managerContactId, {
      repName: meta.assignedToName,
      assignedAt: meta.assignedAt,
      assignedContactId: meta.assignedContactId,
      assignedSpaceId: meta.assignedSpaceId,
      currentStage: (rc?.type as AssignedLeadProgress['currentStage']) ?? 'QUALIFICATION',
      currentScore: rc?.leadScore ?? null,
      currentScoreLabel: rc?.scoreLabel ?? null,
      lastActivityAt: rc?.lastContactedAt ?? rc?.updatedAt ?? null,
      hasFollowUp: rc?.followUpAt != null,
      followUpAt: rc?.followUpAt ?? null,
      hasDeal: contactHasDeal.has(meta.assignedContactId),
    });
  }

  function toLeadRow(c: RawContact): LeadRow {
    const moveTiming = c.applicationData?.targetMoveInDate as string | undefined;

    // Try structured metadata first, fall back to notes parsing
    const meta = assignmentMap.get(c.id);
    let assignedName: string | null = null;
    let assignedAt: string | null = null;

    if (meta) {
      assignedName = meta.assignedToName;
      assignedAt = meta.assignedAt;
    } else {
      // Legacy: parse from notes
      const repIdMatch = c.notes?.match(/Assigned to rep \(([^)]+)\)/);
      assignedName = repIdMatch?.[1]
        ? repNameMap.get(repIdMatch[1]) ?? 'Rep'
        : null;
      const dateMatch = c.notes?.match(/Assigned to rep .+ on (\S+)/);
      assignedAt = dateMatch?.[1] ?? (c.tags.includes('assigned') ? c.createdAt : null);
    }

    return {
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      budget: c.budget,
      scoreLabel: c.scoreLabel,
      leadScore: c.leadScore,
      leadType: (c as any).leadType ?? 'rental',
      moveTiming: moveTiming ?? null,
      createdAt: c.createdAt,
      assignedTo: assignedName,
      assignedAt,
    };
  }

  const unassignedLeads: LeadRow[] = (unassignedRaw ?? []).map((c: unknown) => toLeadRow(c as RawContact));
  const assignedLeads: LeadRow[] = (assignedRaw ?? []).map((c: unknown) => toLeadRow(c as RawContact));

  // Serialize progress map for client
  const assignedLeadProgress: Record<string, AssignedLeadProgress> = {};
  for (const [id, progress] of progressMap) {
    assignedLeadProgress[id] = progress;
  }

  // ── Page-scoped narration. Pick the loudest fact for THIS page: routing
  // load, hot pipeline waiting on someone, or "caught up." Hand-coded ladder.
  const subtitle = (() => {
    const unassignedCount = unassignedLeads.length;
    if (unassignedCount > 0) {
      return `${unassignedCount} ${unassignedCount === 1 ? 'lead' : 'leads'} landed unassigned. Route ${unassignedCount === 1 ? 'it' : 'them'}.`;
    }
    const hotAssigned = assignedLeads.filter(
      (l) => l.scoreLabel?.toLowerCase() === 'hot',
    ).length;
    if (hotAssigned > 0) {
      return `${hotAssigned} hot ${hotAssigned === 1 ? 'lead' : 'leads'} on a rep's plate. Check in.`;
    }
    const total = unassignedCount + assignedLeads.length;
    if (total === 0) {
      return 'No leads yet. The intake form is waiting.';
    }
    return `Caught up. ${total} ${total === 1 ? 'lead' : 'leads'} in the team.`;
  })();

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Leads.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Your team&rsquo;s intake
        </h1>
        <p className={cn(BODY_MUTED)}>{subtitle}</p>
      </header>

      <ManagerLeadsClient
        unassignedLeads={unassignedLeads}
        assignedLeads={assignedLeads}
        reps={reps}
        assignedLeadProgress={assignedLeadProgress}
      />
    </div>
  );
}
