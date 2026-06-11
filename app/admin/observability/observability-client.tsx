'use client';

/**
 * ObservabilityClient — the interactive half of the Observability page.
 *
 * One idea: "Is anything on fire, and what?"
 *
 * Receives server-fetched data (issues + event stats) as props so the
 * initial render is already populated. The "Refresh" button re-fetches
 * via the /api/admin/observability route and updates state in-place.
 *
 * Visual language: matches the admin Overview exactly — hairline-grid
 * stat cells, divide-y issue rows, serif h1 + status-sentence pattern,
 * all typography tokens from lib/typography.ts.
 */

import { useState, useCallback } from 'react';
import { RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  SECTION_LABEL,
  STAT_NUMBER_COMPACT,
  META,
  CAPTION,
  H3,
  BODY_MUTED,
} from '@/lib/typography';
import type { SentryIssue, SentryEventStats } from '@/lib/sentry-api';

// ── Types ──────────────────────────────────────────────────────────────────

interface ObservabilityData {
  issues: SentryIssue[];
  stats: SentryEventStats | null;
  fetchedAt: string;
}

interface ObservabilityClientProps extends ObservabilityData {
  configured: boolean;
}

// ── Level pill ─────────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, string> = {
  fatal:
    'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
  error:
    'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
  warning:
    'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  info: 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15',
  debug:
    'text-muted-foreground bg-muted',
};

function LevelPill({ level }: { level: string }) {
  return (
    <span
      className={cn(
        'inline-flex text-[11px] font-medium rounded-full px-2 py-0.5 flex-shrink-0',
        LEVEL_STYLES[level] ?? LEVEL_STYLES.debug,
      )}
    >
      {level}
    </span>
  );
}

// ── Event volume bars ──────────────────────────────────────────────────────

function EventBars({ stats }: { stats: SentryEventStats | null }) {
  if (!stats || stats.points.length === 0) {
    return (
      <p className={cn(BODY_MUTED, 'text-xs')}>No event data available.</p>
    );
  }

  const maxCount = Math.max(...stats.points.map((p) => p.count), 1);

  return (
    <div className="flex items-end gap-px h-[56px] w-full overflow-hidden rounded-sm">
      {stats.points.map((p) => {
        const heightPct = Math.max((p.count / maxCount) * 100, p.count > 0 ? 6 : 0);
        const label = new Date(p.ts).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        return (
          <div
            key={p.ts}
            title={`${label}: ${p.count.toLocaleString()} events`}
            className="flex-1 min-w-[2px] bg-foreground/20 hover:bg-foreground/50 transition-colors rounded-t-[1px] self-end"
            style={{ height: `${heightPct}%` }}
          />
        );
      })}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function sumCounts(points: SentryEventStats['points'], lastNDays: number): number {
  const cutoff = Date.now() - lastNDays * 86_400_000;
  return points
    .filter((p) => p.ts >= cutoff)
    .reduce((sum, p) => sum + p.count, 0);
}

// ── Main component ─────────────────────────────────────────────────────────

export function ObservabilityClient({
  configured,
  issues: initialIssues,
  stats: initialStats,
  fetchedAt: initialFetchedAt,
}: ObservabilityClientProps) {
  const [issues, setIssues] = useState<SentryIssue[]>(initialIssues);
  const [stats, setStats] = useState<SentryEventStats | null>(initialStats);
  const [fetchedAt, setFetchedAt] = useState(initialFetchedAt);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/observability', {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = (await res.json()) as ObservabilityData;
        setIssues(data.issues);
        setStats(data.stats);
        setFetchedAt(data.fetchedAt);
      }
    } catch {
      // Silently swallow — the stale data is still useful.
    } finally {
      setRefreshing(false);
    }
  }, [refreshing]);

  // ── Not-configured empty state ─────────────────────────────────────────
  if (!configured) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
        <AlertTriangle
          size={20}
          strokeWidth={1.5}
          className="mx-auto mb-3 text-muted-foreground/50"
        />
        <p className="text-sm font-medium text-foreground">
          Sentry is not connected.
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
          Set{' '}
          <code className="font-mono">SENTRY_AUTH_TOKEN</code>,{' '}
          <code className="font-mono">SENTRY_ORG</code>, and{' '}
          <code className="font-mono">SENTRY_PROJECT</code> in your environment
          to enable this view.
        </p>
      </div>
    );
  }

  // ── Computed ───────────────────────────────────────────────────────────
  const unresolvedCount = issues.filter((i) => i.status === 'unresolved').length;
  const fatalOrError = issues.filter(
    (i) => i.level === 'fatal' || i.level === 'error',
  ).length;
  const events24h = stats ? sumCounts(stats.points, 1) : null;
  const events14d = stats ? sumCounts(stats.points, 14) : null;

  return (
    <div className="space-y-8">
      {/* ── Stat cells ─────────────────────────────────────────────────── */}
      <section
        className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
        aria-label="Sentry summary"
      >
        {[
          {
            label: 'Unresolved issues',
            value: unresolvedCount,
            sub: `last 14d`,
            alert: unresolvedCount > 0,
          },
          {
            label: 'Errors & fatals',
            value: fatalOrError,
            sub: `of ${issues.length} issues`,
            alert: fatalOrError > 0,
          },
          {
            label: 'Events (24h)',
            value: events24h !== null ? events24h.toLocaleString() : '—',
            sub: 'received',
            alert: false,
          },
          {
            label: 'Events (14d)',
            value: events14d !== null ? events14d.toLocaleString() : '—',
            sub: 'received',
            alert: false,
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

      {/* ── Event volume chart ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-border/70 bg-card px-5 py-5">
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className={H3}>Event volume</p>
            <p className={cn(CAPTION, 'mt-0.5 mb-4')}>
              Received events per day · last 14 days
            </p>
          </div>
        </div>
        <EventBars stats={stats} />
        {stats && stats.points.length > 0 && (
          <div className="flex justify-between mt-1.5">
            <span className={META}>
              {new Date(stats.points[0].ts).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            <span className={META}>
              {new Date(
                stats.points[stats.points.length - 1].ts,
              ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
        )}
      </div>

      {/* ── Issues list ─────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className={H3}>Open issues</p>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            aria-label="Refresh observability data"
            className={cn(
              'flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium',
              'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
              'transition-colors duration-150 disabled:opacity-50',
            )}
          >
            <RefreshCw
              size={12}
              strokeWidth={1.75}
              className={cn('flex-shrink-0', refreshing && 'animate-spin')}
            />
            <span>{refreshing ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>

        {issues.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className="text-sm text-foreground">No open issues.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Quiet — nothing in flight.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card overflow-hidden">
            {issues.map((issue) => (
              <li key={issue.id}>
                <a
                  href={issue.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 px-4 py-3 hover:bg-foreground/[0.04] transition-colors duration-150 group"
                >
                  {/* Level pill */}
                  <div className="flex-shrink-0 pt-0.5">
                    <LevelPill level={issue.level} />
                  </div>

                  {/* Title + culprit */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate text-foreground leading-snug">
                      {issue.title}
                    </p>
                    {issue.culprit && (
                      <p className={cn(CAPTION, 'truncate mt-0.5')}>
                        {issue.culprit}
                      </p>
                    )}
                  </div>

                  {/* Meta: count · users · last seen */}
                  <div className="flex-shrink-0 flex flex-col items-end gap-0.5 min-w-[80px]">
                    <span className={cn(META, 'text-foreground tabular-nums')}>
                      {Number(issue.count).toLocaleString()}
                      {' '}
                      <span className="text-muted-foreground">events</span>
                    </span>
                    {issue.userCount > 0 && (
                      <span className={META}>
                        {issue.userCount.toLocaleString()} users
                      </span>
                    )}
                    <span className={META}>{timeAgo(issue.lastSeen)}</span>
                  </div>

                  {/* External link icon */}
                  <ExternalLink
                    size={12}
                    strokeWidth={1.5}
                    className="flex-shrink-0 self-center text-muted-foreground/30 group-hover:text-muted-foreground transition-colors mt-0.5"
                  />
                </a>
              </li>
            ))}
          </ul>
        )}

        {/* Footer timestamp */}
        <p className={cn(META, 'text-right')}>
          Fetched{' '}
          {new Date(fetchedAt).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })}
        </p>
      </div>
    </div>
  );
}
