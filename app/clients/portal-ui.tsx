/**
 * Shared, presentational portal pieces used across dashboard + detail. Pure
 * server-safe components (no client hooks) so they can render in RSC.
 */
import { cn } from '@/lib/utils';

/* ─── Status pill ─────────────────────────────────────────────────────────── */

const STATUS_TONE: Record<string, string> = {
  // application statuses
  received: 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15',
  under_review: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  needs_info: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  tour_scheduled: 'text-violet-700 bg-violet-50 dark:text-violet-400 dark:bg-violet-500/15',
  approved: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
  waitlisted: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  declined: 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
  // tour statuses
  scheduled: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  confirmed: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
  completed: 'text-muted-foreground bg-muted',
  cancelled: 'text-muted-foreground bg-muted',
};

const STATUS_LABEL: Record<string, string> = {
  received: 'Received',
  under_review: 'Under review',
  needs_info: 'Needs info',
  tour_scheduled: 'Tour scheduled',
  approved: 'Approved',
  waitlisted: 'Waitlisted',
  declined: 'Declined',
  scheduled: 'Scheduled',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function StatusPill({ status }: { status: string }) {
  const key = status.toLowerCase();
  const tone = STATUS_TONE[key] ?? 'text-muted-foreground bg-muted';
  const label = STATUS_LABEL[key] ?? status.replace(/_/g, ' ');
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        tone,
      )}
    >
      {label}
    </span>
  );
}

/* ─── Empty state ─────────────────────────────────────────────────────────── */

export function PortalEmptyState({
  headline,
  whatsNext,
}: {
  headline: string;
  whatsNext: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
      <p className="text-sm text-foreground">{headline}</p>
      <p className="mt-1 text-xs text-muted-foreground">{whatsNext}</p>
    </div>
  );
}

/* ─── Date formatting ─────────────────────────────────────────────────────── */

export function formatTourDate(iso: string | null): string {
  if (!iso) return 'Time to be set';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
