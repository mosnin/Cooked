'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  CAPTION,
  SECTION_LABEL,
  SECTION_RHYTHM,
  PRIMARY_PILL,
  GHOST_PILL,
} from '@/lib/typography';
import type { ReviewRow, ReviewStatus } from '../reviews-client';
import { formatRelative } from '../reviews-client';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReviewComment {
  id: string;
  authorUser: {
    id: string;
    name: string | null;
  };
  body: string;
  createdAt: string;
}

export type ReviewDetail = ReviewRow & {
  resolvedByUser: { id: string; name: string | null } | null;
};

interface Props {
  review: ReviewDetail;
  comments: ReviewComment[];
  role: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function initialsOf(name: string | null, fallback = '?'): string {
  const src = (name && name.trim()) || fallback;
  return (
    src
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

const statusBadgeClass = (status: ReviewStatus): string => {
  switch (status) {
    case 'open':
      return 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15';
    case 'approved':
      return 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15';
    case 'closed':
    default:
      return 'text-muted-foreground bg-muted';
  }
};

const statusLabel = (status: ReviewStatus): string =>
  status === 'open' ? 'Open' : status === 'approved' ? 'Approved' : 'Closed';

function absoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Component ────────────────────────────────────────────────────────────────

const MAX_COMMENT_LEN = 2000;

export function ReviewDetailClient({
  review: initialReview,
  comments: initialComments,
  role,
}: Props) {
  const [review, setReview] = useState<ReviewDetail>(initialReview);
  const [comments, setComments] = useState<ReviewComment[]>(initialComments);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [resolvedNote, setResolvedNote] = useState('');
  const [pendingAction, setPendingAction] = useState<null | 'approved' | 'closed'>(null);
  const [noteOpenFor, setNoteOpenFor] = useState<null | 'approved' | 'closed'>(null);

  const canResolve = role === 'broker_owner' || role === 'broker_admin';
  const isResolved = review.status !== 'open';

  const dealHref =
    review.deal.spaceSlug && review.deal.id
      ? `/s/${review.deal.spaceSlug}/deals/${review.deal.id}`
      : null;

  // Submit a new comment — optimistically append on success.
  const submitComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    if (body.length > MAX_COMMENT_LEN) {
      toast.error(`Comment is too long (max ${MAX_COMMENT_LEN} characters).`);
      return;
    }
    setPostingComment(true);
    try {
      const res = await fetch(`/api/broker/reviews/${review.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`Failed to post comment (${res.status})`);
      const created = (await res.json()) as ReviewComment;
      setComments((prev) => [...prev, created]);
      setCommentBody('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to post comment.';
      toast.error(msg);
    } finally {
      setPostingComment(false);
    }
  };

  // Approve or close. Optional resolvedNote carries the broker's reasoning.
  const submitResolution = async (status: 'approved' | 'closed') => {
    setPendingAction(status);
    try {
      const payload: { status: 'approved' | 'closed'; resolvedNote?: string } = { status };
      const trimmed = resolvedNote.trim();
      if (trimmed) payload.resolvedNote = trimmed;

      const res = await fetch(`/api/broker/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Failed to update review (${res.status})`);
      const updated = (await res.json()) as ReviewDetail;
      setReview((prev) => ({
        ...prev,
        ...updated,
        deal: updated.deal ?? prev.deal,
        requestingUser: updated.requestingUser ?? prev.requestingUser,
        resolvedByUser: updated.resolvedByUser ?? prev.resolvedByUser,
      }));
      setNoteOpenFor(null);
      setResolvedNote('');
      toast.success(status === 'approved' ? 'Review approved.' : 'Review closed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update review.';
      toast.error(msg);
    } finally {
      setPendingAction(null);
    }
  };

  const agentName =
    review.requestingUser.name ?? review.requestingUser.email ?? 'Unknown agent';
  const resolvedByName = review.resolvedByUser?.name ?? 'a broker';

  return (
    <div className={cn('max-w-3xl mx-auto', SECTION_RHYTHM, 'pb-56 md:pb-24')}>
      {/* Breadcrumb */}
      <div>
        <Link
          href="/broker/reviews"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={13} />
          All reviews
        </Link>
      </div>

      {/* Header — Chippi vocabulary: muted greeting, serif h1, status line. */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Review.</p>
        {dealHref ? (
          <Link
            href={dealHref}
            className="block group"
          >
            <h1
              className={cn(H1, 'group-hover:underline underline-offset-2 decoration-foreground/30')}
              style={TITLE_FONT}
            >
              {review.deal.title ?? 'Untitled deal'}
            </h1>
          </Link>
        ) : (
          <h1 className={H1} style={TITLE_FONT}>
            {review.deal.title ?? 'Untitled deal'}
          </h1>
        )}
        <p className={BODY_MUTED}>
          Flagged by <span className="font-medium text-foreground">{agentName}</span>{' '}
          <span className="text-[11px] text-muted-foreground">· {absoluteDate(review.createdAt)}</span>
          {' '}
          <span
            className={cn(
              'inline-flex text-xs font-medium rounded-full px-2.5 py-0.5 ml-1',
              statusBadgeClass(review.status),
            )}
          >
            {statusLabel(review.status)}
          </span>
        </p>
      </header>

      {/* Reason */}
      <section className="space-y-3">
        <p className={SECTION_LABEL}>Why it&apos;s flagged</p>
        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
          <p className="text-sm whitespace-pre-wrap break-words">{review.reason}</p>
        </div>
      </section>

      {/* Resolution context (when already resolved) */}
      {isResolved && (
        <section className="space-y-3 pt-6 border-t border-border/60">
          <p className={SECTION_LABEL}>
            {review.status === 'approved' ? 'Approved' : 'Closed'}
          </p>
          <p className={BODY_MUTED}>
            by <span className="font-medium text-foreground">{resolvedByName}</span>
            {review.resolvedAt && <> · {formatRelative(review.resolvedAt)}</>}
          </p>
          {review.resolvedNote && (
            <p className="text-sm whitespace-pre-wrap break-words">{review.resolvedNote}</p>
          )}
        </section>
      )}

      {/* Comment thread */}
      <section className="space-y-3 pt-6 border-t border-border/60">
        <p className={SECTION_LABEL}>Comments</p>
        {comments.length === 0 ? (
          <p className={CAPTION}>No comments yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {comments.map((c) => {
              const authorName = c.authorUser.name ?? 'Unknown';
              const ci = initialsOf(c.authorUser.name);
              return (
                <li key={c.id} className="flex items-start gap-3 py-3">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[11px] font-semibold text-muted-foreground flex-shrink-0">
                    {ci}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{authorName}</p>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatRelative(c.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Composer */}
        <div className="space-y-2 pt-2">
          <Textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value.slice(0, MAX_COMMENT_LEN))}
            placeholder="Add a comment…"
            maxLength={MAX_COMMENT_LEN}
            aria-label="New comment"
          />
          <div className="flex items-center justify-between">
            <span className={cn(CAPTION, 'tabular-nums')}>
              {commentBody.length}/{MAX_COMMENT_LEN}
            </span>
            <button
              type="button"
              onClick={submitComment}
              disabled={postingComment || commentBody.trim().length === 0}
              className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
            >
              {postingComment && <Loader2 size={13} className="animate-spin" />}
              Add comment
            </button>
          </div>
        </div>
      </section>

      {/* Resolution actions — only broker_owner / broker_admin, only while open */}
      {canResolve && !isResolved && (
        <section className="space-y-3 pt-6 border-t border-border/60">
          <p className={SECTION_LABEL}>Resolve this</p>

          {noteOpenFor && (
            <Textarea
              value={resolvedNote}
              onChange={(e) => setResolvedNote(e.target.value.slice(0, MAX_COMMENT_LEN))}
              placeholder={
                noteOpenFor === 'approved'
                  ? 'Optional — a note explaining your approval.'
                  : 'Optional — a note explaining why you&apos;re closing this.'
              }
              maxLength={MAX_COMMENT_LEN}
              aria-label="Resolution note"
            />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (noteOpenFor === 'approved') {
                  submitResolution('approved');
                } else {
                  setNoteOpenFor('approved');
                }
              }}
              disabled={pendingAction !== null}
              aria-label="Approve review"
              className={cn(PRIMARY_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
            >
              {pendingAction === 'approved' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              {noteOpenFor === 'approved' ? 'Confirm approve' : 'Approve'}
            </button>

            <button
              type="button"
              onClick={() => {
                if (noteOpenFor === 'closed') {
                  submitResolution('closed');
                } else {
                  setNoteOpenFor('closed');
                }
              }}
              disabled={pendingAction !== null}
              aria-label="Close review without action"
              className={cn(GHOST_PILL, 'disabled:opacity-60 disabled:cursor-not-allowed')}
            >
              {pendingAction === 'closed' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <XCircle size={13} />
              )}
              {noteOpenFor === 'closed' ? 'Confirm close' : 'Close without action'}
            </button>

            {noteOpenFor && (
              <button
                type="button"
                onClick={() => {
                  setNoteOpenFor(null);
                  setResolvedNote('');
                }}
                disabled={pendingAction !== null}
                className={cn(GHOST_PILL, 'disabled:opacity-60')}
              >
                Cancel
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
