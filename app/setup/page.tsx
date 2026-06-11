import { auth, currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';
import { OnboardingRep } from '@/components/onboarding/onboarding-rep';
import { OnboardingRepV2 } from '@/components/onboarding/onboarding-rep-v2';
import { ensureOnboardingBackfill } from '@/lib/onboarding';

export const metadata = { title: 'Create your workspace — Koala' };

export default async function SetupPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string; legacy?: string }>;
}) {
  const { type, legacy } = (await searchParams) ?? {};
  // Rep (default) gets the one-screen quick path. Managers and agents-
  // joining-a-team get the longer flow that collects team data
  // via ?type=manager. The quick path itself links over to ?type=manager.
  const useQuickPath = type !== 'manager';

  // V2 storytelling is the live onboarding. Two escape hatches:
  //   - `?legacy=1` forces V1 for a single request (per-rep rollback)
  //   - NEXT_PUBLIC_ONBOARDING_V2=false forces V1 deploy-wide (incident rollback)
  // V1 stays as that rollback path until V2 proves out — DO NOT refactor it.
  const useV2Onboarding =
    legacy !== '1' && process.env.NEXT_PUBLIC_ONBOARDING_V2 !== 'false';

  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  // Belt-and-suspenders: verify this is a real Clerk user, not a stale token.
  const clerkUser = await currentUser();
  if (!clerkUser) redirect('/login/rep');

  // On DB error: render error UI. NEVER .catch(() => null) (shows create-workspace
  // form to users who already have one). NEVER throw (generic "Application error").
  let dbUser;
  try {
    // Two separate queries instead of a join — more robust with PostgREST
    const { data: row, error } = await supabase
      .from('User')
      .select('*')
      .eq('clerkId', userId)
      .maybeSingle();
    if (error) throw error;

    if (row) {
      const { data: spaceRow } = await supabase
        .from('Space')
        .select('id, slug, name')
        .eq('ownerId', row.id)
        .maybeSingle();
      dbUser = {
        ...row,
        space: spaceRow ? { id: spaceRow.id as string, slug: spaceRow.slug as string, name: spaceRow.name as string } : null,
      };
    } else {
      dbUser = null;
    }
  } catch (err) {
    console.error('[setup] DB query failed', { clerkId: userId, error: err });
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load your account. This is usually temporary.
          </p>
          <a
            href="/setup"
            className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  // Best-effort backfill (bookkeeping only)
  try {
    await ensureOnboardingBackfill(dbUser);
  } catch {
    // non-fatal
  }

  // Manager-only users who are already set up — go straight to /manager
  if (dbUser?.accountType === 'manager_only' && dbUser?.onboard) {
    redirect('/manager');
  }

  // Already has a workspace — check if manager first (managers land on /manager)
  if (dbUser?.space?.slug) {
    // Check if this user is a manager — redirect to manager dashboard instead
    if (dbUser?.id) {
      const { data: managerMembership } = await supabase
        .from('TeamMembership')
        .select('id')
        .eq('userId', dbUser.id)
        .in('role', ['manager_owner', 'manager_admin'])
        .maybeSingle();
      if (managerMembership) {
        redirect('/manager');
      }
    }
    redirect(`/s/${dbUser.space.slug}/koala`);
  }

  // Create user record if missing.
  // IMPORTANT: redirect() must NEVER be inside try/catch — Next.js redirect()
  // throws a special NEXT_REDIRECT error that catch blocks would swallow.
  let resolvedUser = dbUser;
  if (!resolvedUser) {
    try {
      const newId = crypto.randomUUID();
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? '';
      const name = clerkUser?.fullName ?? clerkUser?.firstName ?? null;
      const now = new Date();

      const { data: upsertedRow, error: upsertError } = await supabase
        .from('User')
        .upsert(
          {
            id: newId,
            clerkId: userId,
            email,
            name,
            onboardingStartedAt: now.toISOString(),
            onboard: false,
            createdAt: now.toISOString(),
          },
          { onConflict: 'clerkId' }
        )
        .select()
        .single();
      if (upsertError) throw upsertError;
      if (upsertedRow) {
        // Query space separately
        const { data: spaceRow } = await supabase
          .from('Space')
          .select('*')
          .eq('ownerId', upsertedRow.id)
          .maybeSingle();
        resolvedUser = {
          ...upsertedRow,
          space: spaceRow ? { id: spaceRow.id as string, slug: spaceRow.slug as string, name: spaceRow.name as string } : null,
        };
      }
    } catch (err) {
      console.error('[setup] user upsert failed', { clerkId: userId, error: err });
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="text-center space-y-4 p-8">
            <h1 className="text-xl font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t create your account. This is usually temporary.
            </p>
            <a
              href="/setup"
              className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </a>
          </div>
        </div>
      );
    }
  }

  // Check again after upsert — user may already have a space
  if (resolvedUser?.space?.slug) {
    redirect(`/s/${resolvedUser.space.slug}/koala`);
  }

  // If the user has a manager_admin membership (e.g. accepted an admin invitation),
  // set them as manager_only and redirect to /manager — no workspace needed.
  if (resolvedUser?.id) {
    const { data: adminMembership } = await supabase
      .from('TeamMembership')
      .select('id')
      .eq('userId', resolvedUser.id)
      .eq('role', 'manager_admin')
      .maybeSingle();
    if (adminMembership) {
      // Ensure accountType is manager_only and onboarding is marked complete
      if (resolvedUser.accountType !== 'manager_only' || !resolvedUser.onboard) {
        await supabase
          .from('User')
          .update({ accountType: 'manager_only', onboard: true })
          .eq('id', resolvedUser.id);
      }
      redirect('/manager');
    }
  }

  const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? '';

  const userImageUrl = clerkUser?.imageUrl ?? '';

  // Mark that the user has passed the gate and reached the onboarding UI.
  // The old form's "Back to sign-in" state and email prop aren't needed — the
  // Clerk UserButton already lives in the global header on post-onboarding
  // routes, and the email wasn't used for anything the user could see.
  void email;

  if (useQuickPath) {
    return useV2Onboarding
      ? <OnboardingRepV2 defaultName={resolvedUser?.name ?? ''} />
      : <OnboardingRep defaultName={resolvedUser?.name ?? ''} />;
  }

  return (
    <OnboardingFlow
      defaultName={resolvedUser?.name ?? ''}
      userImageUrl={userImageUrl}
    />
  );
}
