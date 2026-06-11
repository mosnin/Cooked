import { supabase } from '@/lib/supabase';
import { getSpaceByOwnerId } from '@/lib/space';
import { notifyNewLead } from '@/lib/notify';

export type AssignLeadResult =
  | { ok: true; newContactId: string; assignedToSpaceId: string }
  | { ok: false; error: string; status: number };

/**
 * Assign a team lead (Contact) from the manager's space into a rep's
 * space: clone the contact, mark the original as assigned, notify the rep.
 *
 * Shared by POST /api/manager/assign-lead and the /assign team-chat command so
 * the two can never drift. Callers MUST verify the caller is a manager who can
 * manage leads before calling this — it performs no auth of its own.
 */
export async function assignLeadToRep(params: {
  team: { id: string; ownerId: string; name: string };
  assignedByUserId: string;
  contactId: string;
  repUserId: string;
}): Promise<AssignLeadResult> {
  const { team, assignedByUserId, contactId, repUserId } = params;

  // ── Find the manager's space ────────────────────────────────────────────
  const managerSpace = await getSpaceByOwnerId(team.ownerId);
  if (!managerSpace) {
    return { ok: false, error: 'Manager space not found', status: 500 };
  }

  // ── Verify the contact belongs to this team ───────────────────────
  // Accept contacts in the manager owner's space (legacy path) OR contacts
  // where teamId is explicitly set (modern intake path).
  const { data: contactInSpace, error: contactError } = await supabase
    .from('Contact')
    .select('*')
    .eq('id', contactId)
    .eq('spaceId', managerSpace.id)
    .maybeSingle();
  if (contactError) throw contactError;

  let contact = contactInSpace;
  if (!contact) {
    const { data: contactByTeamId, error: teamContactError } = await supabase
      .from('Contact')
      .select('*')
      .eq('id', contactId)
      .eq('teamId', team.id)
      .maybeSingle();
    if (teamContactError) throw teamContactError;
    contact = contactByTeamId;
  }

  if (!contact) {
    return { ok: false, error: 'Contact not found in your team space', status: 404 };
  }

  // ── Verify the rep is a member of this team ───────────────────
  const { data: repMembership, error: memberError } = await supabase
    .from('TeamMembership')
    .select('id, role, userId')
    .eq('teamId', team.id)
    .eq('userId', repUserId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!repMembership) {
    return { ok: false, error: 'User is not a member of this team', status: 403 };
  }

  // ── Find the rep's space ───────────────────────────────────────────
  const repSpace = await getSpaceByOwnerId(repUserId);
  if (!repSpace) {
    return { ok: false, error: 'Member does not have a workspace yet', status: 404 };
  }

  // ── Fetch the rep's name ───────────────────────────────────────────
  const { data: repUser } = await supabase
    .from('User')
    .select('name, email')
    .eq('id', repUserId)
    .maybeSingle();
  const repName = repUser?.name ?? repUser?.email ?? repUserId;

  // ── Prevent double-assignment ──────────────────────────────────────────
  const existingTags: string[] = contact.tags ?? [];
  if (existingTags.includes('assigned')) {
    return { ok: false, error: 'This lead has already been assigned', status: 409 };
  }

  // ── Clone the contact into the rep's space ─────────────────────────
  const newContactId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error: cloneError } = await supabase.from('Contact').insert({
    id: newContactId,
    spaceId: repSpace.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    budget: contact.budget,
    preferences: contact.preferences,
    address: contact.address,
    notes: contact.notes,
    type: contact.type,
    properties: contact.properties ?? [],
    tags: ['assigned-by-manager', 'new-lead'],
    scoringStatus: contact.scoringStatus,
    leadScore: contact.leadScore,
    scoreLabel: contact.scoreLabel,
    scoreSummary: contact.scoreSummary,
    scoreDetails: contact.scoreDetails,
    sourceLabel: `team: ${team.name}`,
    applicationData: contact.applicationData,
    applicationRef: contact.applicationRef,
    applicationStatus: contact.applicationStatus,
  });
  if (cloneError) throw cloneError;

  // ── Mark the original contact as assigned ──────────────────────────────
  const assignmentNote = [
    contact.notes,
    `\nAssigned to: ${repName}`,
    `--- Assigned to rep (${repUserId}) on ${now} by ${assignedByUserId} ---`,
  ]
    .filter(Boolean)
    .join('\n');

  const assignmentMeta = JSON.stringify({
    assignedTo: repUserId,
    assignedToName: repName,
    assignedContactId: newContactId,
    assignedSpaceId: repSpace.id,
    assignedAt: now,
  });

  const { error: updateError } = await supabase
    .from('Contact')
    .update({
      tags: [...existingTags.filter((t: string) => t !== 'new-lead'), 'assigned'],
      notes: assignmentNote,
      applicationStatus: 'assigned',
      applicationStatusNote: assignmentMeta,
      updatedAt: now,
    })
    .eq('id', contactId);
  if (updateError) throw updateError;

  console.info('[assign-lead] lead assigned', {
    contactId,
    newContactId,
    teamId: team.id,
    repUserId,
    assignedBy: assignedByUserId,
  });

  // ── Notify the rep (best-effort — never fail the assignment) ───────
  try {
    await notifyNewLead({
      spaceId: repSpace.id,
      contactId: newContactId,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      leadScore: contact.leadScore,
      scoreLabel: contact.scoreLabel,
      scoreSummary: contact.scoreSummary,
      applicationData: contact.applicationData,
    });
  } catch (e) {
    console.error('[assign-lead] notification failed:', { newContactId, e });
  }

  return { ok: true, newContactId, assignedToSpaceId: repSpace.id };
}
