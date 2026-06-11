import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { auth } from '@clerk/nextjs/server';

/** GET /api/admin/teams — list all teams with owner info and member counts */
export async function GET() {
  try {
    await requirePlatformAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const session = await auth();
  const { allowed } = await checkRateLimit(`admin:read:${session.userId}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const { data: teams, error } = await supabase
    .from('Team')
    .select('*, User!Team_ownerId_fkey(id, name, email)')
    .order('createdAt', { ascending: false });

  if (error) {
    console.error('[admin/teams] query failed', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }

  // Attach member counts
  const ids = (teams ?? []).map((b) => b.id);
  const { data: memberships } = await supabase
    .from('TeamMembership')
    .select('teamId')
    .in('teamId', ids.length > 0 ? ids : ['__none__']);

  const countMap: Record<string, number> = {};
  for (const m of memberships ?? []) {
    countMap[m.teamId] = (countMap[m.teamId] ?? 0) + 1;
  }

  const result = (teams ?? []).map((b) => ({
    ...b,
    memberCount: countMap[b.id] ?? 0,
  }));

  return NextResponse.json({ teams: result });
}
