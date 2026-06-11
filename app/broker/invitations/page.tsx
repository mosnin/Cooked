import { getBrokerContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { InviteForm } from '@/components/broker/invite-form';
import { InviteCodeCard } from '@/components/broker/invite-code-card';
import { RevokeInviteButton } from '@/components/broker/revoke-invite-button';
import { BulkInviteForm } from '@/components/broker/bulk-invite-form';
import { getSeatUsage } from '@/lib/brokerage-seats';
import { H1, TITLE_FONT, BODY_MUTED, SECTION_LABEL } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/formatting';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Invitations — Broker Dashboard' };

// Status pill tone — muted by default. Pending earns amber; accepted earns
// emerald; cancelled and expired recede to muted.
function statusPill(status: string): { label: string; class: string } | null {
  switch (status) {
    case 'pending':
      return {
        label: 'Pending',
        class:
          'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
      };
    case 'accepted':
      return {
        label: 'Accepted',
        class:
          'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
      };
    case 'cancelled':
      return { label: 'Cancelled', class: 'text-muted-foreground bg-muted' };
    case 'expired':
      return { label: 'Expired', class: 'text-muted-foreground bg-muted' };
    default:
      return { label: status, class: 'text-muted-foreground bg-muted' };
  }
}

const roleLabel = (role: string) =>
  role === 'broker_admin' ? 'Admin' : 'Realtor';

// Role pill — small caps, muted bg. Matches the Members + Realtors rows so
// the three pages read as one product.
const rolePillClass =
  'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 bg-muted text-muted-foreground';

export default async function BrokerInvitationsPage() {
  const ctx = await getBrokerContext();
  if (!ctx) redirect('/');

  // Pull seat usage alongside invitations so the forms can render capacity
  // inline (and disable submit when at cap) instead of only reacting to the
  // 402 server response. Parallel for speed.
  const [{ data: invitations }, seatUsage] = await Promise.all([
    supabase
      .from('Invitation')
      .select('*')
      .eq('brokerageId', ctx.brokerage.id)
      .order('createdAt', { ascending: false }),
    getSeatUsage(ctx.brokerage.id),
  ]);

  const invs = (invitations ?? []) as Array<{
    id: string;
    email: string;
    roleToAssign: string;
    status: string;
    expiresAt: string;
    createdAt: string;
  }>;

  const pendingCount = invs.filter((i) => i.status === 'pending').length;

  // Status sentence — quietly names what matters. Pending count when there
  // are open invites, otherwise the total sent.
  const subtitle = (() => {
    if (invs.length === 0)
      return `Nobody invited to ${ctx.brokerage.name} yet.`;
    if (pendingCount > 0) {
      return `${pendingCount} pending · ${invs.length} sent in all.`;
    }
    return `${invs.length} ${invs.length === 1 ? 'invite' : 'invites'} sent. Quiet right now.`;
  })();

  return (
    <div className="space-y-6 max-w-3xl pb-56 md:pb-24">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Invitations.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Bring the team in
        </h1>
        <p className={cn(BODY_MUTED)}>{subtitle}</p>
      </header>

      <InviteCodeCard isOwner={ctx.membership.role === 'broker_owner'} />

      <Card>
        <CardContent className="px-5 py-4 space-y-3">
          <p className="text-sm font-medium">Send an email invite</p>
          <InviteForm
            isOwner={ctx.membership.role === 'broker_owner'}
            seatUsage={seatUsage}
          />
        </CardContent>
      </Card>

      <BulkInviteForm seatUsage={seatUsage} />

      <section className="space-y-3">
        <p className={cn(SECTION_LABEL)}>Sent</p>
        {invs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className="text-sm text-foreground">Nothing sent yet.</p>
            <p className={cn('text-xs mt-1', BODY_MUTED)}>
              Drop an email above and the first invite goes out.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {invs.map((inv) => {
              const status = statusPill(inv.status);
              const isPending = inv.status === 'pending';
              const expiresOn = isPending
                ? new Date(inv.expiresAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : null;
              return (
                <li
                  key={inv.id}
                  className="group/row flex items-center gap-3 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {inv.email}
                      </span>
                      <span className={rolePillClass}>
                        {roleLabel(inv.roleToAssign)}
                      </span>
                      {status && (
                        <span
                          className={cn(
                            'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0',
                            status.class,
                          )}
                        >
                          {status.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      Invited {timeAgo(inv.createdAt)}
                      {expiresOn && (
                        <>
                          <span className="text-muted-foreground/40"> · </span>
                          expires {expiresOn}
                        </>
                      )}
                    </p>
                  </div>
                  {isPending && (
                    <div className="flex items-center gap-0.5 flex-shrink-0 lg:opacity-0 lg:group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                      <RevokeInviteButton invitationId={inv.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
