import { NextRequest, NextResponse } from 'next/server';
import { requireManager, canManageLeads } from '@/lib/permissions';
import { assignLeadToRep } from '@/lib/manager-assign-lead';
import { z } from 'zod';

const assignLeadSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
  repUserId: z.string().uuid('Invalid rep user ID'),
});

/**
 * POST /api/manager/assign-lead
 *
 * Assigns a team lead (Contact) from the manager's space to a rep's
 * space. Only manager_owner and manager_admin roles can perform this action.
 *
 * The assignment itself lives in assignLeadToRep() (lib/manager-assign-lead)
 * so the /assign team-chat command can reuse it without an internal HTTP hop.
 */
export async function POST(req: NextRequest) {
  // ── Auth: require manager_owner or manager_admin ───────────────────────────
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // ── Role check: only manager_owner and manager_admin can assign leads ─────
  if (!canManageLeads(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the owner or admins can assign leads' },
      { status: 403 },
    );
  }

  // ── Parse request body ───────────────────────────────────────────────────
  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = assignLeadSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { contactId, repUserId } = parsed.data;

  try {
    const result = await assignLeadToRep({
      team: ctx.team,
      assignedByUserId: ctx.dbUserId,
      contactId,
      repUserId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(
      {
        success: true,
        newContactId: result.newContactId,
        assignedTo: repUserId,
        assignedToSpaceId: result.assignedToSpaceId,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[assign-lead] unhandled error', {
      contactId,
      repUserId,
      teamId: ctx.team.id,
      error,
    });
    return NextResponse.json({ error: "Server hiccup — usually temporary." }, { status: 500 });
  }
}
