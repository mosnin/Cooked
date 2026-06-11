import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

/**
 * POST /api/manager/create
 * Self-serve team creation. Any authenticated, onboarded rep can create
 * one team. Enforced by the UNIQUE index on Team.ownerId.
 */
export async function POST(req: Request) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 3 attempts per user per day
  const { allowed } = await checkRateLimit(`manager:create:${clerkId}`, 3, 86400);
  if (!allowed) return NextResponse.json({ error: 'Too many attempts. Try again tomorrow.' }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, logoUrl, websiteUrl, officeAddress, officePhone, agentCount, teamType, primaryMarket, commissionStructure, geographicCoverage } = body as {
    name?: string;
    logoUrl?: string;
    websiteUrl?: string;
    officeAddress?: string;
    officePhone?: string;
    agentCount?: string;
    teamType?: string;
    primaryMarket?: string;
    commissionStructure?: string;
    geographicCoverage?: string;
  };

  const trimmedName = (typeof name === 'string' ? name : '').trim();
  if (!trimmedName || trimmedName.length > 120) {
    return NextResponse.json({ error: 'Team name required (max 120 chars)' }, { status: 400 });
  }

  // Validate enum fields
  const validTeamTypes = ['independent', 'franchise', 'virtual'];
  const validMarkets = ['residential_rental', 'commercial', 'mixed'];
  const validCommissions = ['flat_fee', 'percentage_split', 'hybrid'];
  if (teamType && !validTeamTypes.includes(teamType)) {
    return NextResponse.json({ error: `Invalid teamType. Must be one of: ${validTeamTypes.join(', ')}` }, { status: 400 });
  }
  if (primaryMarket && !validMarkets.includes(primaryMarket)) {
    return NextResponse.json({ error: `Invalid primaryMarket. Must be one of: ${validMarkets.join(', ')}` }, { status: 400 });
  }
  if (commissionStructure && !validCommissions.includes(commissionStructure)) {
    return NextResponse.json({ error: `Invalid commissionStructure. Must be one of: ${validCommissions.join(', ')}` }, { status: 400 });
  }

  // Resolve internal user id
  const { data: user, error: userErr } = await supabase
    .from('User')
    .select('id, onboard, accountType, platformRole')
    .eq('clerkId', clerkId)
    .maybeSingle();
  if (userErr || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Platform admins bypass the onboarding/account-type gates below. An admin is
  // usually a rep who was promoted, so their accountType is 'rep' — which
  // was tripping the "upgrade to a manager account" 403 and blocking them from
  // creating teams at all. Admins are superusers; let them through.
  const isAdmin = user.platformRole === 'admin';

  // Manager-only users are marked onboard during setup even without a Space
  if (!user.onboard && !isAdmin) return NextResponse.json({ error: 'Complete onboarding first' }, { status: 403 });
  // Only users who selected manager role during onboarding can create a team
  if (user.accountType === 'rep' && !isAdmin) {
    return NextResponse.json({ error: 'Upgrade to a manager account to create a team' }, { status: 403 });
  }

  // Check: does this user already own a team?
  const { data: existing } = await supabase
    .from('Team')
    .select('id')
    .eq('ownerId', user.id)
    .maybeSingle();
  if (existing) return NextResponse.json({ error: 'You already own a team' }, { status: 409 });

  // Direct inserts instead of RPC — avoids ambiguous function overload issues
  // when multiple versions of create_team_with_owner exist in the database.
  const teamId = crypto.randomUUID();

  const { data: team, error: insertErr } = await supabase
    .from('Team')
    .insert({
      id: teamId,
      name: trimmedName,
      ownerId: user.id,
      ...(logoUrl && { logoUrl: String(logoUrl).slice(0, 500) }),
      ...(websiteUrl && { websiteUrl: String(websiteUrl).slice(0, 500) }),
      ...(officeAddress && { officeAddress: String(officeAddress).slice(0, 500) }),
      ...(officePhone && { officePhone: String(officePhone).slice(0, 40) }),
      ...(agentCount && { agentCount: String(agentCount).slice(0, 20) }),
      ...(teamType && { teamType }),
      ...(primaryMarket && { primaryMarket }),
      ...(commissionStructure && { commissionStructure }),
      ...(geographicCoverage && { geographicCoverage: String(geographicCoverage).slice(0, 500) }),
    })
    .select()
    .single();

  if (insertErr) {
    // Check if user already owns a team (race condition with unique index)
    const errMsg = insertErr.message || '';
    if (errMsg.includes('duplicate key') || errMsg.includes('unique') || insertErr.code === '23505') {
      return NextResponse.json({ error: 'You already own a team' }, { status: 409 });
    }
    console.error('[manager/create] Team insert failed:', insertErr);
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 });
  }

  // Create the owner membership
  const { error: membershipErr } = await supabase
    .from('TeamMembership')
    .insert({
      id: crypto.randomUUID(),
      teamId,
      userId: user.id,
      role: 'manager_owner',
    });

  if (membershipErr) {
    console.error('[manager/create] TeamMembership insert failed:', membershipErr);
    // Rollback: delete the team we just created since it's unusable without an owner membership
    await supabase.from('Team').delete().eq('id', teamId);
    return NextResponse.json({ error: 'Failed to create team membership' }, { status: 500 });
  }

  void audit({ actorClerkId: clerkId, action: 'CREATE', resource: 'Team', resourceId: teamId, metadata: { name: trimmedName } });

  return NextResponse.json({ team }, { status: 201 });
}
