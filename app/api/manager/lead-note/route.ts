import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { z } from 'zod';

const addNoteSchema = z.object({
  contactId: z.string().uuid('Invalid contact ID'),
  note: z.string().min(1, 'Note cannot be empty').max(2000, 'Note too long'),
});

/**
 * POST /api/manager/lead-note
 *
 * Appends a manager note to a contact's notes field.
 * The note is prefixed with "[Manager: Name - Date]" so reps can see who wrote it.
 * Works on contacts in both the manager's space (unassigned) and rep spaces (assigned).
 */
export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { team, dbUserId } = ctx;

  let requestBody: unknown;
  try {
    requestBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = addNoteSchema.safeParse(requestBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { contactId, note } = parsed.data;

  try {
    // Get manager user's name
    const { data: managerUser } = await supabase
      .from('User')
      .select('name, email')
      .eq('id', dbUserId)
      .maybeSingle();
    const managerName = managerUser?.name ?? managerUser?.email ?? 'Manager';

    // Find the manager's space
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('id')
      .eq('ownerId', team.ownerId)
      .maybeSingle();
    const managerSpaceId = ownerSpace?.id ?? null;

    // First check: is this contact in the manager's own space?
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, notes, spaceId, applicationStatusNote')
      .eq('id', contactId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Verify the contact belongs to manager space or a rep in this team
    let authorized = false;

    if (contact.spaceId === managerSpaceId) {
      authorized = true;
    } else {
      // Check if the contact's space belongs to a team member
      const { data: spaceOwner } = await supabase
        .from('Space')
        .select('ownerId')
        .eq('id', contact.spaceId)
        .maybeSingle();

      if (spaceOwner) {
        const { data: membership } = await supabase
          .from('TeamMembership')
          .select('id')
          .eq('teamId', team.id)
          .eq('userId', spaceOwner.ownerId)
          .maybeSingle();
        if (membership) authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Not authorized to add notes to this contact' }, { status: 403 });
    }

    // Build the note prefix
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const prefix = `[Manager: ${managerName} - ${dateStr}]`;
    const newNote = `${prefix} ${note}`;

    // Prepend to existing notes (newest first)
    const existingNotes = contact.notes ?? '';
    const updatedNotes = existingNotes
      ? `${newNote}\n\n${existingNotes}`
      : newNote;

    const { error: updateError } = await supabase
      .from('Contact')
      .update({
        notes: updatedNotes,
        updatedAt: now.toISOString(),
      })
      .eq('id', contactId);

    if (updateError) throw updateError;

    // If this is an assigned lead, also add the note to the rep's copy
    if (contact.spaceId === managerSpaceId && contact.applicationStatusNote) {
      try {
        const meta = JSON.parse(contact.applicationStatusNote);
        if (meta.assignedContactId) {
          const { data: repContact } = await supabase
            .from('Contact')
            .select('id, notes')
            .eq('id', meta.assignedContactId)
            .maybeSingle();

          if (repContact) {
            const repExisting = repContact.notes ?? '';
            const repUpdated = repExisting
              ? `${newNote}\n\n${repExisting}`
              : newNote;

            await supabase
              .from('Contact')
              .update({
                notes: repUpdated,
                updatedAt: now.toISOString(),
              })
              .eq('id', meta.assignedContactId);
          }
        }
      } catch {
        // If parsing fails, skip syncing to rep copy
      }
    }

    return NextResponse.json({
      success: true,
      note: newNote,
      updatedNotes,
    });
  } catch (error) {
    console.error('[lead-note] error', { contactId, error });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

/**
 * GET /api/manager/lead-note?contactId=xxx
 *
 * Returns the notes for a contact (manager must have access).
 */
export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { team } = ctx;

  const contactId = req.nextUrl.searchParams.get('contactId');
  if (!contactId) {
    return NextResponse.json({ error: 'contactId required' }, { status: 400 });
  }

  try {
    const { data: contact } = await supabase
      .from('Contact')
      .select('id, notes, spaceId')
      .eq('id', contactId)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Verify the contact belongs to the manager's space or a team member's space
    const { data: ownerSpace } = await supabase
      .from('Space')
      .select('id')
      .eq('ownerId', team.ownerId)
      .maybeSingle();
    const managerSpaceId = ownerSpace?.id ?? null;

    let authorized = false;

    if (contact.spaceId === managerSpaceId) {
      authorized = true;
    } else {
      // Check if the contact's space belongs to a team member
      const { data: spaceOwner } = await supabase
        .from('Space')
        .select('ownerId')
        .eq('id', contact.spaceId)
        .maybeSingle();

      if (spaceOwner) {
        const { data: membership } = await supabase
          .from('TeamMembership')
          .select('id')
          .eq('teamId', team.id)
          .eq('userId', spaceOwner.ownerId)
          .maybeSingle();
        if (membership) authorized = true;
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Not authorized to view notes for this contact' }, { status: 403 });
    }

    return NextResponse.json({ notes: contact.notes ?? '' });
  } catch (error) {
    console.error('[lead-note] GET error', { contactId, error });
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
