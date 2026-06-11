/**
 * Pure broker/realtor performance metrics over Deal rows.
 *
 * These functions take already-fetched deal rows (no DB calls, no I/O) and
 * compute the three foundational pipeline metrics:
 *   - average time-to-close (won deals)
 *   - conversion rate (won vs lost)
 *   - per-stage bottlenecks (where active deals stall)
 *
 * Keeping them pure means the same logic backs the forecast page, a realtor
 * profile, and a Chippi tool without any of them owning a query. Callers fetch
 * the rows; these functions do the math.
 *
 * Timestamps (closedAt, stageChangedAt) are maintained by the deal write paths
 * and backfilled in supabase/migrations/20260614000000_deal_close_metrics.sql.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Terminal deal statuses. */
export type DealStatus = 'active' | 'won' | 'lost' | 'on_hold';

/**
 * Minimal shape these metrics need from a Deal row. A superset (the full Deal
 * record) satisfies it too, so callers can pass rows straight from Supabase.
 * Timestamps are ISO strings (as returned by PostgREST) or Date; null when the
 * column was never stamped.
 */
export interface DealMetricRow {
  id: string;
  status: DealStatus;
  stageId: string;
  createdAt: string | Date;
  closedAt?: string | Date | null;
  stageChangedAt?: string | Date | null;
}

/** Minimal stage shape: an id and a human label for reporting. */
export interface StageMetricRow {
  id: string;
  name: string;
}

/** Parse an ISO string or Date to epoch ms, or null if absent/invalid. */
function toMs(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Average time-to-close, in days, over WON deals.
 *
 * Mean of (closedAt - createdAt) across won deals that have a usable closedAt
 * and createdAt. Deals without closedAt are ignored (not counted as zero).
 * Returns null when there are no qualifying won deals — there is no meaningful
 * average to report, and the caller should render that as "no data" rather than
 * a misleading 0.
 */
export function avgTimeToCloseDays(deals: DealMetricRow[]): number | null {
  let total = 0;
  let count = 0;
  for (const deal of deals) {
    if (deal.status !== 'won') continue;
    const closed = toMs(deal.closedAt);
    const created = toMs(deal.createdAt);
    if (closed == null || created == null) continue;
    const days = (closed - created) / MS_PER_DAY;
    if (days < 0) continue; // guard against clock skew / bad data
    total += days;
    count += 1;
  }
  if (count === 0) return null;
  return total / count;
}

/**
 * Conversion rate = won / (won + lost).
 *
 * Defined over CLOSED deals only: active and on_hold deals are not yet a
 * win or a loss, so they are excluded from both numerator and denominator.
 * Returns null when no deals have closed (divide-by-zero guard) so the caller
 * can distinguish "0% conversion" from "nothing has closed yet".
 */
export function conversionRate(deals: DealMetricRow[]): number | null {
  let won = 0;
  let lost = 0;
  for (const deal of deals) {
    if (deal.status === 'won') won += 1;
    else if (deal.status === 'lost') lost += 1;
  }
  const closed = won + lost;
  if (closed === 0) return null;
  return won / closed;
}

/** Per-stage aging for active deals. */
export interface StageBottleneck {
  stageId: string;
  stageName: string;
  /** Number of active deals currently in this stage. */
  count: number;
  /** Average days the active deals have spent in this stage. */
  avgAgeDays: number;
}

export interface StageBottleneckReport {
  /** One entry per provided stage, in the order the stages were given. */
  stages: StageBottleneck[];
  /**
   * The stage where active deals stall longest (highest avgAgeDays among
   * stages that actually hold deals). Null when there are no active deals.
   */
  worstStage: StageBottleneck | null;
}

/**
 * Per-stage bottleneck analysis over ACTIVE deals.
 *
 * Time-in-current-stage is measured from stageChangedAt, falling back to
 * createdAt when the deal never had a stage move stamped. For each provided
 * stage we report the count of active deals and their average age in days, then
 * surface the single stage where deals stall longest (worstStage).
 *
 * Only stages passed in `stages` are reported; active deals whose stageId is
 * not among them are skipped. `now` is injectable for deterministic tests.
 */
export function stageBottlenecks(
  deals: DealMetricRow[],
  stages: StageMetricRow[],
  now: Date = new Date(),
): StageBottleneckReport {
  const nowMs = now.getTime();

  // Accumulate count + summed age per stage id.
  const acc = new Map<string, { count: number; totalDays: number }>();
  for (const stage of stages) {
    acc.set(stage.id, { count: 0, totalDays: 0 });
  }

  for (const deal of deals) {
    if (deal.status !== 'active') continue;
    const bucket = acc.get(deal.stageId);
    if (!bucket) continue; // stage not in the requested set
    const since = toMs(deal.stageChangedAt) ?? toMs(deal.createdAt);
    if (since == null) continue;
    const days = Math.max(0, (nowMs - since) / MS_PER_DAY);
    bucket.count += 1;
    bucket.totalDays += days;
  }

  const report: StageBottleneck[] = stages.map((stage) => {
    const bucket = acc.get(stage.id)!;
    return {
      stageId: stage.id,
      stageName: stage.name,
      count: bucket.count,
      avgAgeDays: bucket.count === 0 ? 0 : bucket.totalDays / bucket.count,
    };
  });

  let worstStage: StageBottleneck | null = null;
  for (const entry of report) {
    if (entry.count === 0) continue;
    if (worstStage === null || entry.avgAgeDays > worstStage.avgAgeDays) {
      worstStage = entry;
    }
  }

  return { stages: report, worstStage };
}
