import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getManagerContext } from '@/lib/permissions';
import { TeamSetupClient } from './team-setup-client';

export const metadata = { title: 'Team — Koala' };

/**
 * /team setup page.
 * - If already a manager: redirect to /manager
 * - If not onboarded: redirect to /setup
 * - Otherwise: show create/join options
 */
export default async function TeamPage() {
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  const { data: user } = await supabase
    .from('User')
    .select('id, onboard')
    .eq('clerkId', userId)
    .maybeSingle();

  if (!user) redirect('/setup');
  if (!user.onboard) redirect('/setup');

  const { data: space } = await supabase
    .from('Space')
    .select('slug')
    .eq('ownerId', user.id)
    .maybeSingle();

  if (!space) redirect('/setup');

  // Already a manager? Go straight to the manager dashboard
  let existingTeamName: string | null = null;
  let existingTeamId: string | null = null;
  try {
    const ctx = await getManagerContext();
    if (ctx) {
      existingTeamName = ctx.team.name;
      existingTeamId = ctx.team.id;
    }
  } catch {
    // non-blocking
  }

  // Already a rep_member? Also redirect
  if (!existingTeamName) {
    const { data: membership } = await supabase
      .from('TeamMembership')
      .select('teamId')
      .eq('userId', user.id)
      .eq('role', 'rep_member')
      .maybeSingle();
    if (membership) {
      const { data: team } = await supabase
        .from('Team')
        .select('name')
        .eq('id', membership.teamId)
        .maybeSingle();
      existingTeamName = team?.name ?? 'Your team';
      existingTeamId = membership.teamId;
    }
  }

  return (
    <TeamSetupClient
      spaceSlug={space.slug}
      existingTeamName={existingTeamName}
      existingTeamId={existingTeamId}
    />
  );
}
