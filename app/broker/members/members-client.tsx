'use client';

import { useState, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/formatting';
import { BODY_MUTED } from '@/lib/typography';
import { RemoveMemberButton } from '@/components/broker/remove-member-button';
import { ChangeRoleButton } from '@/components/broker/change-role-button';
import { OffboardMemberDialog } from '@/components/broker/offboard-member-dialog';

interface Member {
  id: string;
  role: string;
  createdAt: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  userOnboard: boolean;
  spaceSlug: string | null;
}

const roleLabel = (role: string) =>
  role === 'broker_owner' ? 'Owner' : role === 'broker_admin' ? 'Admin' : 'Realtor';

// Role pill — small caps, muted background. Matches the contacts page's
// stage pill vocabulary so the team feels like one product. Role is a
// label, not a status — no tone tints.
const rolePillClass =
  'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 bg-muted text-muted-foreground';

export function MembersClient({
  members,
  brokerageName,
  currentUserRole,
}: {
  members: Member[];
  brokerageName: string;
  currentUserRole: string;
}) {
  const [search, setSearch] = useState('');
  const [offboardTargetId, setOffboardTargetId] = useState<string | null>(null);

  const activeCount = members.filter((m) => m.userOnboard).length;
  const pendingCount = members.length - activeCount;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.userName ?? '').toLowerCase().includes(q) ||
        (m.userEmail ?? '').toLowerCase().includes(q),
    );
  }, [members, search]);

  // One-sentence status read of the team. Loud fact wins. Brokerage name
  // anchors the empty case so the page still reads as "your team."
  const subtitle = (() => {
    if (members.length === 0) return `Nobody on the team at ${brokerageName} yet.`;
    if (pendingCount > 0) {
      return `${activeCount} active · ${pendingCount} pending invite${pendingCount === 1 ? '' : 's'}.`;
    }
    return `${activeCount} ${activeCount === 1 ? 'person' : 'people'} on the team.`;
  })();

  return (
    <div className="space-y-6 max-w-3xl pb-56 md:pb-24">
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Members.</p>
        <h1
          className="text-3xl tracking-tight text-foreground"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          Who&apos;s on the team
        </h1>
        <p className={BODY_MUTED}>{subtitle}</p>
      </header>

      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
          <p className="text-sm text-foreground">Nobody here yet.</p>
          <p className={cn('text-xs mt-1', BODY_MUTED)}>
            <a
              href="/broker/invitations"
              className="text-foreground underline underline-offset-2 hover:no-underline"
            >
              Send the first invite
            </a>{' '}
            to get someone on the team.
          </p>
        </div>
      ) : (
        <>
          {/* Search — the only chrome. Role tabs were stacked state-cuts
              competing with the role pill on each row. One filter wins. */}
          <div className="relative w-full sm:w-64">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members…"
              className="h-9 w-full rounded-md border border-border/70 bg-background pl-8 pr-7 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">
              Nobody matches.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((m) => {
                const canManage =
                  m.role !== 'broker_owner' &&
                  (currentUserRole === 'broker_owner' ||
                    (currentUserRole === 'broker_admin' && m.role === 'realtor_member'));
                const display = m.userName ?? m.userEmail ?? 'Unnamed';
                return (
                  <li
                    key={m.id}
                    className="group/row flex items-center gap-3 py-3"
                  >
                    <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
                      {getInitials(display)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="text-sm font-medium text-foreground truncate">
                          {display}
                        </span>
                        <span className={rolePillClass}>{roleLabel(m.role)}</span>
                        {!m.userOnboard && (
                          <span className="inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15">
                            Pending
                          </span>
                        )}
                      </div>
                      {m.userName && m.userEmail && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {m.userEmail}
                        </p>
                      )}
                    </div>
                    {canManage ? (
                      <div className="flex items-center gap-0.5 flex-shrink-0 lg:opacity-0 lg:group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity">
                        <ChangeRoleButton
                          membershipId={m.id}
                          currentRole={m.role}
                          memberName={display}
                        />
                        <button
                          type="button"
                          onClick={() => setOffboardTargetId(m.id)}
                          aria-label={`Offboard ${display}`}
                          className="h-7 px-2 inline-flex items-center rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          Offboard
                        </button>
                        <RemoveMemberButton
                          membershipId={m.id}
                          memberName={display}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {(() => {
        const target = members.find((m) => m.id === offboardTargetId) ?? null;
        if (!target) return null;
        const otherMembers = members
          .filter((m) => m.id !== target.id)
          .map((m) => ({
            id: m.id,
            name: m.userName,
            email: m.userEmail ?? '',
            userStatus: m.userOnboard ? 'active' : 'pending',
          }));
        return (
          <OffboardMemberDialog
            member={{
              id: target.id,
              userId: target.userId,
              name: target.userName,
              email: target.userEmail ?? '',
              role: target.role,
            }}
            otherMembers={otherMembers}
            open={offboardTargetId === target.id}
            onOpenChange={(o) => {
              if (!o) setOffboardTargetId(null);
            }}
            onDone={() => {
              setOffboardTargetId(null);
              // Fall back to a hard refresh — matches how RemoveMemberButton /
              // ChangeRoleButton refresh the list after server mutations.
              window.location.reload();
            }}
          />
        );
      })()}
    </div>
  );
}
