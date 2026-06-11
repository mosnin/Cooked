import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { checkSeatCapacity } from '@/lib/team-seats';
import { notifyManager } from '@/lib/manager-notify';
import { notificationForMemberJoined } from '@/lib/notification-voice';

/**
 * POST /api/manager/join
 * Join a team using its invite code.
 * Any authenticated, onboarded user can join. Assigns role: rep_member.
 *
 * Uses requireAuth (not raw Clerk auth()) so the offboarding gate fires —
 * an offboarded user clicking an old join-code link must NOT be able to
 * silently re-onboard themselves. Re-hire happens via an explicit
 * /api/invitations/[token] flow, which is the only path that intentionally
 * revives an offboarded User row.
 */
export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: clerkId } = authResult;

  // 10 join attempts per user per hour (prevents code enumeration)
  const { allowed } = await checkRateLimit(`manager:join:${clerkId}`, 10, 3600);
  if (!allowed) return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });

  let code: string;
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalizedCode = (code ?? '').trim().toUpperCase();
  if (!normalizedCode) {
    return NextResponse.json({ error: 'Invite code required' }, { status: 400 });
  }

  // Resolve current user
  const { data: user } = await supabase
    .from('User')
    .select('id, onboard')
    .eq('clerkId', clerkId)
    .maybeSingle();
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  if (!user.onboard) return NextResponse.json({ error: 'Complete onboarding before joining a team' }, { status: 403 });

  // Find team by code
  const { data: team } = await supabase
    .from('Team')
    .select('id, name, status')
    .eq('joinCode', normalizedCode)
    .maybeSingle();

  if (!team) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
  }

  if (team.status === 'suspended') {
    return NextResponse.json({ error: 'This team is currently suspended' }, { status: 403 });
  }

  // Idempotent: already a member?
  const { data: existing } = await supabase
    .from('TeamMembership')
    .select('id, role')
    .eq('teamId', team.id)
    .eq('userId', user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ teamName: team.name, alreadyMember: true }, { status: 200 });
  }

  // Deny-list check. If this user was previously removed from this
  // team, the anonymous code path is closed — the only way back
  // in is an explicit /api/invitations/[token] acceptance from a
  // manager_owner or manager_admin. A removed agent re-clicking the
  // join URL they kept in their email gets a clear 403; the manager
  // doesn't get a silent member_joined notification for someone they
  // already fired.
  const { data: removalRow } = await supabase
    .from('TeamRemoval')
    .select('teamId')
    .eq('teamId', team.id)
    .eq('userId', user.id)
    .maybeSingle();
  if (removalRow) {
    return NextResponse.json(
      { error: 'Your access to this team was removed. Ask the manager to re-invite you by email.' },
      { status: 403 },
    );
  }

  // Seat cap — the invite paths enforce checkSeatCapacity, but self-join via the
  // (static, shareable) code did not, so anyone with the code could add
  // themselves past the plan's paid seat limit. Gate it the same way.
  const seat = await checkSeatCapacity(team.id, 1);
  if (!seat.ok) {
    return NextResponse.json(
      { error: 'This team has reached its seat limit. Ask the manager to add seats or remove a member.' },
      { status: 402 },
    );
  }

  // Create membership
  const { error: memberErr } = await supabase
    .from('TeamMembership')
    .insert({ teamId: team.id, userId: user.id, role: 'rep_member' });

  if (memberErr) {
    console.error('[manager/join] membership insert failed', memberErr);
    return NextResponse.json({ error: 'Failed to join team' }, { status: 500 });
  }

  // Adopt this team's intake form-config ONLY if the Space isn't already
  // linked. Membership (above) is the source of truth for access; Space.teamId
  // is just the intake-config owner — and a rep who belongs to team A
  // joining team B must NOT have B silently steal their workspace. Set it
  // only when currently NULL; never overwrite an existing link.
  const { data: space } = await supabase
    .from('Space')
    .select('id, teamId')
    .eq('ownerId', user.id)
    .maybeSingle();
  if (space && !space.teamId) {
    await supabase.from('Space').update({ teamId: team.id }).eq('id', space.id);
  }

  void audit({ actorClerkId: clerkId, action: 'CREATE', resource: 'TeamMembership', metadata: { teamId: team.id, role: 'rep_member', method: 'join_code' } });

  // Resolve user email for notification
  const { data: userData } = await supabase.from('User').select('email').eq('id', user.id).maybeSingle();
  const joinCopy = notificationForMemberJoined(
    userData?.email ?? 'A new member',
    'rep_member',
    'join_code',
  );
  void notifyManager({
    teamId: team.id,
    type: 'member_joined',
    title: joinCopy.title,
    body: joinCopy.description,
    metadata: { userId: user.id, method: 'join_code' },
  });

  return NextResponse.json({ teamName: team.name }, { status: 201 });
}
