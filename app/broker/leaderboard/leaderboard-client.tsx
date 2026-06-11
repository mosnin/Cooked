'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { RealtorStats } from './page';
import { Trophy, Zap, Flame, Medal } from 'lucide-react';
import { SECTION_LABEL, TITLE_FONT, BODY_MUTED } from '@/lib/typography';

type SortMetric = 'dealsClosed' | 'pipelineValue' | 'totalLeads' | 'conversionRate';

const metricLabels: Record<SortMetric, string> = {
  dealsClosed: 'Deals',
  pipelineValue: 'Pipeline value',
  totalLeads: 'Leads',
  conversionRate: 'Conversion',
};

function formatValue(metric: SortMetric, value: number): string {
  if (metric === 'pipelineValue') {
    return value >= 1000
      ? `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
      : `$${value.toLocaleString()}`;
  }
  if (metric === 'conversionRate') return `${value}%`;
  return value.toLocaleString();
}

function formatPipeline(value: number): string {
  return value >= 1000
    ? `$${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
    : `$${value.toLocaleString()}`;
}

function BadgeChip({ badge }: { badge: string }) {
  const config: Record<string, { icon: typeof Trophy; tone: string }> = {
    'Top Closer': { icon: Trophy, tone: 'text-amber-700 dark:text-amber-400' },
    'Fast Responder': { icon: Zap, tone: 'text-blue-700 dark:text-blue-400' },
    'Hot Streak': { icon: Flame, tone: 'text-rose-700 dark:text-rose-400' },
  };
  const c = config[badge] ?? { icon: Medal, tone: 'text-muted-foreground' };
  const Icon = c.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium',
        c.tone,
      )}
    >
      <Icon size={9} aria-hidden />
      {badge}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((n) => n.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="w-9 h-9 rounded-full bg-foreground/[0.06] flex items-center justify-center font-semibold text-xs text-foreground flex-shrink-0">
      {initials}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function LeaderboardClient({ initialStats }: { initialStats: RealtorStats[] }) {
  const [metric, setMetric] = useState<SortMetric>('dealsClosed');

  const sorted = useMemo(
    () => [...initialStats].sort((a, b) => b[metric] - a[metric]),
    [initialStats, metric],
  );

  return (
    <div className="space-y-6">
      {/* Sort control — paper-flat row, no card chrome. */}
      <div className="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-border/60">
        <p className={SECTION_LABEL}>Ranked by</p>
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value as SortMetric)}
          className="text-sm border border-border/70 rounded-md px-2 h-8 bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label="Sort metric"
        >
          {(Object.entries(metricLabels) as [SortMetric, string][]).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Ranking — divide-y rows. Rank · avatar · name · metric · trend.    */}
      {/* No pedestals, no left-border gradients. Position is the loud note. */}
      {sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-6 text-center">
          <p className={cn(BODY_MUTED, 'text-[13px]')}>
            Nothing to rank yet — once realtors close a deal I&apos;ll start the leaderboard.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {sorted.map((agent, idx) => {
            const rank = idx + 1;
            return (
              <li key={agent.userId} className="flex items-center gap-3 py-4">
                <span
                  className="w-8 text-right tabular-nums text-foreground"
                  style={TITLE_FONT}
                  aria-label={`Rank ${rank}`}
                >
                  <span className="text-[21px] leading-none tracking-tight">{rank}</span>
                </span>
                <Avatar name={agent.name} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{agent.name}</p>
                  {agent.badges.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {agent.badges.map((b) => (
                        <BadgeChip key={b} badge={b} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="hidden sm:flex flex-col items-end flex-shrink-0">
                  <p
                    className="text-[21px] leading-tight tracking-tight tabular-nums text-foreground"
                    style={TITLE_FONT}
                  >
                    {formatValue(metric, agent[metric])}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{metricLabels[metric].toLowerCase()}</p>
                </div>
                <div className="sm:hidden text-right">
                  <p
                    className="text-base leading-tight tabular-nums text-foreground"
                    style={TITLE_FONT}
                  >
                    {formatValue(metric, agent[metric])}
                  </p>
                </div>
                {/* Secondary metric on wide screens — pipeline as the steady cross-check. */}
                <div className="hidden lg:flex flex-col items-end flex-shrink-0 w-28 text-right">
                  <p className="text-sm font-medium tabular-nums text-foreground">
                    {formatPipeline(agent.pipelineValue)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">pipeline</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
