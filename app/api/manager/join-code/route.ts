import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

/** Generate a readable 8-char invite code like ABCD-EF23 */
function generateJoinCode(): string {
  // Exclude ambiguous chars (0/O, 1/I/L)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let raw = '';
  for (const byte of bytes) {
    raw += chars[byte % chars.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/**
 * GET /api/manager/join-code
 * Returns the current join code for the authenticated manager's team.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({ joinCode: ctx.team.joinCode ?? null });
}

/**
 * POST /api/manager/join-code
 * Generates a new join code, replacing any existing one.
 * Owner or admin can regenerate the code.
 */
export async function POST() {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (ctx.membership.role !== 'manager_owner' && ctx.membership.role !== 'manager_admin') {
    return NextResponse.json({ error: 'Only the owner or admins can manage the invite code' }, { status: 403 });
  }

  // Rate limit: 5 regenerations per hour per team
  const { allowed } = await checkRateLimit(`manager-join-code:${ctx.team.id}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded. Maximum 5 code regenerations per hour.' }, { status: 429 });
  }

  // Generate a unique code (retry on collision, though extremely unlikely)
  let joinCode = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateJoinCode();
    const { data: conflict } = await supabase
      .from('Team')
      .select('id')
      .eq('joinCode', candidate)
      .maybeSingle();
    if (!conflict) {
      joinCode = candidate;
      break;
    }
  }

  if (!joinCode) {
    return NextResponse.json({ error: 'Failed to generate unique code, please try again' }, { status: 500 });
  }

  const { error } = await supabase
    .from('Team')
    .update({ joinCode })
    .eq('id', ctx.team.id);

  if (error) {
    console.error('[manager/join-code] update failed', error);
    return NextResponse.json({ error: 'Failed to save join code' }, { status: 500 });
  }

  void audit({ actorClerkId: clerkId ?? null, action: 'UPDATE', resource: 'Team', resourceId: ctx.team.id, metadata: { field: 'joinCode' } });

  return NextResponse.json({ joinCode });
}
