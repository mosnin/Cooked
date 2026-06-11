import { getManagerMemberContext } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { DealRoutingRuleRow } from '@/lib/routing-rule-schema';
import RulesClient from './rules-client';

export const metadata = { title: 'Routing rules — Teams' };

type TeamMember = { userId: string; role: string; name: string | null; email: string };

/**
 * Server component — seeds the client with the current assignmentMethod,
 * initial rule list, and team member directory so the editor
 * dialog can render a destination-agent dropdown without an extra
 * network round-trip.
 *
 * All three fetches degrade gracefully: a missing DealRoutingRule table
 * (pre-migration) returns [], and any error falls back to an empty
 * seed so the client renders an empty-state instead of crashing.
 */
export default async function RoutingRulesPage() {
  const ctx = await getManagerMemberContext();
  if (!ctx) redirect('/');

  // Rule list (pre-sorted for evaluation order).
  let initialRules: DealRoutingRuleRow[] = [];
  const ruleRes = await supabase
    .from('DealRoutingRule')
    .select(
      'id, teamId, name, priority, enabled, leadType, minBudget, maxBudget, matchTag, destinationUserId, destinationPoolMethod, destinationPoolTag, createdAt, updatedAt',
    )
    .eq('teamId', ctx.team.id)
    .order('priority', { ascending: true })
    .order('createdAt', { ascending: true });
  if (!ruleRes.error && ruleRes.data) {
    initialRules = ruleRes.data as DealRoutingRuleRow[];
  }

  // Member directory for the destination dropdown.
  let members: TeamMember[] = [];
  const memRes = await supabase
    .from('TeamMembership')
    .select('userId, role')
    .eq('teamId', ctx.team.id)
    .in('role', ['manager_owner', 'manager_admin', 'rep_member']);
  if (!memRes.error && memRes.data) {
    const rows = memRes.data as Array<{ userId: string; role: string }>;
    const userIds = rows.map((r) => r.userId);
    if (userIds.length > 0) {
      const userRes = await supabase
        .from('User')
        .select('id, name, email')
        .in('id', userIds);
      if (!userRes.error && userRes.data) {
        const userRows = userRes.data as Array<{ id: string; name: string | null; email: string }>;
        const byId = new Map(userRows.map((u) => [u.id, u]));
        members = rows
          .map((r) => {
            const u = byId.get(r.userId);
            if (!u) return null;
            return { userId: r.userId, role: r.role, name: u.name, email: u.email };
          })
          .filter((m): m is TeamMember => m !== null);
      }
    }
  }

  // Current fallback method, so empty-state copy can reflect it.
  let fallbackMethod: 'manual' | 'round_robin' | 'score_based' = 'manual';
  const bkRes = await supabase
    .from('Team')
    .select('assignmentMethod, autoAssignEnabled')
    .eq('id', ctx.team.id)
    .maybeSingle();
  if (!bkRes.error && bkRes.data) {
    const row = bkRes.data as {
      assignmentMethod?: string | null;
      autoAssignEnabled?: boolean | null;
    };
    if (
      row.assignmentMethod === 'round_robin' ||
      row.assignmentMethod === 'score_based' ||
      row.assignmentMethod === 'manual'
    ) {
      fallbackMethod = row.assignmentMethod;
    }
  }

  const canEdit =
    ctx.membership.role === 'manager_owner' || ctx.membership.role === 'manager_admin';

  return (
    <RulesClient
      initialRules={initialRules}
      members={members}
      fallbackMethod={fallbackMethod}
      canEdit={canEdit}
    />
  );
}
