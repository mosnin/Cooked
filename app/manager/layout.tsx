import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { getManagerMemberContext } from '@/lib/permissions';
import { Sidebar } from '@/components/dashboard/sidebar';
import { SidebarCollapseProvider } from '@/components/dashboard/sidebar-collapse';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { Header } from '@/components/dashboard/header';
import { AccountSwitchSwipe } from '@/components/dashboard/account-switch';
import { ManagerMain } from '@/components/manager/manager-main';
import { supabase } from '@/lib/supabase';
import { getTeamMembers } from '@/lib/team-members';
import { KoalaSplash } from '@/components/dashboard/koala-splash';
import { pickGreeting } from '@/lib/greetings';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Teams — Koala' };

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  const ctx = await getManagerMemberContext();

  // Not a manager — redirect to the setup page
  if (!ctx) {
    redirect('/setup');
  }

  // Look up their rep workspace (may not exist for manager-only accounts)
  const { data: spaceRow } = await supabase
    .from('Space')
    .select('id, slug, name')
    .eq('ownerId', ctx.dbUserId)
    .maybeSingle();

  // Check if this is a manager-only account (no personal workspace)
  const { data: userRow } = await supabase
    .from('User')
    .select('accountType, platformRole')
    .eq('id', ctx.dbUserId)
    .maybeSingle();

  const isManagerOnly = userRow?.accountType === 'manager_only';
  const isPlatformAdmin = userRow?.platformRole === 'admin';

  // If they have no space and are NOT manager-only, send to setup
  if (!spaceRow && !isManagerOnly) {
    redirect('/setup');
  }

  const slug = spaceRow?.slug as string ?? '';
  const spaceName = (spaceRow?.name as string) ?? ctx.team.name;

  // Subscription gate — redirect to standalone pages
  // Only exempt billing/settings paths for users with subscription history;
  // users with NO subscription history should always be redirected to /subscribe.
  const managerHeaders = await headers();
  const managerPath = managerHeaders.get('x-pathname')
    || managerHeaders.get('x-invoke-path')
    || managerHeaders.get('x-matched-path')
    || managerHeaders.get('next-url')
    || '';
  const isBillingOrSettings =
    managerPath.includes('/billing') ||
    managerPath.includes('/settings');

  const isOwnerOfTeam = ctx.team.ownerId === ctx.dbUserId;

  if (!isPlatformAdmin && isOwnerOfTeam) {
    // Only the team OWNER is gated by subscription.
    // Invited admins and members access the manager dashboard for free —
    // billing is the owner's responsibility.
    if (spaceRow) {
      try {
        const { data: subData, error: subError } = await supabase
          .from('Space')
          .select('stripeSubscriptionStatus, stripeSubscriptionId, trialUsedAt')
          .eq('id', spaceRow.id)
          .maybeSingle();

        if (subError) {
          console.error('[manager-layout] Subscription check query failed:', subError);
          redirect(`/subscribe?slug=${slug}`);
        }

        const hasSubscriptionHistory = !!(subData?.stripeSubscriptionId || subData?.trialUsedAt);
        // Only exempt billing/settings for users with subscription history
        const isManagerExempt = isBillingOrSettings && hasSubscriptionHistory;

        const status = subData?.stripeSubscriptionStatus ?? 'inactive';
        if (status !== 'active' && status !== 'trialing' && !isManagerExempt) {
          if (hasSubscriptionHistory) {
            redirect(`/billing-required?slug=${slug}&reason=${status}`);
          }
          redirect(`/subscribe?slug=${slug}`);
        }
      } catch (err: any) {
        // Next.js redirect() throws a special error — re-throw it
        if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
        console.error('[manager-layout] Subscription gate error:', err);
        redirect(`/subscribe?slug=${slug}`);
      }
    } else if (isManagerOnly) {
      // Manager-only owner without a personal space — check via owner's space
      try {
        const { data: ownerSpace } = await supabase
          .from('Space')
          .select('slug, stripeSubscriptionStatus, stripeSubscriptionId, trialUsedAt')
          .eq('ownerId', ctx.team.ownerId)
          .maybeSingle();

        if (ownerSpace) {
          const ownerStatus = ownerSpace.stripeSubscriptionStatus ?? 'inactive';
          const ownerSlug = ownerSpace.slug ?? '';
          const ownerHasHistory = !!(ownerSpace.stripeSubscriptionId || ownerSpace.trialUsedAt);
          const isManagerOnlyExempt = isBillingOrSettings && ownerHasHistory;

          if (ownerStatus !== 'active' && ownerStatus !== 'trialing' && !isManagerOnlyExempt) {
            if (ownerHasHistory) {
              redirect(`/billing-required?slug=${ownerSlug}&reason=${ownerStatus}`);
            }
            redirect(`/subscribe?slug=${ownerSlug}`);
          }
        }
        // manager_only without personal space — skip subscription gate entirely.
        // These users have no Space to check against; they manage the team
        // without needing a personal subscription.
      } catch (err: any) {
        if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
        console.error('[manager-layout] Manager-only owner subscription check error:', err);
        // Don't redirect manager_only users without a space to /subscribe —
        // they have no slug and the subscription wall doesn't apply to them.
      }
    } else {
      // No space and not manager-only — shouldn't be here
      redirect('/setup');
    }
  }

  // ── Manager's first name (for greeting) ────────────────────────────────────
  let managerFirstName = '';
  try {
    const { data: managerUserRow } = await supabase
      .from('User')
      .select('name')
      .eq('id', ctx.dbUserId)
      .maybeSingle();
    managerFirstName = (managerUserRow?.name ?? '').trim().split(/\s+/)[0] ?? '';
  } catch {
    managerFirstName = '';
  }

  // ── Team-wide snapshot counts ────────────────────────────────────────
  // Aggregate across all member spaces (including the owner's own space).
  let unreadLeadCount = 0;
  let managerFollowUpsDue = 0;
  let managerDraftsReady = 0;
  try {
    const allMembers = await getTeamMembers(ctx.team.id, { includeSpaceName: true });
    const memberSpaceIds = allMembers
      .map((m) => m.Space?.id)
      .filter((id): id is string => Boolean(id));

    // Also include the owner's own space if not already captured.
    if (spaceRow && !memberSpaceIds.includes(spaceRow.id as string)) {
      memberSpaceIds.push(spaceRow.id as string);
    }

    if (memberSpaceIds.length > 0) {
      const now = new Date().toISOString();
      const [leadResult, followUpResult, draftResult] = await Promise.all([
        // new-lead contacts across all member spaces
        supabase
          .from('Contact')
          .select('*', { count: 'exact', head: true })
          .in('spaceId', memberSpaceIds)
          .contains('tags', ['new-lead']),
        // overdue follow-ups on Deal across all member spaces
        supabase
          .from('Deal')
          .select('id', { count: 'exact', head: true })
          .in('spaceId', memberSpaceIds)
          .not('followUpAt', 'is', null)
          .lte('followUpAt', now),
        // pending AgentDrafts across all member spaces
        supabase
          .from('AgentDraft')
          .select('id', { count: 'exact', head: true })
          .in('spaceId', memberSpaceIds)
          .eq('status', 'pending'),
      ]);
      unreadLeadCount = leadResult.count ?? 0;
      managerFollowUpsDue = followUpResult.count ?? 0;
      managerDraftsReady = draftResult.count ?? 0;
    } else if (spaceRow) {
      // Fallback: single owner space when member list is empty
      const now = new Date().toISOString();
      const [leadResult, followUpResult, draftResult] = await Promise.all([
        supabase
          .from('Contact')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceRow.id)
          .contains('tags', ['new-lead']),
        supabase
          .from('Deal')
          .select('id', { count: 'exact', head: true })
          .eq('spaceId', spaceRow.id)
          .not('followUpAt', 'is', null)
          .lte('followUpAt', now),
        supabase
          .from('AgentDraft')
          .select('id', { count: 'exact', head: true })
          .eq('spaceId', spaceRow.id)
          .eq('status', 'pending'),
      ]);
      unreadLeadCount = leadResult.count ?? 0;
      managerFollowUpsDue = followUpResult.count ?? 0;
      managerDraftsReady = draftResult.count ?? 0;
    }
  } catch {
    unreadLeadCount = 0;
    managerFollowUpsDue = 0;
    managerDraftsReady = 0;
  }

  return (
    <div className="app-theme flex h-screen overflow-hidden bg-background text-foreground">
      {/* First-paint splash — greets the manager by name, shows a team-wide
          snapshot of what's happening across member spaces, then dissolves. */}
      <KoalaSplash
        greeting={pickGreeting(managerFirstName)}
        snapshot={{
          newLeads: unreadLeadCount,
          followUpsDue: managerFollowUpsDue,
          draftsReady: managerDraftsReady,
        }}
      />
      <AccountSwitchSwipe />
      <SidebarCollapseProvider>
        <Sidebar
          slug={slug}
          spaceName={spaceName}
          unreadLeadCount={unreadLeadCount}
          isManager={true}
          isManagerOnly={isManagerOnly}
          teamName={ctx.team.name}
          teamRole={ctx.membership.role}
          teamMemberships={[{ id: ctx.team.id, name: ctx.team.name, role: ctx.membership.role }]}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header slug={slug} spaceName={spaceName} title={spaceName} isManager={true} isManagerOnly={isManagerOnly} teamName={ctx.team.name} />
          {/* Chat-vs-dashboard padding is decided client-side by usePathname()
              inside ManagerMain — NOT by the fragile x-pathname header — so the
              container is always correct and nothing touches the screen edge. */}
          <ManagerMain>{children}</ManagerMain>
        </div>
      </SidebarCollapseProvider>
      <MobileNav slug={slug} isManager={true} isManagerOnly={isManagerOnly} />
    </div>
  );
}
