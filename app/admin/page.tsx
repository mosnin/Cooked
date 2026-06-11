import { supabase } from '@/lib/supabase';
import {
  Users,
  CheckCircle2,
  AlertTriangle,
  PhoneIncoming,
  Building2,
  TrendingUp,
  Briefcase,
  UserPlus,
  DollarSign,
  CreditCard,
  Flame,
  Thermometer,
  Snowflake,
  BarChart3,
  Clock,
  AlertCircle,
  Moon,
  Calendar,
  Bell,
} from 'lucide-react';
import Link from 'next/link';
import { formatCompact } from '@/lib/formatting';
import { SignupChart } from './components/signup-chart';
import { isPlatformAdmin } from '@/lib/permissions';
import { redirect } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  SECTION_LABEL,
  STAT_NUMBER,
  STAT_NUMBER_COMPACT,
  H3,
  META,
  CAPTION,
} from '@/lib/typography';

export default async function AdminOverviewPage() {
  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) redirect('/');
  // ── Parallel data fetches (UNCHANGED) ───────────────────────────────────
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  let totalUsers = 0,
    onboardedUsers = 0,
    usersWithSpace = 0,
    totalContacts = 0,
    totalLeads = 0,
    totalBrokerages = 0,
    activeBrokerages = 0,
    totalDeals = 0,
    totalPipelineValue = 0,
    signupsLast7 = 0,
    signupsLast30 = 0,
    leadsLast7 = 0;
  // Revenue metrics
  let activeSubscriptions = 0,
    trialUsers = 0,
    pastDueUsers = 0,
    canceledUsers = 0,
    churnRate = 0,
    mrr = 0;

  // Feature usage metrics
  let spacesWithLeads = 0,
    spacesWithDeals = 0,
    spacesWithTours = 0,
    totalTours = 0,
    totalFollowUps = 0,
    totalSpaces = 0;

  // Lead quality metrics
  let hotLeads = 0,
    warmLeads = 0,
    coldLeads = 0,
    unqualifiedLeads = 0;

  let recentUsers: {
    id: string;
    name: string | null;
    email: string;
    onboard: boolean;
    createdAt: string;
    space: { slug: string } | null;
  }[] = [];

  // At-risk lists
  type AtRiskTrial = {
    userId: string;
    name: string | null;
    email: string;
    daysLeft: number;
  };
  type AtRiskPastDue = {
    userId: string;
    name: string | null;
    email: string;
    daysPastDue: number;
  };
  type AtRiskInactive = {
    userId: string;
    name: string | null;
    email: string;
    daysSinceLastContact: number | null;
  };
  let trialEndingSoon: AtRiskTrial[] = [];
  let trialEndingSoonTotal = 0;
  let pastDueList: AtRiskPastDue[] = [];
  let pastDueTotal = 0;
  let inactiveWorkspaces: AtRiskInactive[] = [];
  let inactiveWorkspacesTotal = 0;
  let signupsByDay: { date: string; count: number }[] = [];
  let recentActivity: {
    type: 'signup' | 'lead' | 'deal' | 'brokerage';
    label: string;
    detail: string;
    time: string;
  }[] = [];

  try {
    const [
      totalRes,
      onboardedRes,
      withSpaceRes,
      contactsRes,
      leadsRes,
      brokerageRes,
      activeBrokerageRes,
      dealsRes,
      signups7Res,
      signups30Res,
      leads7Res,
      recentRes,
      signupsRaw,
      recentLeads,
      recentDeals,
      recentBrokerages,
    ] = await Promise.all([
      supabase.from('User').select('*', { count: 'exact', head: true }),
      supabase.from('User').select('*', { count: 'exact', head: true }).eq('onboard', true),
      supabase.from('User').select('*, Space!inner(id)', { count: 'exact', head: true }),
      supabase.from('Contact').select('*', { count: 'exact', head: true }),
      supabase
        .from('Contact')
        .select('*', { count: 'exact', head: true })
        .contains('tags', ['application-link']),
      supabase.from('Brokerage').select('*', { count: 'exact', head: true }),
      supabase
        .from('Brokerage')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active'),
      supabase.from('Deal').select('value'),
      supabase
        .from('User')
        .select('*', { count: 'exact', head: true })
        .gte('createdAt', sevenDaysAgo),
      supabase
        .from('User')
        .select('*', { count: 'exact', head: true })
        .gte('createdAt', thirtyDaysAgo),
      supabase
        .from('Contact')
        .select('*', { count: 'exact', head: true })
        .contains('tags', ['application-link'])
        .gte('createdAt', sevenDaysAgo),
      supabase
        .from('User')
        .select('id, name, email, onboard, createdAt, Space(slug)')
        .order('createdAt', { ascending: false })
        .limit(5),
      // Last 30 days signups for chart
      supabase
        .from('User')
        .select('createdAt')
        .gte('createdAt', thirtyDaysAgo)
        .order('createdAt', { ascending: true }),
      // Recent leads for activity feed
      supabase
        .from('Contact')
        .select('name, createdAt, Space(name)')
        .contains('tags', ['application-link'])
        .order('createdAt', { ascending: false })
        .limit(3),
      // Recent deals for activity feed
      supabase
        .from('Deal')
        .select('title, value, createdAt, Space(name)')
        .order('createdAt', { ascending: false })
        .limit(3),
      // Recent brokerages for activity feed
      supabase
        .from('Brokerage')
        .select('name, createdAt')
        .order('createdAt', { ascending: false })
        .limit(2),
    ]);

    totalUsers = totalRes.count ?? 0;
    onboardedUsers = onboardedRes.count ?? 0;
    usersWithSpace = withSpaceRes.count ?? 0;
    totalContacts = contactsRes.count ?? 0;
    totalLeads = leadsRes.count ?? 0;
    totalBrokerages = brokerageRes.count ?? 0;
    activeBrokerages = activeBrokerageRes.count ?? 0;
    signupsLast7 = signups7Res.count ?? 0;
    signupsLast30 = signups30Res.count ?? 0;
    leadsLast7 = leads7Res.count ?? 0;

    const dealRows = (dealsRes.data ?? []) as { value: number | null }[];
    totalDeals = dealRows.length;
    totalPipelineValue = dealRows.reduce((a, r) => a + (r.value ?? 0), 0);

    recentUsers = (recentRes.data ?? []).map((row: any) => ({
      id: row.id as string,
      name: row.name as string | null,
      email: row.email as string,
      onboard: row.onboard as boolean,
      createdAt: row.createdAt as string,
      space: row.Space?.slug ? { slug: row.Space.slug as string } : null,
    }));

    // Build signup chart data (last 30 days, grouped by day)
    const dayMap: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      dayMap[d.toISOString().slice(0, 10)] = 0;
    }
    for (const row of signupsRaw.data ?? []) {
      const day = new Date((row as { createdAt: string }).createdAt).toISOString().slice(0, 10);
      if (day in dayMap) dayMap[day]++;
    }
    signupsByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

    // Build activity feed
    const activities: typeof recentActivity = [];
    for (const u of recentUsers.slice(0, 3)) {
      activities.push({
        type: 'signup',
        label: u.name || u.email,
        detail: u.onboard ? 'Signed up & onboarded' : 'Signed up (pending onboarding)',
        time: u.createdAt,
      });
    }
    for (const l of (recentLeads.data ?? []) as any[]) {
      activities.push({
        type: 'lead',
        label: l.name || 'New lead',
        detail: l.Space?.name ? `via ${l.Space.name}` : 'New lead submitted',
        time: l.createdAt,
      });
    }
    for (const d of (recentDeals.data ?? []) as any[]) {
      activities.push({
        type: 'deal',
        label: d.title || 'New deal',
        detail: d.value ? formatCompact(d.value) : 'Deal created',
        time: d.createdAt,
      });
    }
    for (const b of (recentBrokerages.data ?? []) as any[]) {
      activities.push({
        type: 'brokerage',
        label: b.name,
        detail: 'Brokerage created',
        time: b.createdAt,
      });
    }
    recentActivity = activities
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);

    // ── Revenue metrics ───────────────────────────────────────────────
    try {
      const subRes = await supabase.from('Space').select('stripeSubscriptionStatus');
      const statuses = (subRes.data ?? []) as { stripeSubscriptionStatus: string | null }[];
      totalSpaces = statuses.length;
      for (const row of statuses) {
        const s = row.stripeSubscriptionStatus;
        if (s === 'active') activeSubscriptions++;
        else if (s === 'trialing') trialUsers++;
        else if (s === 'past_due') pastDueUsers++;
        else if (s === 'canceled') canceledUsers++;
      }
      mrr = activeSubscriptions * 97;
      churnRate =
        activeSubscriptions + canceledUsers > 0
          ? Math.round((canceledUsers / (activeSubscriptions + canceledUsers)) * 100)
          : 0;
    } catch (e) {
      console.error('[admin] Revenue queries failed', e);
    }

    // ── Feature usage metrics ─────────────────────────────────────────
    try {
      const [contactSpaces, dealSpaces, tourSpaces, toursCount, followUpsCount] =
        await Promise.all([
          supabase.from('Contact').select('spaceId').limit(1000),
          supabase.from('Deal').select('spaceId').limit(1000),
          supabase.from('Tour').select('spaceId').limit(1000),
          supabase.from('Tour').select('*', { count: 'exact', head: true }),
          supabase
            .from('Contact')
            .select('*', { count: 'exact', head: true })
            .not('followUpAt', 'is', null),
        ]);
      spacesWithLeads = new Set(
        (contactSpaces.data ?? []).map((r: any) => r.spaceId).filter(Boolean)
      ).size;
      spacesWithDeals = new Set(
        (dealSpaces.data ?? []).map((r: any) => r.spaceId).filter(Boolean)
      ).size;
      spacesWithTours = new Set(
        (tourSpaces.data ?? []).map((r: any) => r.spaceId).filter(Boolean)
      ).size;
      totalTours = toursCount.count ?? 0;
      totalFollowUps = followUpsCount.count ?? 0;
    } catch (e) {
      console.error('[admin] Feature usage queries failed', e);
    }

    // ── Lead quality distribution ─────────────────────────────────────
    try {
      const scoreRes = await supabase
        .from('Contact')
        .select('scoreLabel')
        .not('scoreLabel', 'is', null)
        .limit(5000);
      for (const row of (scoreRes.data ?? []) as { scoreLabel: string }[]) {
        const label = row.scoreLabel?.toLowerCase();
        if (label === 'hot') hotLeads++;
        else if (label === 'warm') warmLeads++;
        else if (label === 'cold') coldLeads++;
        else if (label === 'unqualified') unqualifiedLeads++;
      }
    } catch (e) {
      console.error('[admin] Lead quality queries failed', e);
    }

    // ── At-risk / churn alerts ────────────────────────────────────────
    try {
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 86_400_000).toISOString();
      const nowIso = now.toISOString();

      const [trialRes, pastDueRes, oldSpacesRes] = await Promise.all([
        supabase
          .from('Space')
          .select('id, ownerId, stripePeriodEnd, User!inner(id, name, email)')
          .eq('stripeSubscriptionStatus', 'trialing')
          .not('stripePeriodEnd', 'is', null)
          .lte('stripePeriodEnd', sevenDaysFromNow)
          .gte('stripePeriodEnd', nowIso)
          .order('stripePeriodEnd', { ascending: true }),
        supabase
          .from('Space')
          .select('id, ownerId, stripePeriodEnd, User!inner(id, name, email)')
          .eq('stripeSubscriptionStatus', 'past_due')
          .order('stripePeriodEnd', { ascending: true }),
        supabase
          .from('Space')
          .select('id, ownerId, createdAt, User!inner(id, name, email)')
          .lte('createdAt', thirtyDaysAgo)
          .limit(500),
      ]);

      const trialRows = (trialRes.data ?? []) as {
        id: string;
        ownerId: string;
        stripePeriodEnd: string | null;
        User: { id: string; name: string | null; email: string } | { id: string; name: string | null; email: string }[] | null;
      }[];
      trialEndingSoonTotal = trialRows.length;
      trialEndingSoon = trialRows.slice(0, 5).map((r) => {
        const u = Array.isArray(r.User) ? r.User[0] : r.User;
        const periodEnd = r.stripePeriodEnd ? new Date(r.stripePeriodEnd).getTime() : now.getTime();
        const daysLeft = Math.max(0, Math.ceil((periodEnd - now.getTime()) / 86_400_000));
        return {
          userId: u?.id ?? r.ownerId,
          name: u?.name ?? null,
          email: u?.email ?? '',
          daysLeft,
        };
      });

      const pastDueRows = (pastDueRes.data ?? []) as {
        id: string;
        ownerId: string;
        stripePeriodEnd: string | null;
        User: { id: string; name: string | null; email: string } | { id: string; name: string | null; email: string }[] | null;
      }[];
      pastDueTotal = pastDueRows.length;
      pastDueList = pastDueRows.slice(0, 5).map((r) => {
        const u = Array.isArray(r.User) ? r.User[0] : r.User;
        const periodEnd = r.stripePeriodEnd ? new Date(r.stripePeriodEnd).getTime() : now.getTime();
        const daysPastDue = Math.max(0, Math.floor((now.getTime() - periodEnd) / 86_400_000));
        return {
          userId: u?.id ?? r.ownerId,
          name: u?.name ?? null,
          email: u?.email ?? '',
          daysPastDue,
        };
      });

      const oldSpaceRows = (oldSpacesRes.data ?? []) as {
        id: string;
        ownerId: string;
        createdAt: string;
        User: { id: string; name: string | null; email: string } | { id: string; name: string | null; email: string }[] | null;
      }[];
      if (oldSpaceRows.length > 0) {
        const spaceIds = oldSpaceRows.map((r) => r.id);
        const recentContactsRes = await supabase
          .from('Contact')
          .select('spaceId, createdAt')
          .in('spaceId', spaceIds)
          .gte('createdAt', thirtyDaysAgo);
        const activeSpaceIds = new Set(
          ((recentContactsRes.data ?? []) as { spaceId: string }[])
            .map((r) => r.spaceId)
            .filter(Boolean)
        );

        const inactiveSpaces = oldSpaceRows.filter((r) => !activeSpaceIds.has(r.id));
        inactiveWorkspacesTotal = inactiveSpaces.length;

        const candidates = inactiveSpaces.slice(0, 10);
        const lastContactMap = new Map<string, string | null>();
        if (candidates.length > 0) {
          const lastContactsRes = await supabase
            .from('Contact')
            .select('spaceId, createdAt')
            .in('spaceId', candidates.map((c) => c.id))
            .order('createdAt', { ascending: false });
          for (const c of (lastContactsRes.data ?? []) as { spaceId: string; createdAt: string }[]) {
            if (!lastContactMap.has(c.spaceId)) {
              lastContactMap.set(c.spaceId, c.createdAt);
            }
          }
        }

        inactiveWorkspaces = candidates
          .map((r) => {
            const u = Array.isArray(r.User) ? r.User[0] : r.User;
            const last = lastContactMap.get(r.id);
            const daysSince = last
              ? Math.floor((now.getTime() - new Date(last).getTime()) / 86_400_000)
              : null;
            return {
              userId: u?.id ?? r.ownerId,
              name: u?.name ?? null,
              email: u?.email ?? '',
              daysSinceLastContact: daysSince,
            };
          })
          .sort((a, b) => {
            const av = a.daysSinceLastContact ?? Number.MAX_SAFE_INTEGER;
            const bv = b.daysSinceLastContact ?? Number.MAX_SAFE_INTEGER;
            return bv - av;
          })
          .slice(0, 5);
      }
    } catch (e) {
      console.error('[admin] At-risk queries failed', e);
    }
  } catch (err) {
    console.error('[admin] DB queries failed', { error: err });
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-8 py-12 text-center">
          <p className="text-sm text-foreground font-medium">Couldn&apos;t load admin dashboard.</p>
          <p className="text-xs text-muted-foreground mt-1">This is usually temporary.</p>
          <a
            href="/admin"
            className="mt-4 inline-flex items-center justify-center rounded-md h-9 px-4 text-sm font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            Try again
          </a>
        </div>
      </div>
    );
  }

  const notOnboarded = totalUsers - onboardedUsers;
  const onboardRate = totalUsers > 0 ? Math.round((onboardedUsers / totalUsers) * 100) : 0;

  const activityIcon = {
    signup: UserPlus,
    lead: PhoneIncoming,
    deal: Briefcase,
    brokerage: Building2,
  };

  return (
    <div className="space-y-12 pb-12">
      {/* ── Page header (status-sentence pattern) ──────────────────────── */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Platform.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Chippi admin
        </h1>
        <p className={BODY_MUTED}>
          {totalUsers} users · {activeSubscriptions} active · ${mrr.toLocaleString()} MRR.
        </p>
      </header>

      {/* ── Primary pulse stats — hairline grid ───────────────────────── */}
      {/*
        8 numbers an admin actually checks on every visit.
        Jobs lens: cut the 30-card wall. Keep the numbers that answer
        "is the business healthy?" at a glance.
      */}
      <section
        className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
        aria-label="Key metrics"
      >
        {[
          {
            label: 'Total users',
            value: totalUsers,
            sub: `+${signupsLast7} this week`,
          },
          {
            label: 'Onboarded',
            value: onboardedUsers,
            sub: `${onboardRate}% conversion`,
          },
          {
            label: 'MRR',
            value: `$${mrr.toLocaleString()}`,
            sub: `${activeSubscriptions} active`,
          },
          {
            label: 'Brokerages',
            value: totalBrokerages,
            sub: `${activeBrokerages} active`,
          },
          {
            label: 'Total leads',
            value: totalLeads,
            sub: `+${leadsLast7} this week`,
          },
          {
            label: 'Pipeline',
            value: formatCompact(totalPipelineValue),
            sub: `${totalDeals} deals`,
          },
          {
            label: 'Trial users',
            value: trialUsers,
            sub: trialEndingSoonTotal > 0 ? `${trialEndingSoonTotal} expiring soon` : 'no expiries soon',
          },
          {
            label: 'Past due',
            value: pastDueUsers,
            sub: pastDueUsers > 0 ? 'needs attention' : 'all clear',
            alert: pastDueUsers > 0,
          },
        ].map(({ label, value, sub, alert }) => (
          <div key={label} className="bg-background px-4 py-4 sm:px-5 sm:py-5">
            <p className={cn(SECTION_LABEL, 'mb-2')}>{label}</p>
            <p
              className={cn(
                STAT_NUMBER_COMPACT,
                alert && 'text-amber-600 dark:text-amber-400',
              )}
            >
              {value}
            </p>
            <p className={cn(META, 'mt-1')}>{sub}</p>
          </div>
        ))}
      </section>

      {/* ── At-risk (actionable) ──────────────────────────────────────── */}
      <section className="space-y-6">
        <p className={SECTION_LABEL}>At risk</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Trial ending soon */}
          <AtRiskCard
            title="Trial ending soon"
            count={trialEndingSoonTotal}
            empty="No trials expiring in the next 7 days."
            viewAllHref="/admin/users?filter=trialing"
          >
            {trialEndingSoon.map((u) => (
              <AtRiskRow
                key={u.userId}
                href={`/admin/users/${u.userId}`}
                name={u.name || u.email}
                email={u.email}
                badge={`${u.daysLeft}d left`}
                badgeClass="text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15"
              />
            ))}
          </AtRiskCard>

          {/* Past due */}
          <AtRiskCard
            title="Past due"
            count={pastDueTotal}
            empty="No past-due accounts."
            viewAllHref="/admin/users?filter=past-due"
          >
            {pastDueList.map((u) => (
              <AtRiskRow
                key={u.userId}
                href={`/admin/users/${u.userId}`}
                name={u.name || u.email}
                email={u.email}
                badge={`${u.daysPastDue}d`}
                badgeClass="text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15"
              />
            ))}
          </AtRiskCard>

          {/* Inactive workspaces */}
          <AtRiskCard
            title="Inactive workspaces"
            count={inactiveWorkspacesTotal}
            empty="No inactive workspaces."
            viewAllHref="/admin/users?filter=inactive"
          >
            {inactiveWorkspaces.map((u) => (
              <AtRiskRow
                key={u.userId}
                href={`/admin/users/${u.userId}`}
                name={u.name || u.email}
                email={u.email}
                badge={
                  u.daysSinceLastContact === null
                    ? 'never'
                    : `${u.daysSinceLastContact}d`
                }
                badgeClass="text-muted-foreground bg-muted"
              />
            ))}
          </AtRiskCard>
        </div>
      </section>

      {/* ── Growth chart + Conversion funnel ──────────────────────────── */}
      <section className="space-y-6">
        <p className={SECTION_LABEL}>Growth</p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Signup chart — spans 2 columns */}
          <div className="lg:col-span-2 rounded-xl border border-border/70 bg-card px-5 py-5">
            <p className={H3}>User growth</p>
            <p className={cn(CAPTION, 'mt-0.5 mb-4')}>
              Signups over the last 30 days · {signupsLast30} total
            </p>
            <SignupChart data={signupsByDay} />
          </div>

          {/* Conversion funnel */}
          <div className="rounded-xl border border-border/70 bg-card px-5 py-5">
            <p className={H3}>Conversion funnel</p>
            <p className={cn(CAPTION, 'mt-0.5 mb-5')}>User journey breakdown</p>
            <div className="space-y-4">
              {[
                { label: 'Signed up', value: totalUsers, pct: 100 },
                { label: 'Onboarded', value: onboardedUsers, pct: onboardRate },
                {
                  label: 'Created workspace',
                  value: usersWithSpace,
                  pct: totalUsers > 0 ? Math.round((usersWithSpace / totalUsers) * 100) : 0,
                },
                {
                  label: 'Has leads',
                  value: totalLeads > 0 ? totalLeads : 0,
                  pct:
                    totalUsers > 0 && totalLeads > 0
                      ? Math.min(Math.round((totalLeads / totalUsers) * 100), 100)
                      : 0,
                },
              ].map(({ label, value, pct }) => (
                <div key={label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={CAPTION}>{label}</span>
                    <span className={cn(META, 'text-foreground tabular-nums')}>
                      {value}{' '}
                      <span className="text-muted-foreground">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-foreground rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature adoption + Lead quality ──────────────────────────── */}
      <section className="space-y-6">
        <p className={SECTION_LABEL}>Adoption</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Feature adoption */}
          <div className="rounded-xl border border-border/70 bg-card px-5 py-5">
            <p className={H3}>Feature adoption</p>
            <p className={cn(CAPTION, 'mt-0.5 mb-5')}>Spaces using each feature</p>
            <div className="space-y-4">
              {[
                { label: 'Spaces with leads', value: spacesWithLeads, total: totalSpaces, icon: PhoneIncoming },
                { label: 'Spaces with deals', value: spacesWithDeals, total: totalSpaces, icon: Briefcase },
                { label: 'Spaces with tours', value: spacesWithTours, total: totalSpaces, icon: Calendar },
                { label: 'Total tours booked', value: totalTours, total: null, icon: Calendar },
                { label: 'Follow-ups set', value: totalFollowUps, total: null, icon: Bell },
              ].map(({ label, value, total, icon: Icon }) => {
                const pct = total && total > 0 ? Math.round((value / total) * 100) : null;
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={CAPTION}>{label}</span>
                      <span className={cn(META, 'text-foreground')}>
                        {value}
                        {total !== null && (
                          <span className="text-muted-foreground"> / {total}</span>
                        )}
                      </span>
                    </div>
                    {pct !== null && (
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-foreground/60 rounded-full transition-all duration-500"
                          style={{ width: `${Math.max(pct, 2)}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Lead quality */}
          <div className="rounded-xl border border-border/70 bg-card px-5 py-5">
            <p className={H3}>Lead quality</p>
            <p className={cn(CAPTION, 'mt-0.5 mb-5')}>Scored lead distribution</p>
            <div
              className="grid grid-cols-2 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
              aria-label="Lead quality breakdown"
            >
              {[
                {
                  label: 'Hot',
                  value: hotLeads,
                  pill: 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/15',
                },
                {
                  label: 'Warm',
                  value: warmLeads,
                  pill: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
                },
                {
                  label: 'Cold',
                  value: coldLeads,
                  pill: 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15',
                },
                {
                  label: 'Unqualified',
                  value: unqualifiedLeads,
                  pill: 'text-muted-foreground bg-muted',
                },
              ].map(({ label, value, pill }) => (
                <div key={label} className="bg-background px-4 py-4">
                  <p className={SECTION_LABEL}>{label}</p>
                  <p className={cn(STAT_NUMBER_COMPACT, 'mt-1.5')}>{value}</p>
                  <span
                    className={cn(
                      'inline-flex mt-2 text-[10px] font-medium rounded-full px-2 py-0.5',
                      pill,
                    )}
                  >
                    {label.toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent signups + Activity feed ──────────────────────────── */}
      <section className="space-y-6">
        <p className={SECTION_LABEL}>Recent</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Recent signups */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className={H3}>Recent signups</p>
              <Link
                href="/admin/users"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                View all →
              </Link>
            </div>
            {recentUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
                <p className="text-sm text-foreground">No users yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card overflow-hidden">
                {recentUsers.map((user) => (
                  <li key={user.id}>
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.04] transition-colors duration-150"
                    >
                      <div className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center text-xs font-semibold text-foreground/80 flex-shrink-0">
                        {(user.name || user.email || '?')
                          .split(' ')
                          .map((n: string) => n[0])
                          .join('')
                          .toUpperCase()
                          .slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {user.name || 'No name'}
                        </p>
                        <p className={cn(CAPTION, 'truncate')}>{user.email}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {user.space?.slug && (
                          <span className="hidden sm:inline-flex text-[10px] font-medium text-muted-foreground bg-foreground/[0.05] rounded-full px-2 py-0.5">
                            {user.space.slug}
                          </span>
                        )}
                        <span
                          className={cn(
                            'inline-flex text-[10px] font-medium rounded-full px-2 py-0.5',
                            user.onboard
                              ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15'
                              : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
                          )}
                        >
                          {user.onboard ? 'Onboarded' : 'Pending'}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Activity feed */}
          <div className="space-y-3">
            <p className={H3}>Recent activity</p>
            {recentActivity.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
                <p className="text-sm text-foreground">No activity yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card overflow-hidden">
                {recentActivity.map((item, i) => {
                  const Icon = activityIcon[item.type];
                  const ago = timeAgo(item.time);
                  return (
                    <li key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-7 h-7 rounded-md bg-foreground/[0.05] flex items-center justify-center flex-shrink-0">
                        <Icon size={13} strokeWidth={1.75} className="text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{item.label}</p>
                        <p className={cn(CAPTION, 'truncate')}>{item.detail}</p>
                      </div>
                      <span className={cn(META, 'flex-shrink-0')}>{ago}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── Footer timestamp ─────────────────────────────────────────── */}
      <p className={cn(META, 'text-center border-t border-border/60 pt-4')}>
        Updated{' '}
        {now.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}
      </p>
    </div>
  );
}

// ── At-risk card ───────────────────────────────────────────────────────────

function AtRiskCard({
  title,
  count,
  empty,
  viewAllHref,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  viewAllHref: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-5 py-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <p className={H3}>{title}</p>
        <span className={cn(META, 'tabular-nums text-foreground')}>{count}</span>
      </div>
      {count === 0 ? (
        <p className={cn(CAPTION, 'flex-1')}>{empty}</p>
      ) : (
        <ul className="flex-1 -mx-2 divide-y divide-border/40">
          {children}
        </ul>
      )}
      <Link
        href={viewAllHref}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors mt-4 self-start"
      >
        View all →
      </Link>
    </div>
  );
}

function AtRiskRow({
  href,
  name,
  email,
  badge,
  badgeClass,
}: {
  href: string;
  name: string;
  email: string;
  badge: string;
  badgeClass: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-2 px-2 py-2 rounded-md hover:bg-foreground/[0.04] transition-colors duration-150"
      >
        <div className="min-w-0">
          <p className="text-xs font-medium truncate">{name}</p>
          <p className={cn(META, 'truncate')}>{email}</p>
        </div>
        <span
          className={cn(
            'text-[10px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 tabular-nums',
            badgeClass,
          )}
        >
          {badge}
        </span>
      </Link>
    </li>
  );
}

// ── timeAgo (unchanged) ───────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
