import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@clerk/nextjs/server';
import { getBrokerMemberContext } from '@/lib/permissions';
import { Sidebar } from '@/components/dashboard/sidebar';
import { SidebarCollapseProvider } from '@/components/dashboard/sidebar-collapse';
import { MobileNav } from '@/components/dashboard/mobile-nav';
import { Header } from '@/components/dashboard/header';
import { AccountSwitchSwipe } from '@/components/dashboard/account-switch';
import { BrokerMain } from '@/components/broker/broker-main';
import { supabase } from '@/lib/supabase';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { ChippiSplash } from '@/components/dashboard/chippi-splash';
import { pickGreeting } from '@/lib/greetings';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Teams — Chippi' };

export default async function BrokerLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const ctx = await getBrokerMemberContext();

  // Not a broker — redirect to the setup page
  if (!ctx) {
    redirect('/setup');
  }

  // Look up their realtor workspace (may not exist for broker-only accounts)
  const { data: spaceRow } = await supabase
    .from('Space')
    .select('id, slug, name')
    .eq('ownerId', ctx.dbUserId)
    .maybeSingle();

  // Check if this is a broker-only account (no personal workspace)
  const { data: userRow } = await supabase
    .from('User')
    .select('accountType, platformRole')
    .eq('id', ctx.dbUserId)
    .maybeSingle();

  const isBrokerOnly = userRow?.accountType === 'broker_only';
  const isPlatformAdmin = userRow?.platformRole === 'admin';

  // If they have no space and are NOT broker-only, send to setup
  if (!spaceRow && !isBrokerOnly) {
    redirect('/setup');
  }

  const slug = spaceRow?.slug as string ?? '';
  const spaceName = (spaceRow?.name as string) ?? ctx.brokerage.name;

  // Subscription gate — redirect to standalone pages
  // Only exempt billing/settings paths for users with subscription history;
  // users with NO subscription history should always be redirected to /subscribe.
  const brokerHeaders = await headers();
  const brokerPath = brokerHeaders.get('x-pathname')
    || brokerHeaders.get('x-invoke-path')
    || brokerHeaders.get('x-matched-path')
    || brokerHeaders.get('next-url')
    || '';
  const isBillingOrSettings =
    brokerPath.includes('/billing') ||
    brokerPath.includes('/settings');

  const isOwnerOfBrokerage = ctx.brokerage.ownerId === ctx.dbUserId;

  if (!isPlatformAdmin && isOwnerOfBrokerage) {
    // Only the brokerage OWNER is gated by subscription.
    // Invited admins and members access the broker dashboard for free —
    // billing is the owner's responsibility.
    if (spaceRow) {
      try {
        const { data: subData, error: subError } = await supabase
          .from('Space')
          .select('stripeSubscriptionStatus, stripeSubscriptionId, trialUsedAt')
          .eq('id', spaceRow.id)
          .maybeSingle();

        if (subError) {
          console.error('[broker-layout] Subscription check query failed:', subError);
          redirect(`/subscribe?slug=${slug}`);
        }

        const hasSubscriptionHistory = !!(subData?.stripeSubscriptionId || subData?.trialUsedAt);
        // Only exempt billing/settings for users with subscription history
        const isBrokerExempt = isBillingOrSettings && hasSubscriptionHistory;

        const status = subData?.stripeSubscriptionStatus ?? 'inactive';
        if (status !== 'active' && status !== 'trialing' && !isBrokerExempt) {
          if (hasSubscriptionHistory) {
            redirect(`/billing-required?slug=${slug}&reason=${status}`);
          }
          redirect(`/subscribe?slug=${slug}`);
        }
      } catch (err: any) {
        // Next.js redirect() throws a special error — re-throw it
        if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
        console.error('[broker-layout] Subscription gate error:', err);
        redirect(`/subscribe?slug=${slug}`);
      }
    } else if (isBrokerOnly) {
      // Broker-only owner without a personal space — check via owner's space
      try {
        const { data: ownerSpace } = await supabase
          .from('Space')
          .select('slug, stripeSubscriptionStatus, stripeSubscriptionId, trialUsedAt')
          .eq('ownerId', ctx.brokerage.ownerId)
          .maybeSingle();

        if (ownerSpace) {
          const ownerStatus = ownerSpace.stripeSubscriptionStatus ?? 'inactive';
          const ownerSlug = ownerSpace.slug ?? '';
          const ownerHasHistory = !!(ownerSpace.stripeSubscriptionId || ownerSpace.trialUsedAt);
          const isBrokerOnlyExempt = isBillingOrSettings && ownerHasHistory;

          if (ownerStatus !== 'active' && ownerStatus !== 'trialing' && !isBrokerOnlyExempt) {
            if (ownerHasHistory) {
              redirect(`/billing-required?slug=${ownerSlug}&reason=${ownerStatus}`);
            }
            redirect(`/subscribe?slug=${ownerSlug}`);
          }
        }
        // broker_only without personal space — skip subscription gate entirely.
        // These users have no Space to check against; they manage the brokerage
        // without needing a personal subscription.
      } catch (err: any) {
        if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err;
        console.error('[broker-layout] Broker-only owner subscription check error:', err);
        // Don't redirect broker_only users without a space to /subscribe —
        // they have no slug and the subscription wall doesn't apply to them.
      }
    } else {
      // No space and not broker-only — shouldn't be here
      redirect('/setup');
    }
  }

  // ── Broker's first name (for greeting) ────────────────────────────────────
  let brokerFirstName = '';
  try {
    const { data: brokerUserRow } = await supabase
      .from('User')
      .select('name')
      .eq('id', ctx.dbUserId)
      .maybeSingle();
    brokerFirstName = (brokerUserRow?.name ?? '').trim().split(/\s+/)[0] ?? '';
  } catch {
    brokerFirstName = '';
  }

  // ── Brokerage-wide snapshot counts ────────────────────────────────────────
  // Aggregate across all member spaces (including the owner's own space).
  let unreadLeadCount = 0;
  let brokerFollowUpsDue = 0;
  let brokerDraftsReady = 0;
  try {
    const allMembers = await getBrokerageMembers(ctx.brokerage.id, { includeSpaceName: true });
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
      brokerFollowUpsDue = followUpResult.count ?? 0;
      brokerDraftsReady = draftResult.count ?? 0;
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
      brokerFollowUpsDue = followUpResult.count ?? 0;
      brokerDraftsReady = draftResult.count ?? 0;
    }
  } catch {
    unreadLeadCount = 0;
    brokerFollowUpsDue = 0;
    brokerDraftsReady = 0;
  }

  return (
    <div className="app-theme flex h-screen overflow-hidden bg-background text-foreground">
      {/* First-paint splash — greets the broker by name, shows a brokerage-wide
          snapshot of what's happening across member spaces, then dissolves. */}
      <ChippiSplash
        greeting={pickGreeting(brokerFirstName)}
        snapshot={{
          newLeads: unreadLeadCount,
          followUpsDue: brokerFollowUpsDue,
          draftsReady: brokerDraftsReady,
        }}
      />
      <AccountSwitchSwipe />
      <SidebarCollapseProvider>
        <Sidebar
          slug={slug}
          spaceName={spaceName}
          unreadLeadCount={unreadLeadCount}
          isBroker={true}
          isBrokerOnly={isBrokerOnly}
          brokerageName={ctx.brokerage.name}
          brokerageRole={ctx.membership.role}
          brokerageMemberships={[{ id: ctx.brokerage.id, name: ctx.brokerage.name, role: ctx.membership.role }]}
        />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header slug={slug} spaceName={spaceName} title={spaceName} isBroker={true} isBrokerOnly={isBrokerOnly} brokerageName={ctx.brokerage.name} />
          {/* Chat-vs-dashboard padding is decided client-side by usePathname()
              inside BrokerMain — NOT by the fragile x-pathname header — so the
              container is always correct and nothing touches the screen edge. */}
          <BrokerMain>{children}</BrokerMain>
        </div>
      </SidebarCollapseProvider>
      <MobileNav slug={slug} isBroker={true} isBrokerOnly={isBrokerOnly} />
    </div>
  );
}
