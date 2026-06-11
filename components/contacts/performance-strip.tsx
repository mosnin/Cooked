import {
  avgTimeToCloseDays,
  conversionRate,
  stageBottlenecks,
  type DealMetricRow,
  type StageMetricRow,
} from '@/lib/deal-metrics';
import { SECTION_LABEL } from '@/lib/typography';

/**
 * Realtor performance strip — the three pipeline numbers that move output:
 * average time-to-close, conversion rate, and where deals stall (the current
 * bottleneck stage). Pure presentation over already-fetched rows; the page
 * owns the (read-only) query and hands the math to lib/deal-metrics.ts.
 *
 * Hairline-divider stat grid per STYLESHEET. Focal numbers wear serif Times
 * (the brand's scarce flourish). When a metric has no data, the cell renders
 * a calm fact rather than a misleading 0 — every metric function returns null
 * in that case, by design.
 */
export function PerformanceStrip({
  deals,
  stages,
  now,
}: {
  deals: DealMetricRow[];
  stages: StageMetricRow[];
  now?: Date;
}) {
  const avgDays = avgTimeToCloseDays(deals);
  const conversion = conversionRate(deals);
  const bottleneck = stageBottlenecks(deals, stages, now).worstStage;

  return (
    <section
      aria-label="Pipeline performance"
      className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/60 sm:grid-cols-3"
    >
      <Cell label="Avg time to close">
        {avgDays === null ? (
          <Empty>not enough closed deals yet.</Empty>
        ) : (
          <Stat suffix={Math.round(avgDays) === 1 ? 'day' : 'days'}>
            {Math.round(avgDays)}
          </Stat>
        )}
      </Cell>

      <Cell label="Conversion rate">
        {conversion === null ? (
          <Empty>nothing has closed yet.</Empty>
        ) : (
          <Stat suffix="won">{Math.round(conversion * 100)}%</Stat>
        )}
      </Cell>

      <Cell label="Biggest bottleneck">
        {bottleneck === null ? (
          <Empty>no active deals to stall.</Empty>
        ) : (
          <div className="space-y-1">
            <p
              className="truncate text-[21px] leading-tight tracking-tight text-foreground"
              style={{ fontFamily: 'var(--font-title)' }}
              title={bottleneck.stageName}
            >
              {bottleneck.stageName}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {bottleneck.count} {bottleneck.count === 1 ? 'deal' : 'deals'} ·{' '}
              {Math.round(bottleneck.avgAgeDays)} day avg
            </p>
          </div>
        )}
      </Cell>
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-background px-4 py-4">
      <p className={SECTION_LABEL}>{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/** Focal stat number — serif Times, the type scale&rsquo;s loud note. */
function Stat({ children, suffix }: { children: React.ReactNode; suffix?: string }) {
  return (
    <p className="flex items-baseline gap-1.5">
      <span
        className="text-3xl tracking-tight text-foreground tabular-nums"
        style={{ fontFamily: 'var(--font-title)' }}
      >
        {children}
      </span>
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
