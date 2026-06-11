import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * /auth/redirect?intent=rep|manager
 *
 * Called after Clerk sign-in from either login page.
 *
 * - intent=manager  → if the user is a manager_owner or manager_admin, go to /manager
 *                    otherwise fall back to the rep flow
 * - intent=rep → go to the user's workspace, or /setup if none yet
 * - no intent      → same as rep
 */
export default async function AuthRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  const { intent } = await searchParams;

  // Look up the user row
  const { data: user } = await supabase
    .from('User')
    .select('id, accountType')
    .eq('clerkId', userId)
    .maybeSingle();

  if (!user) {
    // New user — check if they have a pending invitation before sending to setup.
    // This handles the case where Clerk's forceRedirectUrl didn't work and the
    // user ended up here after signing up for a team invitation.
    try {
      const clerkUser = await currentUser();
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress?.trim().toLowerCase();
      if (email) {
        const { data: pendingInvite } = await supabase
          .from('Invitation')
          .select('token')
          .eq('email', email)
          .eq('status', 'pending')
          .gt('expiresAt', new Date().toISOString())
          .order('createdAt', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (pendingInvite?.token) {
          redirect(`/invite/${pendingInvite.token}`);
        }
      }
    } catch {
      // Non-blocking — fall through to setup if invite check fails
    }
    redirect('/setup');
  }

  // If user already has manager-level membership, always route to /manager.
  // This prevents invited manager_admin users from being pushed into setup/paywall
  // when they authenticate through non-manager entry points.
  const { data: managerMembership } = await supabase
    .from('TeamMembership')
    .select('id')
    .eq('userId', user.id)
    .in('role', ['manager_owner', 'manager_admin'])
    .maybeSingle();
  if (managerMembership) {
    redirect('/manager');
  }

  // Manager-only users always go to /manager
  if (user.accountType === 'manager_only') {
    redirect('/manager');
  }

  if (intent === 'manager') {
    // Check for manager-level membership
    const { data: membership } = await supabase
      .from('TeamMembership')
      .select('id, role')
      .eq('userId', user.id)
      .in('role', ['manager_owner', 'manager_admin'])
      .maybeSingle();

    if (membership) {
      redirect('/manager');
    }

    // They logged in via the manager page but don't have manager access yet.
    // Send them to the team setup page so they can create or join one.
    redirect('/team');
  }

  // intent=rep (or no intent) — go to workspace or setup
  const { data: space } = await supabase
    .from('Space')
    .select('slug')
    .eq('ownerId', user.id)
    .maybeSingle();

  if (space?.slug) {
    redirect(`/s/${space.slug}`);
  }

  redirect('/setup');
}
