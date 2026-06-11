/**
 * /chippi/inbox — the merged Drafts + Approvals surface.
 *
 * Drafts and Approvals share one intent: "Chippi paused, waiting on
 * your tap." Drafts = a message awaiting send-off. Approvals = a task
 * awaiting yes/no. Two mechanisms, one realtor action: decide. One
 * surface for "things needing my call" instead of two.
 *
 * No tab strip, no filter chrome — the action verbs distinguish the
 * sections (Send / Edit / Hold for drafts vs. Approve / Reject for
 * approvals).
 *
 * /chippi/drafts and /chippi/approvals both redirect here so bookmarks
 * stay live.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { AgentDraftInbox } from '@/components/agent/agent-draft-inbox';
import { ChippiPageShell } from '@/components/chippi/chippi-page-shell';
import { ApprovalActions } from '../approvals/approval-actions';

export const dynamic = 'force-dynamic';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ApprovalTask {
  id: string;
  spaceId: string;
  title: string;
  goalDescription: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pendingActionLabel(metadata: Record<string, unknown> | null): string {
  if (!metadata) return 'Waiting on your call.';
  const action = metadata['pendingAction'];
  if (typeof action === 'string' && action.trim().length > 0) return action.trim();
  return 'Waiting on your call.';
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ChippiInboxPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  // Just the count — AgentDraftInbox fetches the actual draft data
  // client-side, the same way it does on every other page that mounts it.
  const { count: pendingDraftCount } = await supabase
    .from('AgentDraft')
    .select('*', { count: 'exact', head: true })
    .eq('spaceId', space.id)
    .eq('status', 'pending');

  const { data: tasks } = await supabase
    .from('AgentTask')
    .select('*')
    .eq('spaceId', space.id)
    .eq('status', 'paused')
    .not('metadata->approvalRequired', 'is', null)
    .order('createdAt', { ascending: false })
    .limit(50);

  const approvalList = (tasks ?? []) as ApprovalTask[];
  const draftCount = pendingDraftCount ?? 0;
  const hasDrafts = draftCount > 0;
  const hasApprovals = approvalList.length > 0;
  const pendingCount = draftCount + approvalList.length;

  return (
    <ChippiPageShell
      greeting="Inbox."
      title={pendingCount === 0 ? 'Nothing waiting.' : 'Need your call.'}
    >
      {!hasDrafts && !hasApprovals ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-8 text-center">
          <p className="text-xs text-muted-foreground">
            I&apos;ll bring drafts and decisions here when they need you.
          </p>
        </div>
      ) : (
        <>
          {hasDrafts && <AgentDraftInbox slug={slug} />}

          {hasDrafts && hasApprovals && (
            <div className="border-t border-border/60" />
          )}

          {hasApprovals && (
            <ul className="divide-y divide-border/60">
              {approvalList.map((task) => {
                const goal = task.goalDescription ?? task.title;
                const truncated = goal.length > 100 ? goal.slice(0, 100) + '…' : goal;
                const actionLabel = pendingActionLabel(task.metadata);
                const waitingTime = relativeTime(task.updatedAt ?? task.createdAt);

                return (
                  <li key={task.id} className="py-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5 flex-shrink-0">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
                          )}
                        >
                          Waiting · {waitingTime}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0 space-y-0.5">
                        <p className="text-sm text-foreground leading-snug">{truncated}</p>
                        <p className="text-xs text-muted-foreground">{actionLabel}</p>
                      </div>
                    </div>

                    <ApprovalActions taskId={task.id} slug={slug} />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </ChippiPageShell>
  );
}
