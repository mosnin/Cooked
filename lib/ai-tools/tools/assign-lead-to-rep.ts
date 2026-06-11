/**
 * `assign_lead_to_rep` — manager reassigns a Contact to a rep.
 *
 * Approval-gated. Manager-only. Mirrors the assignment record-keeping in
 * `app/api/manager/assign-lead/route.ts` (audit metadata in
 * applicationStatusNote, plus a 'note' ContactActivity entry), but
 * intentionally narrower: we update the existing Contact row's audit fields
 * — we do NOT clone the contact into another rep's space here. The
 * route does the clone for first-time assignment from the manager's intake
 * pool. This tool reassigns an already-owned lead within the team,
 * which is a smaller operation. Cloning/notification is what the
 * assign-lead route exists for; the agent should call that surface for
 * first-touch lead drops, not this tool.
 *
 * Note: Contact has no `assignedToUserId` column — assignment is recorded
 * via tags + applicationStatusNote (canonical) and the activity note
 * (audit trail). That's the existing convention.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const parameters = z
  .object({
    personId: z.string().min(1).describe('Contact.id to reassign.'),
    repUserId: z.string().min(1).describe('User.id of the new owner rep.'),
    why: z.string().trim().min(1).max(280).describe('Reassignment reason — appears in the activity log.'),
  })
  .describe('Reassign a Contact to a different rep in the same team.');

interface AssignResult {
  contactId: string;
  repUserId: string;
  repName: string;
}

export const assignLeadToRepTool = defineTool<typeof parameters, AssignResult>({
  name: 'assign_lead_to_rep',
  riskLevel: 'low',
  description:
    'Manager-only. Reassign a Contact to a different rep in the same team. Prompts for approval.',
  parameters,
  requiresApproval: true,
  rateLimit: { max: 60, windowSeconds: 3600 },
  summariseCall(args) {
    return `Reassign contact ${args.personId.slice(0, 8)} → rep ${args.repUserId.slice(0, 8)}: ${args.why}`;
  },

  async handler(args, ctx) {
    // ── Manager-role gate ────────────────────────────────────────────────────
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
      .select('teamId')
      .eq('userId', (callerUser as { id: string }).id)
      .in('role', ['manager_owner', 'manager_admin']);
    const callerTeamIds = new Set(
      ((callerMemberships ?? []) as Array<{ teamId: string }>).map((m) => m.teamId),
    );
    if (callerTeamIds.size === 0) {
      return { summary: 'Manager access required.', display: 'error' };
    }

    // ── Rep must be in the same team ──────────────────────────────
    const { data: repMembership } = await supabase
      .from('TeamMembership')
      .select('teamId, userId')
      .eq('userId', args.repUserId)
      .maybeSingle();
    if (
      !repMembership ||
      !callerTeamIds.has((repMembership as { teamId: string }).teamId)
    ) {
      return { summary: 'That rep is not in your team.', display: 'error' };
    }

    // ── Contact must exist (in this space OR linked to the team) ──────
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, name, spaceId, teamId')
      .eq('id', args.personId)
      .maybeSingle();
    if (!contact) {
      return { summary: 'Contact not found.', display: 'error' };
    }
    const c = contact as { id: string; name: string; spaceId: string; teamId: string | null };
    const teamId = (repMembership as { teamId: string }).teamId;
    const callerOwnsThisContact = c.spaceId === ctx.space.id || c.teamId === teamId;
    if (!callerOwnsThisContact) {
      return { summary: 'Contact not in your team.', display: 'error' };
    }

    // ── Fetch rep name for the audit note ──────────────────────────────
    const { data: rep } = await supabase
      .from('User')
      .select('id, name, email')
      .eq('id', args.repUserId)
      .maybeSingle();
    const repName =
      (rep as { name?: string | null } | null)?.name ??
      (rep as { email?: string } | null)?.email ??
      args.repUserId;

    // ── Audit-only update: applicationStatusNote + activity note. No clone.
    const now = new Date().toISOString();
    const meta = JSON.stringify({
      assignedTo: args.repUserId,
      assignedToName: repName,
      assignedAt: now,
      via: 'on_demand_agent',
      reason: args.why,
    });

    // Scope the UPDATE by the specific ownership leg we just proved at
    // L98 — either the contact lives in the manager's own space, or it's
    // linked to a team the caller administers. The read-then-write
    // pattern is safe only if the write carries the same scope; a
    // concurrent manager-merge or reassign-elsewhere could otherwise let
    // the UPDATE land on a row that has since moved out of scope.
    const updateBuilder = supabase
      .from('Contact')
      .update({ applicationStatusNote: meta, updatedAt: now })
      .eq('id', c.id);
    const scopedUpdate = c.spaceId === ctx.space.id
      ? updateBuilder.eq('spaceId', ctx.space.id)
      : updateBuilder.eq('teamId', teamId);
    const { error: updateErr } = await scopedUpdate;
    if (updateErr) {
      logger.error('[tools.assign_lead] update failed', { contactId: c.id }, updateErr);
      return { summary: `Reassignment failed: ${updateErr.message}`, display: 'error' };
    }

    const { error: activityErr } = await supabase.from('ContactActivity').insert({
      id: crypto.randomUUID(),
      contactId: c.id,
      spaceId: c.spaceId,
      type: 'note',
      content: `Reassigned to ${repName}: ${args.why}`,
      metadata: { repUserId: args.repUserId, via: 'on_demand_agent' },
    });
    if (activityErr) {
      logger.warn('[tools.assign_lead] activity insert failed', { contactId: c.id }, activityErr);
    }

    return {
      summary: `Reassigned ${c.name} to ${repName}.`,
      data: { contactId: c.id, repUserId: args.repUserId, repName },
      display: 'success',
    };
  },
});
