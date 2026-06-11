import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import { checkSeatCapacity } from '@/lib/brokerage-seats';
import { notifyBroker } from '@/lib/broker-notify';
import { notificationForMemberJoined } from '@/lib/notification-voice';

/**
 * POST /api/broker/join
 * Join a brokerage using its invite code.
 * Any authenticated, onboarded user can join. Assigns role: realtor_member.
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
  const { allowed } = await checkRateLimit(`broker:join:${clerkId}`, 10, 3600);
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
  if (!user.onboard) return NextResponse.json({ error: 'Complete onboarding before joining a brokerage' }, { status: 403 });

  // Find brokerage by code
  const { data: brokerage } = await supabase
    .from('Brokerage')
    .select('id, name, status')
    .eq('joinCode', normalizedCode)
    .maybeSingle();

  if (!brokerage) {
    return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });
  }

  if (brokerage.status === 'suspended') {
    return NextResponse.json({ error: 'This brokerage is currently suspended' }, { status: 403 });
  }

  // Idempotent: already a member?
  const { data: existing } = await supabase
    .from('BrokerageMembership')
    .select('id, role')
    .eq('brokerageId', brokerage.id)
    .eq('userId', user.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ brokerageName: brokerage.name, alreadyMember: true }, { status: 200 });
  }

  // Deny-list check. If this user was previously removed from this
  // brokerage, the anonymous code path is closed — the only way back
  // in is an explicit /api/invitations/[token] acceptance from a
  // broker_owner or broker_admin. A removed agent re-clicking the
  // join URL they kept in their email gets a clear 403; the broker
  // doesn't get a silent member_joined notification for someone they
  // already fired.
  const { data: removalRow } = await supabase
    .from('BrokerageRemoval')
    .select('brokerageId')
    .eq('brokerageId', brokerage.id)
    .eq('userId', user.id)
    .maybeSingle();
  if (removalRow) {
    return NextResponse.json(
      { error: 'Your access to this brokerage was removed. Ask the broker to re-invite you by email.' },
      { status: 403 },
    );
  }

  // Seat cap — the invite paths enforce checkSeatCapacity, but self-join via the
  // (static, shareable) code did not, so anyone with the code could add
  // themselves past the plan's paid seat limit. Gate it the same way.
  const seat = await checkSeatCapacity(brokerage.id, 1);
  if (!seat.ok) {
    return NextResponse.json(
      { error: 'This brokerage has reached its seat limit. Ask the broker to add seats or remove a member.' },
      { status: 402 },
    );
  }

  // Create membership
  const { error: memberErr } = await supabase
    .from('BrokerageMembership')
    .insert({ brokerageId: brokerage.id, userId: user.id, role: 'realtor_member' });

  if (memberErr) {
    console.error('[broker/join] membership insert failed', memberErr);
    return NextResponse.json({ error: 'Failed to join brokerage' }, { status: 500 });
  }

  // Adopt this brokerage's intake form-config ONLY if the Space isn't already
  // linked. Membership (above) is the source of truth for access; Space.brokerageId
  // is just the intake-config owner — and a realtor who belongs to brokerage A
  // joining brokerage B must NOT have B silently steal their workspace. Set it
  // only when currently NULL; never overwrite an existing link.
  const { data: space } = await supabase
    .from('Space')
    .select('id, brokerageId')
    .eq('ownerId', user.id)
    .maybeSingle();
  if (space && !space.brokerageId) {
    await supabase.from('Space').update({ brokerageId: brokerage.id }).eq('id', space.id);
  }

  void audit({ actorClerkId: clerkId, action: 'CREATE', resource: 'BrokerageMembership', metadata: { brokerageId: brokerage.id, role: 'realtor_member', method: 'join_code' } });

  // Resolve user email for notification
  const { data: userData } = await supabase.from('User').select('email').eq('id', user.id).maybeSingle();
  const joinCopy = notificationForMemberJoined(
    userData?.email ?? 'A new member',
    'realtor_member',
    'join_code',
  );
  void notifyBroker({
    brokerageId: brokerage.id,
    type: 'member_joined',
    title: joinCopy.title,
    body: joinCopy.description,
    metadata: { userId: user.id, method: 'join_code' },
  });

  return NextResponse.json({ brokerageName: brokerage.name }, { status: 201 });
}
