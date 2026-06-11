import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  briefOpenRate,
  sourceTapRates,
  confidenceCalibration,
  briefRetentionDelta,
} from '@/lib/briefing/analytics';
import type { BriefCardMeta, BriefCardTap } from '@/lib/briefing/types';

/**
 * Mock Supabase client — only implements `.from(table).select(...)` with
 * the gte/lt/eq chains the analytics functions use. Returns rows we
 * pre-stage per test. Enough fidelity to test the aggregation math
 * without standing up a real database.
 */
type MockRow = Record<string, unknown>;

function makeClient(rows: MockRow[]) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.gte = chain;
  builder.lt = chain;
  builder.eq = chain;
  builder.then = (resolve: (r: { data: MockRow[]; error: null }) => void) =>
    resolve({ data: rows, error: null });
  return {
    from: () => builder,
  } as unknown as Parameters<typeof briefOpenRate>[1];
}

describe('briefing analytics — open rate', () => {
  it('returns 0 when no briefs in the window', async () => {
    const result = await briefOpenRate(7, makeClient([]));
    expect(result).toEqual({ total: 0, seen: 0, rate: 0 });
  });

  it('computes seen / total for a populated window', async () => {
    const result = await briefOpenRate(
      7,
      makeClient([
        { id: 'b1', seenAt: '2026-05-29T07:01:00Z' },
        { id: 'b2', seenAt: null },
        { id: 'b3', seenAt: '2026-05-28T07:05:00Z' },
      ]),
    );
    expect(result.total).toBe(3);
    expect(result.seen).toBe(2);
    expect(result.rate).toBeCloseTo(2 / 3, 4);
  });
});

describe('briefing analytics — source tap rates', () => {
  it('aggregates shown + tapped per (source, kind) bucket', async () => {
    const meta1: BriefCardMeta[] = [
      { cardIndex: 0, source: 'pipeline', kind: 'review', confidence: 0.95, urgency: 1 },
      { cardIndex: 1, source: 'leads', kind: 'call', confidence: 0.85, urgency: 2 },
    ];
    const taps1: BriefCardTap[] = [
      { cardIndex: 0, source: 'pipeline', kind: 'review', tappedAt: '2026-05-29T07:05:00Z' },
    ];
    const meta2: BriefCardMeta[] = [
      { cardIndex: 0, source: 'pipeline', kind: 'review', confidence: 0.95, urgency: 1 },
    ];
    const taps2: BriefCardTap[] = [
      { cardIndex: 0, source: 'pipeline', kind: 'review', tappedAt: '2026-05-30T07:01:00Z' },
    ];

    const result = await sourceTapRates(
      30,
      makeClient([
        { cardMeta: meta1, cardTaps: taps1 },
        { cardMeta: meta2, cardTaps: taps2 },
      ]),
    );

    const pipeline = result.find((r) => r.source === 'pipeline' && r.kind === 'review');
    expect(pipeline).toBeDefined();
    expect(pipeline!.shown).toBe(2);
    expect(pipeline!.tapped).toBe(2);
    expect(pipeline!.rate).toBe(1);

    const leads = result.find((r) => r.source === 'leads' && r.kind === 'call');
    expect(leads).toBeDefined();
    expect(leads!.shown).toBe(1);
    expect(leads!.tapped).toBe(0);
    expect(leads!.rate).toBe(0);
  });

  it('returns empty array for an empty window', async () => {
    const result = await sourceTapRates(30, makeClient([]));
    expect(result).toEqual([]);
  });
});

describe('briefing analytics — confidence calibration', () => {
  it('bins by confidence decile within (source, kind)', async () => {
    const meta: BriefCardMeta[] = [
      { cardIndex: 0, source: 'pipeline', kind: 'review', confidence: 0.95, urgency: 1 },
      { cardIndex: 1, source: 'pipeline', kind: 'review', confidence: 0.72, urgency: 2 },
    ];
    const taps: BriefCardTap[] = [
      { cardIndex: 0, source: 'pipeline', kind: 'review', tappedAt: 'x' },
    ];
    const result = await confidenceCalibration(30, makeClient([{ cardMeta: meta, cardTaps: taps }]));

    const high = result.find((r) => r.confidenceBucket === 9);
    const low = result.find((r) => r.confidenceBucket === 7);
    expect(high?.tapped).toBe(1);
    expect(high?.shown).toBe(1);
    expect(low?.tapped).toBe(0);
    expect(low?.shown).toBe(1);
  });
});

describe('briefing analytics — retention delta', () => {
  it('splits cohorts by briefEnabled, ignoring those inside the warm-up window', async () => {
    const ancient = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    const result = await briefRetentionDelta(
      14,
      makeClient([
        // Enabled cohort, eligible (≥14 days enabled)
        { briefEnabled: true, briefEnabledAt: ancient, Space: { stripeSubscriptionStatus: 'active' } },
        { briefEnabled: true, briefEnabledAt: ancient, Space: { stripeSubscriptionStatus: 'canceled' } },
        // Enabled but inside warm-up — should be excluded
        { briefEnabled: true, briefEnabledAt: recent, Space: { stripeSubscriptionStatus: 'active' } },
        // Disabled cohort
        { briefEnabled: false, briefEnabledAt: null, Space: { stripeSubscriptionStatus: 'canceled' } },
        { briefEnabled: false, briefEnabledAt: null, Space: { stripeSubscriptionStatus: 'active' } },
      ]),
    );

    expect(result.enabled.count).toBe(2);
    expect(result.enabled.canceled).toBe(1);
    expect(result.enabled.rate).toBe(0.5);
    expect(result.disabled.count).toBe(2);
    expect(result.disabled.canceled).toBe(1);
    expect(result.disabled.rate).toBe(0.5);
  });
});
