import { supabase } from '@/lib/supabase';
import { getBrokerageMembers } from '@/lib/brokerage-members';
import { HOT_LEAD_THRESHOLD, WARM_LEAD_THRESHOLD } from '@/lib/constants';
import {
  PhoneIncoming,
  PhoneOutgoing,
  Briefcase,
  CheckCircle2,
  ArrowRight,
  Clock,
  AlertTriangle,
  Megaphone,
} from 'lucide-react';
import Link from 'next/link';
import { BODY_MUTED, H1, SECTION_LABEL, TITLE_FONT } from '@/lib/typography';
import { cn } from '@/lib/utils';
import type { Brokerage, BrokerageMembership } from '@/lib/types';

type MemberDashboardProps = {
  ctx: {
    brokerage: Brokerage;
    membership: BrokerageMembership;
    dbUserId: string;
  };
};

export async function MemberDashboard({ ctx }: MemberDashboardProps) {
  const { brokerage, dbUserId } = ctx;

  // Find the member's personal Space
  const { data: space } = await supabase
    .from('Space')
    .select('id, slug, name')
    .eq('ownerId', dbUserId)
    .maybeSingle();

  // Find the member's User record for the name
  const { data: userRow } = await supabase
    .from('User')
    .select('name, email')
    .eq('id', dbUserId)
    .maybeSingle();

  const userName = userRow?.name ?? userRow?.email ?? 'Realtor';
  const firstName = userName.split(' ')[0] ?? userName;

  if (!space) {
    return (
      <div className="space-y-6 w-full">
        <header className="space-y-1.5">
          <p className={cn(BODY_MUTED)}>Today.</p>
          <h1 className={cn(H1)} style={TITLE_FONT}>
            {`Welcome, ${firstName}`}
          </h1>
          <p className={cn(BODY_MUTED)}>
            {`${brokerage.name} · finish your workspace to start tracking leads.`}
          </p>
        </header>
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <Briefcase size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
          <p className="text-sm text-foreground">Set up your workspace.</p>
          <p className={cn('text-xs mt-1', BODY_MUTED)}>
            <Link href="/setup" className="underline-offset-2 hover:underline">
              Complete setup
            </Link>{' '}
            to view your dashboard.
          </p>
        </div>
      </div>
    );
  }

  const spaceId = space.id;
  const spaceSlug = space.slug;

  // Resolve the brokerage's admin/owner spaces FIRST so the announcement
  // query can be scoped server-side. Previously this lookup ran after the
  // Promise.all and the announcement query pulled every [ANN] note in the
  // database, then JS-filtered. That's a tenant-boundary leak AND O(global)
  // rows over the wire.
  const brokerMembers = await getBrokerageMembers(brokerage.id);
  const brokerSpaceIds = Array.from(
    new Set(
      brokerMembers
        .filter((m) => m.role === 'broker_owner' || m.role === 'broker_admin')
        .map((m) => m.Space?.id)
        .filter((id): id is string => Boolean(id))
    )
  );

  // ── Fetch stats in parallel ──
  const now = new Date().toISOString();

  const [
    assignedLeadsRes,
    contactedLeadsRes,
    activeDealsRes,
    wonDealsRes,
    recentLeadsRes,
    overdueFollowUpsRes,
    announcementsRes,
  ] = await Promise.all([
    // Count leads assigned by broker
    spaceId
      ? supabase
          .from('Contact')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .contains('tags', ['assigned-by-broker'])
      : Promise.resolve({ count: 0 }),
    // Count contacted leads (lastContactedAt set)
    spaceId
      ? supabase
          .from('Contact')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .contains('tags', ['assigned-by-broker'])
          .not('lastContactedAt', 'is', null)
      : Promise.resolve({ count: 0 }),
    // Active deals
    spaceId
      ? supabase
          .from('Deal')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .eq('status', 'active')
      : Promise.resolve({ count: 0 }),
    // Won deals
    spaceId
      ? supabase
          .from('Deal')
          .select('*', { count: 'exact', head: true })
          .eq('spaceId', spaceId)
          .eq('status', 'won')
      : Promise.resolve({ count: 0 }),
    // Recent assigned leads (last 5)
    spaceId
      ? supabase
          .from('Contact')
          .select('id, name, phone, email, leadScore, scoreLabel, createdAt')
          .eq('spaceId', spaceId)
          .contains('tags', ['assigned-by-broker'])
          .order('createdAt', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
    // Overdue follow-ups
    spaceId
      ? supabase
          .from('Contact')
          .select('id, name, phone, email, followUpAt')
          .eq('spaceId', spaceId)
          .not('followUpAt', 'is', null)
          .lte('followUpAt', now)
          .order('followUpAt', { ascending: true })
          .limit(10)
      : Promise.resolve({ data: [] }),
    // Announcements from broker's space (Notes with title starting with [ANN]).
    // Scoped server-side via `.in('spaceId', ...)` — never pull other tenants'
    // notes over the wire just to filter them out here.
    brokerSpaceIds.length > 0
      ? supabase
          .from('Note')
          .select('id, title, content, createdAt, spaceId')
          .ilike('title', '[ANN]%')
          .in('spaceId', brokerSpaceIds)
          .order('createdAt', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
  ]);

  const assignedCount = assignedLeadsRes.count ?? 0;
  const contactedCount = contactedLeadsRes.count ?? 0;
  const activeDealsCount = activeDealsRes.count ?? 0;
  const wonDealsCount = wonDealsRes.count ?? 0;

  const recentLeads = (recentLeadsRes.data ?? []) as Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    leadScore: number | null;
    scoreLabel: string | null;
    createdAt: string;
  }>;

  const overdueFollowUps = (overdueFollowUpsRes.data ?? []) as Array<{
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    followUpAt: string;
  }>;

  // Announcements are already server-scoped to brokerSpaceIds and limit(3).
  const announcements = (announcementsRes.data ?? []) as Array<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    spaceId: string;
  }>;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  function getScoreBadge(scoreLabel: string | null, leadScore: number | null) {
    if (!scoreLabel && leadScore == null) return null;
    const label = scoreLabel ?? `${leadScore}`;
    const color =
      scoreLabel === 'Hot' || (leadScore && leadScore >= HOT_LEAD_THRESHOLD)
        ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15'
        : scoreLabel === 'Warm' || (leadScore && leadScore >= WARM_LEAD_THRESHOLD)
          ? 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'
          : 'text-muted-foreground bg-muted';
    return (
      <span className={`inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 ${color}`}>
        {label}
      </span>
    );
  }

  // Compose the calm one-sentence status for the header.
  const statusSentence = (() => {
    const parts: string[] = [];
    if (assignedCount > 0) {
      parts.push(`${assignedCount} assigned lead${assignedCount === 1 ? '' : 's'}`);
    }
    if (activeDealsCount > 0) {
      parts.push(`${activeDealsCount} active deal${activeDealsCount === 1 ? '' : 's'}`);
    }
    if (overdueFollowUps.length > 0) {
      parts.push(
        `${overdueFollowUps.length} follow-up${overdueFollowUps.length === 1 ? '' : 's'} due`,
      );
    }
    if (parts.length === 0) {
      return `${brokerage.name} · quiet day — nothing in flight.`;
    }
    return `${brokerage.name} · ${parts.join(' · ')}.`;
  })();

  return (
    <div className="space-y-6 w-full">
      {/* ── Header — canonical three-line status-sentence pattern.
          Muted greeting → serif H1 → one-sentence status. Same shape
          every other broker page uses. ── */}
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Today.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          {`Welcome back, ${firstName}`}
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence}</p>
      </header>

      {/* ── Stats row — hairline-divider snapshot, mirrors deal-quick-panel.
          Foreground for values, muted for labels. Icons stay for scanning
          but render muted; no colored backgrounds. ── */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
        {[
          { label: 'Leads assigned', value: assignedCount, icon: PhoneIncoming },
          { label: 'Leads contacted', value: contactedCount, icon: PhoneOutgoing },
          { label: 'Active deals', value: activeDealsCount, icon: Briefcase },
          { label: 'Deals closed', value: wonDealsCount, icon: CheckCircle2 },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-background px-4 py-4">
            <p className={cn(SECTION_LABEL, 'flex items-center gap-1.5')}>
              <Icon size={11} className="text-muted-foreground" aria-hidden />
              {label}
            </p>
            <p
              className="text-2xl tracking-tight tabular-nums mt-1.5 text-foreground"
              style={TITLE_FONT}
            >
              {value}
            </p>
          </div>
        ))}
      </section>

      {/* ── Two-column layout: Recent leads + Overdue follow-ups ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent assigned leads */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className={SECTION_LABEL}>Recent assigned leads</h2>
            <Link
              href="/broker/my-leads"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
              <PhoneIncoming size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
              <p className="text-sm text-foreground">No assigned leads yet.</p>
              <p className={cn('text-xs mt-1', BODY_MUTED)}>
                Leads assigned by your team will land here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recentLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    href={spaceSlug ? `/s/${spaceSlug}/leads/${lead.id}` : '#'}
                    className="flex items-center gap-3 py-3 -mx-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {(lead.name ?? '?').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{lead.name}</p>
                        {getScoreBadge(lead.scoreLabel, lead.leadScore)}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {[lead.phone, lead.email].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <p className="text-[11px] text-muted-foreground flex-shrink-0">
                      {new Date(lead.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Overdue follow-ups */}
        <div className="space-y-3">
          <h2 className={SECTION_LABEL}>Overdue follow-ups</h2>

          {overdueFollowUps.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
              <CheckCircle2 size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
              <p className="text-sm text-foreground">All caught up.</p>
              <p className={cn('text-xs mt-1', BODY_MUTED)}>
                No overdue follow-ups right now.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {overdueFollowUps.map((contact) => {
                const followUp = new Date(contact.followUpAt);
                const isOverdue = followUp < todayStart;

                return (
                  <li key={contact.id}>
                    <Link
                      href={spaceSlug ? `/s/${spaceSlug}/leads/${contact.id}` : '#'}
                      className="flex items-center gap-3 py-3 -mx-2 px-2 rounded-md hover:bg-muted/30 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                        {isOverdue ? (
                          <AlertTriangle size={14} className="text-muted-foreground" />
                        ) : (
                          <Clock size={14} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{contact.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[contact.phone, contact.email].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 ${
                          isOverdue
                            ? 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/15'
                            : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'
                        }`}
                      >
                        {isOverdue
                          ? `Overdue ${followUp.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                          : 'Today'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── Latest announcements ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className={SECTION_LABEL}>Announcements</h2>
        </div>

        {announcements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
            <Megaphone size={28} className="mx-auto mb-3 text-muted-foreground/60" aria-hidden />
            <p className="text-sm text-foreground">No announcements.</p>
            <p className={cn('text-xs mt-1', BODY_MUTED)}>
              Notes from your team will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {announcements.map((note) => (
              <li key={note.id} className="py-3">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-semibold text-foreground">
                    {note.title.replace(/^\[ANN\]\s*/, '')}
                  </p>
                  <p className="text-[11px] text-muted-foreground flex-shrink-0">
                    {new Date(note.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {note.content?.slice(0, 200)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
