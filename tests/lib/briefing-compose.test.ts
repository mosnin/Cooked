import { describe, expect, it } from 'vitest';
import { __internals } from '@/lib/briefing/compose';
import type { Signal } from '@/lib/briefing/types';

const { rankSignals, selectCards, composeHeadline } = __internals;

function signal(overrides: Partial<Signal>): Signal {
  return {
    source: 'pipeline',
    kind: 'review',
    urgency: 2,
    confidence: 0.8,
    subject: { id: 'subj-default', name: 'Default Subject', href: '/deals/default' },
    evidence: 'default reason',
    ...overrides,
  };
}

describe('briefing — the composer locks the design rules', () => {
  describe('ranker', () => {
    it('puts urgency-1 signals before urgency-2', () => {
      const u2 = signal({ urgency: 2, confidence: 0.95, subject: { id: 'a', name: 'A', href: '/a' } });
      const u1 = signal({ urgency: 1, confidence: 0.72, subject: { id: 'b', name: 'B', href: '/b' } });
      const ranked = rankSignals([u2, u1]);
      expect(ranked[0].subject.id).toBe('b');
      expect(ranked[1].subject.id).toBe('a');
    });

    it('breaks urgency ties on descending confidence', () => {
      const lower = signal({ urgency: 1, confidence: 0.8, subject: { id: 'a', name: 'A', href: '/a' } });
      const higher = signal({ urgency: 1, confidence: 0.95, subject: { id: 'b', name: 'B', href: '/b' } });
      const ranked = rankSignals([lower, higher]);
      expect(ranked[0].subject.id).toBe('b');
      expect(ranked[1].subject.id).toBe('a');
    });
  });

  describe('selector', () => {
    it('caps cards at five even when more signals are present', () => {
      const signals = Array.from({ length: 8 }, (_, i) =>
        signal({
          urgency: 1,
          confidence: 0.9 - i * 0.01,
          subject: { id: `s${i}`, name: `Subject ${i}`, href: `/s${i}` },
        }),
      );
      const { cards, meta } = selectCards(signals);
      expect(cards).toHaveLength(5);
      // The top five by rank should be the first five we created (highest confidence).
      expect(cards.map((c) => c.subject.id)).toEqual(['s0', 's1', 's2', 's3', 's4']);
      // meta mirrors cards index-for-index and carries the per-card reasoning
      // the surface doesn't see (Phase B5 telemetry).
      expect(meta).toHaveLength(5);
      expect(meta[0].cardIndex).toBe(0);
      expect(meta[0].confidence).toBe(0.9);
    });

    it('deduplicates by subject.id — one card per person/deal', () => {
      // Same contact, two angles (overdue follow-up + Gmail thread cooled).
      const sarahReply = signal({
        kind: 'reply',
        urgency: 1,
        confidence: 0.85,
        subject: { id: 'sarah', name: 'Sarah Chen', href: '/contacts/sarah' },
        source: 'gmail',
      });
      const sarahFollowUp = signal({
        kind: 'call',
        urgency: 1,
        confidence: 0.92,
        subject: { id: 'sarah', name: 'Sarah Chen', href: '/contacts/sarah' },
        source: 'leads',
      });
      const marcus = signal({
        urgency: 1,
        confidence: 0.8,
        subject: { id: 'marcus', name: 'Marcus Reid', href: '/contacts/marcus' },
      });

      const ranked = rankSignals([sarahReply, sarahFollowUp, marcus]);
      const { cards } = selectCards(ranked);

      expect(cards).toHaveLength(2);
      // Sarah's highest-ranked angle (call, conf 0.92) wins her slot.
      expect(cards[0].subject.id).toBe('sarah');
      expect(cards[0].kind).toBe('call');
      expect(cards[1].subject.id).toBe('marcus');
    });

    it('returns empty arrays when given no signals', () => {
      const result = selectCards([]);
      expect(result.cards).toEqual([]);
      expect(result.meta).toEqual([]);
    });

    it('a high-confidence drafts signal outranks a same-urgency pipeline signal', () => {
      // The drafts source emits 0.95 for "high-priority draft for a hot lead";
      // the pipeline source emits 0.72 for "at-risk, just slow". When both
      // are urgency-1, the draft (concrete action ready) should win the slot.
      const stuckDeal = signal({
        source: 'pipeline',
        kind: 'review',
        urgency: 1,
        confidence: 0.72,
        subject: { id: 'deal-a', name: 'Maple deal', href: '/deals/a' },
        evidence: '16 days in this stage',
      });
      const draftReady = signal({
        source: 'drafts',
        kind: 'reply',
        urgency: 1,
        confidence: 0.95,
        subject: { id: 'sarah', name: 'Sarah Chen', href: '/contacts/sarah' },
        evidence: 'Chippi drafted an email. Approve or edit.',
      });
      const { cards } = selectCards(rankSignals([stuckDeal, draftReady]));
      expect(cards[0].subject.id).toBe('sarah');
      expect(cards[0].source).toBe('drafts');
    });
  });

  describe('headline composition', () => {
    it('names the subject explicitly — never a count', () => {
      const { cards } = selectCards([
        signal({
          kind: 'review',
          urgency: 1,
          confidence: 0.95,
          subject: { id: 'chen', name: 'Chen deal', href: '/deals/chen' },
          evidence: '14 days in this stage',
        }),
      ]);
      const { headline } = composeHeadline(cards);
      expect(headline).toContain('Chen deal');
      expect(headline).not.toMatch(/\d+ deal/i);
    });

    it('produces a subheadline when more cards remain after the lead', () => {
      const { cards } = selectCards([
        signal({ urgency: 1, confidence: 0.95, subject: { id: 'a', name: 'A', href: '/a' } }),
        signal({ urgency: 1, confidence: 0.9, subject: { id: 'b', name: 'B', href: '/b' } }),
        signal({ urgency: 1, confidence: 0.85, subject: { id: 'c', name: 'C', href: '/c' } }),
      ]);
      const { subheadline } = composeHeadline(cards);
      expect(subheadline).toMatch(/2 other things? need/);
    });

    it('returns no subheadline when the brief is exactly one card', () => {
      const { cards } = selectCards([signal({ subject: { id: 'a', name: 'A', href: '/a' } })]);
      const { subheadline } = composeHeadline(cards);
      expect(subheadline).toBeNull();
    });

    it('returns an empty headline when there are no cards', () => {
      const { headline, subheadline } = composeHeadline([]);
      expect(headline).toBe('');
      expect(subheadline).toBeNull();
    });
  });
});
