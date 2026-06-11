/**
 * Speed-to-lead enforcement — the agentic half of team lead routing.
 *
 * Routing already puts a lead in a rep's hands (auto-assign + DealRoutingRule
 * → a Contact clone tagged `assigned-by-manager` in the rep's space). This is
 * the part that makes sure it's actually WORKED: a sweep that finds routed leads
 * sitting un-touched past the team's SLA and acts on the manager's behalf —
 * nudging the rep first, escalating to the manager if it stays cold.
 *
 * Detection needs no extra schema:
 *   - a routed lead  = Contact in a member space tagged `assigned-by-manager`
 *   - un-worked      = `lastContactedAt IS NULL`
 *   - the clock      = the clone's `createdAt` (= assignment time)
 *
 * Idempotency is carried on the contact's own tags: once Koala nudges it gets
 * `sla-nudged`; once it escalates it gets `sla-escalated`. The sweep skips a
 * lead it has already acted on at that level, so running every 15 minutes never
 * double-pings.
 */

import { supabase } from '@/lib/supabase';
import { getTeamMembers } from '@/lib/team-members';
import { notifyManager } from '@/lib/manager-notify';
import { sendPushToSpace } from '@/lib/push';
import { logger } from '@/lib/logger';

export interface TeamSlaPolicy {
  id: string;
  name: string;
  slaFirstResponseMinutes: number;
  slaEscalateMinutes: number;
}

export interface SlaSweepResult {
  teamId: string;
  breached: number;
  nudged: number;
  escalated: number;
}

const NUDGED_TAG = 'sla-nudged';
const ESCALATED_TAG = 'sla-escalated';

function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/**
 * Run the speed-to-lead sweep for one team. Best-effort throughout — a
 * single contact failing never aborts the rest. Returns what Koala did.
 */
export async function sweepTeamSla(team: TeamSlaPolicy): Promise<SlaSweepResult> {
  const result: SlaSweepResult = { teamId: team.id, breached: 0, nudged: 0, escalated: 0 };

  // ── Member spaces + rep names ──────────────────────────────────────────
  const members = await getTeamMembers(team.id, { includeSpaceName: true });
  const spaceIds: string[] = [];
  const spaceToRep = new Map<string, string>();
  for (const m of members) {
    const sid = m.Space?.id;
    if (!sid) continue;
    spaceIds.push(sid);
    spaceToRep.set(sid, m.User?.name ?? m.User?.email ?? 'a rep');
  }
  if (spaceIds.length === 0) return result;

  // First-response threshold: any routed lead created before this has now sat
  // longer than the team allows.
  const firstThreshold = new Date(Date.now() - team.slaFirstResponseMinutes * 60000).toISOString();

  const { data, error } = await supabase
    .from('Contact')
    .select('id, name, spaceId, tags, createdAt, lastContactedAt')
    .in('spaceId', spaceIds)
    .contains('tags', ['assigned-by-manager'])
    .is('lastContactedAt', null)
    .lte('createdAt', firstThreshold)
    .limit(2000);
  if (error) {
    logger.error('[manager-sla] breach query failed', { teamId: team.id }, error);
    return result;
  }

  const rows = (data ?? []) as {
    id: string;
    name: string;
    spaceId: string;
    tags: string[] | null;
    createdAt: string;
  }[];

  for (const c of rows) {
    const tags = c.tags ?? [];
    const waited = minutesSince(c.createdAt);
    const rep = spaceToRep.get(c.spaceId) ?? 'a rep';
    result.breached += 1;

    try {
      // Past the escalation window → the rep has had their chance; pull in
      // the manager (their decision whether to reassign — nothing fires without
      // a human's name on it).
      if (waited >= team.slaEscalateMinutes) {
        if (tags.includes(ESCALATED_TAG)) continue;
        await notifyManager({
          teamId: team.id,
          type: 'review_requested',
          title: `${c.name} still hasn't been contacted`,
          body: `Assigned to ${rep} ${waited} minutes ago and still no first response. Reassign or step in.`,
          metadata: { kind: 'lead_sla_breach', contactId: c.id, spaceId: c.spaceId, rep, waitedMinutes: waited },
        });
        await supabase
          .from('Contact')
          .update({ tags: [...tags, ESCALATED_TAG] })
          .eq('id', c.id);
        result.escalated += 1;
        continue;
      }

      // Past first-response but inside the escalation window → nudge the rep.
      if (tags.includes(NUDGED_TAG)) continue;
      await sendPushToSpace(c.spaceId, {
        title: 'A lead is waiting on you',
        body: `${c.name} has been waiting ${waited} minutes. Reach out now.`,
      }).catch(() => 0);
      await supabase
        .from('Contact')
        .update({ tags: [...tags, NUDGED_TAG] })
        .eq('id', c.id);
      result.nudged += 1;
    } catch (err) {
      logger.warn('[manager-sla] action failed for contact', { teamId: team.id, contactId: c.id }, err);
    }
  }

  return result;
}

/**
 * Run the sweep for every team that has SLA enforcement on. Used by the
 * cron route.
 */
export async function sweepAllTeams(): Promise<SlaSweepResult[]> {
  const { data, error } = await supabase
    .from('Team')
    .select('id, name, slaFirstResponseMinutes, slaEscalateMinutes')
    .eq('slaEnabled', true)
    .limit(5000);
  if (error) {
    logger.error('[manager-sla] failed to load teams', {}, error);
    return [];
  }
  const policies = (data ?? []) as TeamSlaPolicy[];
  const out: SlaSweepResult[] = [];
  for (const p of policies) {
    try {
      out.push(await sweepTeamSla(p));
    } catch (err) {
      logger.error('[manager-sla] team sweep threw', { teamId: p.id }, err);
    }
  }
  return out;
}
