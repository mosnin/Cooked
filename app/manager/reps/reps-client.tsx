'use client';

import { useState, useMemo } from 'react';
import { Search, X, Check, BookOpen, AlertTriangle, Star } from 'lucide-react';
import Link from 'next/link';
import { formatCompact, getInitials } from '@/lib/formatting';
import { cn } from '@/lib/utils';
import { KOALA_PILL } from '@/lib/typography';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface RepRow {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
  onboard: boolean;
  role: string;
  spaceSlug: string | null;
  /** Total people on file (excludes application-link tags). */
  people: number;
  /** Active deal count. */
  deals: number;
  /** Sum of active deal values. */
  pipeline: number;
  /** Deals closed (won). */
  dealsWon: number;
  /** Contacts tagged new-lead (open lead load). */
  openLeads: number;
  /** Manager-assigned leads with no first contact (un-worked). */
  unworked: number;
  /** SLA-nudged + SLA-escalated contacts combined (speed-to-lead misses). */
  slaMisses: number;
  /** Avg first-response hours over the last 7 days, null when no samples. */
  responseAvgHours: number | null;
  /** Band relative to team median (mirrors agent/tools/manager/performance.py). */
  responseBand: 'fast' | 'on_pace' | 'slow' | 'no_data';
  /** Derived accountability tier. */
  health: 'needs-attention' | 'on-track' | 'top-performer' | 'pending';
}

type SortKey = 'health' | 'pipeline' | 'deals' | 'people' | 'name';

const SORT_LABELS: Record<SortKey, string> = {
  health:   'Attention first',
  pipeline: 'Pipeline',
  deals:    'Deals',
  people:   'People',
  name:     'Name A–Z',
};

// Health sort order — needs-attention surfaces first so the manager acts.
const HEALTH_ORDER: Record<RepRow['health'], number> = {
  'needs-attention': 0,
  'on-track':        1,
  'top-performer':   2,
  'pending':         3,
};

const roleLabel = (role: string) =>
  role === 'manager_owner' ? 'Owner' : role === 'manager_admin' ? 'Admin' : 'Rep';

// Role pill — small caps, muted bg.
const rolePillClass =
  'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0 bg-muted text-muted-foreground';

// ── Health chip ──────────────────────────────────────────────────────────────
// Calm, not loud. Amber for attention (not rose — this is coaching, not error).
// Emerald for top performer. Muted for on-track and pending.
function HealthChip({ health }: { health: RepRow['health'] }) {
  const base =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold flex-shrink-0';

  if (health === 'needs-attention') {
    return (
      <span
        className={cn(
          base,
          'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
        )}
      >
        <AlertTriangle size={9} aria-hidden />
        Needs attention
      </span>
    );
  }

  if (health === 'top-performer') {
    return (
      <span
        className={cn(
          base,
          'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
        )}
      >
        <Star size={9} aria-hidden />
        Top performer
      </span>
    );
  }

  if (health === 'pending') {
    return (
      <span className={cn(base, 'bg-muted text-muted-foreground')}>
        Pending
      </span>
    );
  }

  // on-track — intentionally quiet; no icon, no color
  return (
    <span className={cn(base, 'bg-muted text-muted-foreground')}>
      <Check size={9} aria-hidden />
      On track
    </span>
  );
}

// ── Inline response-time pill ────────────────────────────────────────────────
// Only shown when there is data. Amber for slow (coaching cue), emerald for
// fast, muted for on-pace. Rose is reserved for destructive actions per
// STYLESHEET.md — slow response is a nudge, not a failure state.
function ResponseTimePill({
  avgHours,
  band,
}: {
  avgHours: number | null;
  band: RepRow['responseBand'];
}) {
  const baseClass =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums flex-shrink-0';

  if (band === 'no_data') return null;

  const hours = avgHours ?? 0;
  const label = hours < 1 ? '<1h' : `${Math.round(hours)}h`;

  if (band === 'fast') {
    return (
      <span
        className={cn(
          baseClass,
          'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
        )}
      >
        <Check size={9} aria-hidden />
        {label}
      </span>
    );
  }

  if (band === 'slow') {
    return (
      <span
        className={cn(
          baseClass,
          'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
        )}
      >
        {label} avg
      </span>
    );
  }

  return (
    <span className={cn(baseClass, 'bg-muted text-muted-foreground')}>{label}</span>
  );
}

// ── Health summary sentence ──────────────────────────────────────────────────
// 2-3 numbers that justify the health tier. Quiet and scannable.
function HealthNumbers({ r }: { r: RepRow }) {
  if (!r.onboard) return null;

  const parts: string[] = [];

  if (r.unworked > 0) {
    parts.push(`${r.unworked} un-worked ${r.unworked === 1 ? 'lead' : 'leads'}`);
  }
  if (r.slaMisses > 0) {
    parts.push(`${r.slaMisses} SLA ${r.slaMisses === 1 ? 'miss' : 'misses'}`);
  }
  if (r.openLeads > 0 && parts.length < 2) {
    parts.push(`${r.openLeads} open`);
  }
  if (r.pipeline > 0 && parts.length < 2) {
    parts.push(`${formatCompact(r.pipeline)} pipeline`);
  }
  if (r.deals > 0 && parts.length < 2) {
    parts.push(`${r.deals} ${r.deals === 1 ? 'deal' : 'deals'}`);
  }
  if (r.dealsWon > 0 && parts.length < 2) {
    parts.push(`${r.dealsWon} won`);
  }
  if (parts.length === 0) {
    parts.push(`${r.people} ${r.people === 1 ? 'person' : 'people'}`);
  }

  return (
    <p className="text-xs text-muted-foreground truncate mt-0.5">
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="text-muted-foreground/40"> · </span>
          )}
          {p}
        </span>
      ))}
    </p>
  );
}

// ── Coach prompt ─────────────────────────────────────────────────────────────
// One-line health summary for the Koala prefill. Calm, factual, no em dashes.
function coachHealthSummary(r: RepRow): string {
  if (!r.onboard) return 'has not joined yet';

  const signals: string[] = [];
  if (r.unworked > 0)  signals.push(`${r.unworked} un-worked ${r.unworked === 1 ? 'lead' : 'leads'}`);
  if (r.slaMisses > 0) signals.push(`${r.slaMisses} speed-to-lead ${r.slaMisses === 1 ? 'miss' : 'misses'}`);
  if (r.openLeads > 0) signals.push(`${r.openLeads} open ${r.openLeads === 1 ? 'lead' : 'leads'}`);
  if (r.dealsWon > 0)  signals.push(`${r.dealsWon} ${r.dealsWon === 1 ? 'deal' : 'deals'} won`);
  if (r.pipeline > 0)  signals.push(`${formatCompact(r.pipeline)} pipeline`);
  if (r.deals > 0)     signals.push(`${r.deals} active ${r.deals === 1 ? 'deal' : 'deals'}`);

  if (signals.length === 0) return 'quiet, nothing notable yet';
  return signals.join(', ');
}

function buildCoachHref(r: RepRow): string {
  const displayName = r.name ?? r.email;
  const summary = coachHealthSummary(r);
  const prompt = `Help me coach ${displayName}. Here's what I'm seeing: ${summary}. Draft a 1:1 agenda and a nudge I can send.`;
  return `/manager?prompt=${encodeURIComponent(prompt)}`;
}

export function RepsClient({ reps }: { reps: RepRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('health');
  const [searchQuery, setSearchQuery] = useState('');

  const sorted = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = q
      ? reps.filter(
          (r) =>
            (r.name ?? '').toLowerCase().includes(q) ||
            r.email.toLowerCase().includes(q),
        )
      : reps;

    return [...filtered].sort((a, b) => {
      if (sortKey === 'health') {
        return HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
      }
      if (sortKey === 'name') {
        const va = (a.name || a.email).toLowerCase();
        const vb = (b.name || b.email).toLowerCase();
        return va.localeCompare(vb);
      }
      const va = a[sortKey] as number;
      const vb = b[sortKey] as number;
      return vb - va;
    });
  }, [reps, sortKey, searchQuery]);

  return (
    <div className="space-y-3">
      {/* Search + sort toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 sm:flex-initial min-w-[160px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search reps..."
            className="h-9 w-full sm:w-64 rounded-md border border-border/70 bg-background pl-8 pr-7 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors ml-auto"
            >
              <span className="text-muted-foreground">Sort:</span>
              {SORT_LABELS[sortKey]}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <DropdownMenuItem
                key={key}
                onSelect={() => setSortKey(key)}
                className={cn('text-xs', sortKey === key && 'font-semibold')}
              >
                {SORT_LABELS[key]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          Nobody matches.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {sorted.map((r) => {
            const displayName = r.name ?? r.email;
            const coachHref = buildCoachHref(r);

            return (
              <li
                key={r.membershipId}
                className="group/row flex items-center gap-3 py-3"
              >
                {/* Main row link — opens the detail page */}
                <Link
                  href={`/manager/reps/${r.userId}`}
                  className="flex items-center gap-3 min-w-0 flex-1 -mx-2 px-2 py-0.5 rounded-md hover:bg-foreground/[0.04] transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
                    {getInitials(displayName)}
                  </div>

                  {/* Name + chips + numbers */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">
                        {displayName}
                      </span>
                      <span className={rolePillClass}>{roleLabel(r.role)}</span>
                      <HealthChip health={r.health} />
                      <ResponseTimePill
                        avgHours={r.responseAvgHours}
                        band={r.responseBand}
                      />
                    </div>
                    <HealthNumbers r={r} />
                  </div>
                </Link>

                {/* Coach action — always visible on mobile, hover-revealed on lg+ */}
                <Link
                  href={coachHref}
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    KOALA_PILL,
                    // Compact pill sizing for the row context
                    'h-7 px-3 text-[11px] flex-shrink-0',
                    // Reveal behavior
                    'opacity-100 lg:opacity-0 lg:group-hover/row:opacity-100',
                    'focus-visible:opacity-100',
                  )}
                  aria-label={`Coach ${displayName} with Koala`}
                  title={`Draft a 1:1 coaching nudge for ${displayName}`}
                >
                  <BookOpen size={12} aria-hidden />
                  Coach
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
