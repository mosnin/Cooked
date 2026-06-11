import { describe, it, expect } from 'vitest';
import {
  avgTimeToCloseDays,
  conversionRate,
  stageBottlenecks,
  type DealMetricRow,
  type StageMetricRow,
} from '@/lib/deal-metrics';

const DAY = 1000 * 60 * 60 * 24;

function row(partial: Partial<DealMetricRow> & Pick<DealMetricRow, 'id' | 'status' | 'stageId'>): DealMetricRow {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('avgTimeToCloseDays', () => {
  it('returns null for empty input', () => {
    expect(avgTimeToCloseDays([])).toBeNull();
  });

  it('averages closedAt - createdAt over won deals only, in days', () => {
    const deals: DealMetricRow[] = [
      // 10 days
      row({ id: 'a', status: 'won', stageId: 's', createdAt: '2026-01-01T00:00:00.000Z', closedAt: '2026-01-11T00:00:00.000Z' }),
      // 20 days
      row({ id: 'b', status: 'won', stageId: 's', createdAt: '2026-01-01T00:00:00.000Z', closedAt: '2026-01-21T00:00:00.000Z' }),
      // lost — ignored
      row({ id: 'c', status: 'lost', stageId: 's', createdAt: '2026-01-01T00:00:00.000Z', closedAt: '2026-02-01T00:00:00.000Z' }),
      // active — ignored
      row({ id: 'd', status: 'active', stageId: 's' }),
    ];
    expect(avgTimeToCloseDays(deals)).toBe(15);
  });

  it('ignores won deals without a closedAt', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'won', stageId: 's', createdAt: '2026-01-01T00:00:00.000Z', closedAt: '2026-01-05T00:00:00.000Z' }), // 4 days
      row({ id: 'b', status: 'won', stageId: 's', closedAt: null }), // no close — skipped
    ];
    expect(avgTimeToCloseDays(deals)).toBe(4);
  });

  it('returns null when no won deal has a usable closedAt', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'won', stageId: 's', closedAt: null }),
      row({ id: 'b', status: 'lost', stageId: 's', closedAt: '2026-01-10T00:00:00.000Z' }),
    ];
    expect(avgTimeToCloseDays(deals)).toBeNull();
  });

  it('accepts Date objects as well as ISO strings', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'won', stageId: 's', createdAt: new Date('2026-01-01T00:00:00.000Z'), closedAt: new Date('2026-01-03T00:00:00.000Z') }),
    ];
    expect(avgTimeToCloseDays(deals)).toBe(2);
  });
});

describe('conversionRate', () => {
  it('returns null for empty input (divide-by-zero guard)', () => {
    expect(conversionRate([])).toBeNull();
  });

  it('returns null when nothing has closed', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'active', stageId: 's' }),
      row({ id: 'b', status: 'on_hold', stageId: 's' }),
    ];
    expect(conversionRate(deals)).toBeNull();
  });

  it('computes won / (won + lost), excluding active/on_hold', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'won', stageId: 's' }),
      row({ id: 'b', status: 'won', stageId: 's' }),
      row({ id: 'c', status: 'won', stageId: 's' }),
      row({ id: 'd', status: 'lost', stageId: 's' }),
      row({ id: 'e', status: 'active', stageId: 's' }),
      row({ id: 'f', status: 'on_hold', stageId: 's' }),
    ];
    // 3 won / 4 closed = 0.75
    expect(conversionRate(deals)).toBe(0.75);
  });

  it('returns 0 when all closed deals are losses', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'lost', stageId: 's' }),
      row({ id: 'b', status: 'lost', stageId: 's' }),
    ];
    expect(conversionRate(deals)).toBe(0);
  });
});

describe('stageBottlenecks', () => {
  const stages: StageMetricRow[] = [
    { id: 'lead', name: 'Lead' },
    { id: 'tour', name: 'Touring' },
    { id: 'app', name: 'Application' },
  ];
  const now = new Date('2026-02-01T00:00:00.000Z');

  it('returns zeroed stages and null worstStage for no active deals', () => {
    const report = stageBottlenecks([], stages, now);
    expect(report.stages).toHaveLength(3);
    expect(report.stages.every((s) => s.count === 0 && s.avgAgeDays === 0)).toBe(true);
    expect(report.worstStage).toBeNull();
  });

  it('measures time-in-stage from stageChangedAt and finds the worst stage', () => {
    const deals: DealMetricRow[] = [
      // Lead: one deal, 1 day in stage
      row({ id: 'a', status: 'active', stageId: 'lead', stageChangedAt: '2026-01-31T00:00:00.000Z' }),
      // Touring: two deals, 10 and 20 days -> avg 15
      row({ id: 'b', status: 'active', stageId: 'tour', stageChangedAt: '2026-01-22T00:00:00.000Z' }),
      row({ id: 'c', status: 'active', stageId: 'tour', stageChangedAt: '2026-01-12T00:00:00.000Z' }),
      // won deal in tour — ignored (not active)
      row({ id: 'd', status: 'won', stageId: 'tour', stageChangedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const report = stageBottlenecks(deals, stages, now);
    const byId = Object.fromEntries(report.stages.map((s) => [s.stageId, s]));
    expect(byId.lead.count).toBe(1);
    expect(byId.lead.avgAgeDays).toBe(1);
    expect(byId.tour.count).toBe(2);
    expect(byId.tour.avgAgeDays).toBe(15);
    expect(byId.app.count).toBe(0);
    expect(report.worstStage?.stageId).toBe('tour');
    expect(report.worstStage?.avgAgeDays).toBe(15);
  });

  it('falls back to createdAt when stageChangedAt is missing', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'active', stageId: 'lead', createdAt: '2026-01-27T00:00:00.000Z', stageChangedAt: null }),
    ];
    const report = stageBottlenecks(deals, stages, now);
    const lead = report.stages.find((s) => s.stageId === 'lead')!;
    expect(lead.count).toBe(1);
    expect(lead.avgAgeDays).toBe(5);
    expect(report.worstStage?.stageId).toBe('lead');
  });

  it('skips active deals whose stage is not in the provided set', () => {
    const deals: DealMetricRow[] = [
      row({ id: 'a', status: 'active', stageId: 'unknown-stage', stageChangedAt: '2026-01-01T00:00:00.000Z' }),
    ];
    const report = stageBottlenecks(deals, stages, now);
    expect(report.stages.every((s) => s.count === 0)).toBe(true);
    expect(report.worstStage).toBeNull();
  });
});
