import { notFound, redirect } from 'next/navigation';
import { isPlatformAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { Card, CardContent } from '@/components/ui/card';
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  XCircle,
  Users,
  Hash,
  Globe,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';
import { formatCompact } from '@/lib/formatting';
import { BrokerageActions } from './brokerage-actions';
import { H1, TITLE_FONT, SECTION_LABEL, STAT_NUMBER_COMPACT } from '@/lib/typography';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const { data } = await supabase.from('Brokerage').select('name').eq('id', id).maybeSingle();
  return { title: `${data?.name ?? 'Brokerage'} — Admin` };
}

export default async function AdminBrokerageDetailPage({ params }: Params) {
  const { id } = await params;

  const isAdmin = await isPlatformAdmin();
  if (!isAdmin) redirect('/');

  // Brokerage + owner
  const { data: brokerageRow } = await supabase
    .from('Brokerage')
    .select('*, User!Brokerage_ownerId_fkey(id, name, email)')
    .eq('id', id)
    .maybeSingle();

  if (!brokerageRow) notFound();

  const brokerage = brokerageRow as {
    id: string; name: string; status: string; websiteUrl: string | null;
    logoUrl: string | null; joinCode: string | null; createdAt: string;
    User: { id: string; name: string | null; email: string } | null;
  };

  // Members, invitations, spaces in parallel
  const [membershipsRes, invitationsRes] = await Promise.all([
    supabase
      .from('BrokerageMembership')
      .select('id, role, createdAt, userId')
      .eq('brokerageId', id)
      .order('createdAt', { ascending: true }),
    supabase
      .from('Invitation')
      .select('id, email, roleToAssign, status, createdAt, expiresAt')
      .eq('brokerageId', id)
      .order('createdAt', { ascending: false }),
  ]);

  const rawMemberships = (membershipsRes.data ?? []) as Array<{ id: string; role: string; createdAt: string; userId: string }>;
  const mUserIds = rawMemberships.map((m) => m.userId).filter(Boolean);

  let mUsers: any[] = [];
  let mSpaces: any[] = [];
  if (mUserIds.length > 0) {
    const [uRes, sRes] = await Promise.all([
      supabase.from('User').select('id, name, email, onboard').in('id', mUserIds),
      supabase.from('Space').select('id, slug, ownerId').in('ownerId', mUserIds),
    ]);
    mUsers = uRes.data ?? [];
    mSpaces = sRes.data ?? [];
  }
  const mUserMap = new Map(mUsers.map((u: any) => [u.id, u]));
  const mSpaceMap = new Map(mSpaces.map((s: any) => [s.ownerId, s]));

  const members = rawMemberships.map((m) => ({
    ...m,
    User: mUserMap.get(m.userId) ?? null,
    Space: mSpaceMap.get(m.userId) ?? null,
  })) as Array<{
    id: string; role: string; createdAt: string; userId: string;
    User: { id: string; name: string | null; email: string; onboard: boolean } | null;
    Space: { id: string; slug: string } | null;
  }>;

  const invitations = (invitationsRes.data ?? []) as Array<{
    id: string; email: string; roleToAssign: string; status: string;
    createdAt: string; expiresAt: string;
  }>;

  // Per-space stats
  const spaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];

  const [dealRows, pendingInviteCount] = await Promise.all([
    spaceIds.length > 0
      ? supabase.from('Deal').select('spaceId, value').in('spaceId', spaceIds).then((r) => r.data ?? [])
      : Promise.resolve([]),
    supabase.from('Invitation').select('*', { count: 'exact', head: true }).eq('brokerageId', id).eq('status', 'pending'),
  ]);

  const totalDeals = (dealRows as { value: number | null }[]).length;
  const totalPipeline = (dealRows as { value: number | null }[]).reduce((a, r) => a + (r.value ?? 0), 0);

  const roleLabel = (role: string) =>
    role === 'broker_owner' ? 'Owner' : role === 'broker_admin' ? 'Admin' : 'Realtor';

  const statusLabel = (s: string) =>
    s === 'accepted' ? 'Accepted' : s === 'cancelled' ? 'Revoked' : s === 'expired' ? 'Expired' : 'Pending';

  const createdAt = new Date(brokerage.createdAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  const owner = brokerage.User;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/admin/brokerages"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} /> Back to brokerages
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-foreground/[0.06] flex items-center justify-center flex-shrink-0">
            <Building2 size={20} className="text-muted-foreground" />
          </div>
          <div>
            <h1 className={H1} style={TITLE_FONT}>{brokerage.name}</h1>
            <p className="text-sm text-muted-foreground">
              {owner?.name ?? owner?.email ?? 'Unknown owner'} · Created {createdAt}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {brokerage.status === 'active' ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15">
              <CheckCircle2 size={11} /> Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-500/15">
              <XCircle size={11} /> Suspended
            </span>
          )}
        </div>
      </div>

      {/* Stat cards — hairline-divider snapshot grid, neutral throughout */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
        {[
          { label: 'Members',         value: members.length },
          { label: 'Pending invites', value: pendingInviteCount.count ?? 0 },
          { label: 'Active deals',    value: totalDeals },
          { label: 'Pipeline value',  value: formatCompact(totalPipeline) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-background px-4 py-4">
            <p className={SECTION_LABEL}>{label}</p>
            <p className={`${STAT_NUMBER_COMPACT} mt-1`} style={TITLE_FONT}>{value}</p>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: members */}
        <div className="lg:col-span-2 space-y-2">
          <p className={SECTION_LABEL}>
            Members
            <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
              {members.length}
            </span>
          </p>
          {members.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
              <p className="text-sm text-foreground">Nobody here yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Members show up once invitations are accepted.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60 border-y border-border/60">
              {members.map((m) => {
                const user = m.User;
                const initials = (user?.name ?? user?.email ?? '?')
                  .split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
                const joined = new Date(m.createdAt).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                });
                return (
                  <li key={m.id} className="flex items-center gap-3 py-3">
                    <div className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center text-[11px] font-semibold text-foreground/70 flex-shrink-0">
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <Link
                          href={`/admin/users/${m.userId}`}
                          className="text-sm font-medium text-foreground hover:underline underline-offset-2 truncate"
                        >
                          {user?.name ?? 'No name'}
                        </Link>
                        <span className="text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5 flex-shrink-0">
                          {roleLabel(m.role)}
                        </span>
                        {user?.onboard ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15">
                            <CheckCircle2 size={10} /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15">
                            Pending
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {user?.email}
                        <span aria-hidden className="mx-1.5 text-muted-foreground/40">·</span>
                        Joined {joined}
                      </p>
                    </div>
                    {m.role !== 'broker_owner' && (
                      <div className="flex-shrink-0">
                        <BrokerageActions
                          action="remove-member"
                          membershipId={m.id}
                          label={user?.name ?? user?.email ?? 'this member'}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: brokerage info + actions */}
        <div className="space-y-4">
          {/* Info card */}
          <div className="space-y-2">
            <p className={SECTION_LABEL}>Details</p>
            <Card>
              <CardContent className="px-4 py-3 space-y-3">
                <div className="flex items-start gap-2.5">
                  <Hash size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">ID</p>
                    <p className="text-xs font-mono break-all">{brokerage.id}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Users size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Owner</p>
                    <Link
                      href={`/admin/users/${owner?.id}`}
                      className="text-xs text-foreground hover:underline underline-offset-2"
                    >
                      {owner?.name ?? owner?.email ?? '—'}
                    </Link>
                  </div>
                </div>
                {brokerage.joinCode && (
                  <div className="flex items-start gap-2.5">
                    <Hash size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Join Code</p>
                      <p className="text-xs font-mono">{brokerage.joinCode}</p>
                    </div>
                  </div>
                )}
                {brokerage.websiteUrl && (
                  <div className="flex items-start gap-2.5">
                    <Globe size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Website</p>
                      <p className="text-xs truncate">{brokerage.websiteUrl}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-2.5">
                  <Calendar size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Created</p>
                    <p className="text-xs">{createdAt}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Admin actions */}
          <div className="space-y-2">
            <p className={SECTION_LABEL}>Admin actions</p>
            <Card>
              <CardContent className="px-4 py-4 space-y-2">
                <BrokerageActions
                  action="toggle-status"
                  brokerageId={brokerage.id}
                  currentStatus={brokerage.status}
                />
                <BrokerageActions
                  action="delete"
                  brokerageId={brokerage.id}
                  brokerageName={brokerage.name}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Invitations */}
      <div className="space-y-2">
        <p className={SECTION_LABEL}>
          Invitations
          <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
            {invitations.length}
          </span>
        </p>
        {invitations.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className="text-sm text-foreground">No invitations sent.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Invitations this brokerage sends will show up here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {invitations.map((inv) => {
              const sent = new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const expires = new Date(inv.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              const statusPill =
                inv.status === 'accepted'
                  ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15'
                  : inv.status === 'pending'
                    ? 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'
                    : 'text-muted-foreground bg-muted';
              return (
                <li key={inv.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">{inv.email}</span>
                      <span className="text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5 flex-shrink-0">
                        {inv.roleToAssign === 'broker_admin' ? 'Admin' : 'Realtor'}
                      </span>
                      <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 flex-shrink-0 ${statusPill}`}>
                        {statusLabel(inv.status)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Sent {sent}
                      <span aria-hidden className="mx-1.5 text-muted-foreground/40">·</span>
                      Expires {expires}
                    </p>
                  </div>
                  {inv.status === 'pending' && (
                    <div className="flex-shrink-0">
                      <BrokerageActions
                        action="revoke-invite"
                        invitationId={inv.id}
                        label={inv.email}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
