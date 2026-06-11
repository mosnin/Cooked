/**
 * `summarize_rep` — manager-only rollup of one rep's recent activity.
 *
 * Read-only. Gated on the caller having a manager_owner / manager_admin
 * TeamMembership for the rep's team. The check mirrors the
 * existing pattern in `lib/permissions.ts` (TeamMembership row with
 * role IN ('manager_owner','manager_admin')) but operates on `ctx.userId`
 * (Clerk) rather than going through `auth()` since tools have ctx pre-resolved.
 *
 * Returns: deals (active/won/lost), contacts (newPersons/hotPersons), drafts
 * (pending/sent/approvalRate). All scoped to the rep's space + windowDays.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { defineTool } from '../types';

const parameters = z
  .object({
    repUserId: z.string().min(1).describe('User.id of the rep to summarise.'),
    windowDays: z.number().int().min(1).max(90).optional().default(7),
  })
  .describe('Roll up one rep\'s recent activity. Manager access required.');

interface SummarizeRepResult {
  rep: { name: string | null; email: string };
  deals: { active: number; won: number; lost: number };
  contacts: { newPersons: number; hotPersons: number };
  drafts: { pending: number; sent: number; approvalRate: number | null };
}

export const summarizeRepTool = defineTool<typeof parameters, SummarizeRepResult>({
  name: 'summarize_rep',
  riskLevel: 'safe',
  description:
    'Manager-only. Roll up one rep\'s deals, contacts, and drafts over the last N days (default 7).',
  parameters,
  requiresApproval: false,

  async handler(args, ctx) {
    // ── Caller must be manager_owner / manager_admin somewhere ────────────────
    const { data: callerUser } = await supabase
      .from('User')
      .select('id')
      .eq('clerkId', ctx.userId)
      .maybeSingle();
    if (!callerUser) {
      return { summary: 'Manager access required.', display: 'error' };
    }
    const { data: callerMemberships } = await supabase
      .from('TeamMembership')
      .select('teamId, role')
      .eq('userId', (callerUser as { id: string }).id)
      .in('role', ['manager_owner', 'manager_admin']);
    const callerTeamIds = new Set(
      ((callerMemberships ?? []) as Array<{ teamId: string }>).map((m) => m.teamId),
    );
    if (callerTeamIds.size === 0) {
      return { summary: 'Manager access required.', display: 'error' };
    }

    // ── Rep must be in one of the caller's teams ───────────────────
    const { data: repMembership } = await supabase
      .from('TeamMembership')
      .select('teamId, userId')
      .eq('userId', args.repUserId)
      .maybeSingle();
    if (!repMembership) {
      return { summary: 'That user is not a team member.', display: 'error' };
    }
    if (!callerTeamIds.has((repMembership as { teamId: string }).teamId)) {
      return { summary: 'Manager access required for that rep.', display: 'error' };
    }

    // ── Fetch rep profile + their space ────────────────────────────────
    const [{ data: rep }, { data: space }] = await Promise.all([
      supabase
        .from('User')
        .select('id, name, email')
        .eq('id', args.repUserId)
        .maybeSingle(),
      supabase
        .from('Space')
        .select('id')
        .eq('ownerId', args.repUserId)
        .maybeSingle(),
    ]);
    if (!rep) {
      return { summary: 'Rep not found.', display: 'error' };
    }
    if (!space) {
      return {
        summary: `${(rep as { name: string | null }).name ?? 'Rep'} has no workspace yet.`,
        display: 'error',
      };
    }
    const spaceId = (space as { id: string }).id;

    const windowDays = args.windowDays ?? 7;
    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    // ── Pull aggregates in parallel. We over-select where the count matters
    //    little (drafts) and use head:false counts where it doesn't.
    const [dealsRes, newContactsRes, hotContactsRes, draftsRes] = await Promise.all([
      supabase
        .from('Deal')
        .select('status, updatedAt')
        .eq('spaceId', spaceId)
        .gte('updatedAt', since),
      supabase
        .from('Contact')
        .select('id', { count: 'exact', head: true })
        .eq('spaceId', spaceId)
        .is('teamId', null)
        .gte('createdAt', since),
      supabase
        .from('Contact')
        .select('id', { count: 'exact', head: true })
        .eq('spaceId', spaceId)
        .is('teamId', null)
        .eq('scoreLabel', 'hot'),
      supabase
        .from('AgentDraft')
        .select('status')
        .eq('spaceId', spaceId)
        .gte('createdAt', since),
    ]);

    const dealRows = (dealsRes.data ?? []) as Array<{ status: string }>;
    const deals = {
      active: dealRows.filter((d) => d.status === 'active').length,
      won: dealRows.filter((d) => d.status === 'won').length,
      lost: dealRows.filter((d) => d.status === 'lost').length,
    };

    const draftRows = (draftsRes.data ?? []) as Array<{ status: string }>;
    const pending = draftRows.filter((d) => d.status === 'pending').length;
    const sent = draftRows.filter((d) => d.status === 'sent').length;
    const decided = draftRows.filter((d) => d.status === 'sent' || d.status === 'dismissed').length;
    const approvalRate = decided === 0 ? null : sent / decided;

    const profile = rep as { name: string | null; email: string };
    const result: SummarizeRepResult = {
      rep: { name: profile.name, email: profile.email },
      deals,
      contacts: {
        newPersons: newContactsRes.count ?? 0,
        hotPersons: hotContactsRes.count ?? 0,
      },
      drafts: { pending, sent, approvalRate },
    };

    return {
      summary: `${profile.name ?? profile.email}: ${deals.active} active, ${deals.won} won, ${result.contacts.newPersons} new, ${pending} pending drafts.`,
      data: result,
      display: 'plain',
    };
  },
});
