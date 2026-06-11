/**
 * GET /api/agent/today
 *
 * Returns the day's items for the dispatch console's "What's coming" section:
 *   - followUpsDue: contacts whose followUpAt is in the past or today
 *   - demosUpcoming: scheduled or confirmed demos from now forward
 *
 * One endpoint, one shape — keeps the dispatch console rendering one fetch
 * per section instead of N. Rep space only (not team-routed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';

export interface FollowUpDue {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  type: string | null;
  followUpAt: string;
  leadScore: number | null;
  scoreLabel: string | null;
}

export interface UpcomingDemo {
  id: string;
  guestName: string | null;
  startsAt: string;
  endsAt: string | null;
  propertyAddress: string | null;
  status: string;
}

export async function GET(_req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const nowIso = new Date().toISOString();

  const [followUpsRes, demosRes] = await Promise.all([
    supabase
      .from('Contact')
      .select('id, name, phone, email, type, followUpAt, leadScore, scoreLabel')
      .eq('spaceId', space.id)
      .is('teamId', null)
      .not('followUpAt', 'is', null)
      .lte('followUpAt', nowIso)
      .order('followUpAt', { ascending: true })
      .limit(10),
    supabase
      .from('Demo')
      .select('id, guestName, startsAt, endsAt, propertyAddress, status')
      .eq('spaceId', space.id)
      .gte('startsAt', nowIso)
      .in('status', ['scheduled', 'confirmed'])
      .order('startsAt', { ascending: true })
      .limit(6),
  ]);

  return NextResponse.json({
    followUpsDue: (followUpsRes.data ?? []) as FollowUpDue[],
    demosUpcoming: (demosRes.data ?? []) as UpcomingDemo[],
  });
}
