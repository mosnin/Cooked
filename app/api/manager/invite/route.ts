import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { sendTeamInvitation } from '@/lib/email';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { checkSeatCapacity } from '@/lib/team-seats';

/**
 * POST /api/manager/invite
 * Send a team invitation to an email address.
 * Idempotent: if a pending invite for the same email already exists, returns it without
 * creating a duplicate or sending another email.
 */
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let email: string, roleToAssign: string;
  try {
    ({ email, roleToAssign } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validate inputs
  const trimmedEmail = (email ?? '').trim().toLowerCase().slice(0, 320);
  if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  }
  if (!['manager_admin', 'rep_member'].includes(roleToAssign)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  // Only the owner can invite admins
  if (roleToAssign === 'manager_admin' && ctx.membership.role !== 'manager_owner') {
    return NextResponse.json({ error: 'Only the team owner can invite admins' }, { status: 403 });
  }

  // 100 invitations per manager per hour (shared budget with /api/manager/invite/bulk)
  const { allowed } = await checkRateLimit(`manager:invite:${ctx.dbUserId}`, 100, 3600);
  if (!allowed) return NextResponse.json({ error: 'Too many invitations sent. Try again in an hour.' }, { status: 429 });

  const { team, dbUserId } = ctx;

  // Cap: max 100 pending invitations per team
  const { count: pendingCount } = await supabase
    .from('Invitation')
    .select('*', { count: 'exact', head: true })
    .eq('teamId', team.id)
    .eq('status', 'pending')
    .gt('expiresAt', new Date().toISOString());
  if ((pendingCount ?? 0) >= 100) {
    return NextResponse.json(
      { error: 'Too many pending invitations. Cancel some before sending more.' },
      { status: 429 }
    );
  }

  // Check if this email already belongs to a member
  const { data: existingUser } = await supabase
    .from('User')
    .select('id')
    .eq('email', trimmedEmail)
    .maybeSingle();
  if (existingUser) {
    const { data: existingMember } = await supabase
      .from('TeamMembership')
      .select('id')
      .eq('teamId', team.id)
      .eq('userId', existingUser.id)
      .maybeSingle();
    if (existingMember) {
      return NextResponse.json({ error: 'This person is already a member of your team' }, { status: 409 });
    }
  }

  // Idempotency: return existing pending invite for this email, but resend the email
  const { data: existing } = await supabase
    .from('Invitation')
    .select('*')
    .eq('teamId', team.id)
    .eq('email', trimmedEmail)
    .eq('status', 'pending')
    .maybeSingle();
  if (existing) {
    // Resend the invitation email (original may have failed or been missed)
    try {
      await sendTeamInvitation({
        toEmail: trimmedEmail,
        teamName: team.name,
        inviterName: (await supabase.from('User').select('name, email').eq('id', dbUserId).maybeSingle()).data?.name ?? 'Someone',
        roleToAssign: existing.roleToAssign as 'manager_admin' | 'rep_member',
        token: existing.token,
      });
    } catch (err) {
      console.error('[manager/invite] resend email failed for existing invite', err);
    }
    return NextResponse.json({ invitation: existing, duplicate: true }, { status: 200 });
  }

  // Seat-limit enforcement (BP3b): duplicates above returned early and don't
  // consume a new seat, so we only gate genuinely new invitations.
  const seatCheck = await checkSeatCapacity(team.id, 1);
  if (!seatCheck.ok) {
    const { plan, seatLimit, used } = seatCheck.usage;
    const needed = seatCheck.needed ?? 1;
    return NextResponse.json(
      {
        error: `Seat limit reached — your ${plan} plan allows ${seatLimit} seats and ${used} are in use. Upgrade or remove a member to invite ${needed} more.`,
        code: 'seat_limit',
        plan,
        used,
        limit: seatLimit,
        needed,
      },
      { status: 402 }
    );
  }

  // Resolve inviter name for email
  const { data: inviterUser } = await supabase
    .from('User')
    .select('name, email')
    .eq('id', dbUserId)
    .maybeSingle();
  const inviterName = inviterUser?.name ?? inviterUser?.email ?? 'Someone';

  // Create invitation
  const { data: invitation, error: invErr } = await supabase
    .from('Invitation')
    .insert({
      teamId: team.id,
      email: trimmedEmail,
      roleToAssign,
      invitedById: dbUserId,
    })
    .select()
    .single();
  if (invErr || !invitation) {
    console.error('[manager/invite] insert failed', invErr);
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 });
  }

  console.log('[manager/invite] Invitation created:', { id: invitation.id, role: roleToAssign });

  // Send email — must await before response returns so Vercel doesn't kill the function
  try {
    console.log('[manager/invite] Sending invitation email for invitation:', invitation.id);
    const emailResult = await sendTeamInvitation({
      toEmail: trimmedEmail,
      teamName: team.name,
      inviterName,
      roleToAssign: roleToAssign as 'manager_admin' | 'rep_member',
      token: invitation.token,
    });
    console.log('[manager/invite] Email send completed for invitation:', invitation.id);
  } catch (err) {
    console.error('[manager/invite] email send FAILED:', err instanceof Error ? err.message : err);
  }

  void audit({ actorClerkId: clerkId ?? null, action: 'CREATE', resource: 'Invitation', resourceId: invitation.id, metadata: { email: trimmedEmail, roleToAssign, teamId: team.id } });

  return NextResponse.json({ invitation }, { status: 201 });
}
