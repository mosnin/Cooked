/**
 * Tests for the HubSpot signal source helpers — the cross-walk + tiny
 * classification predicates that the gather() loop composes from. The
 * gather() integration path is left unmocked (Composio stubbing isn't
 * worth the test value); these tests lock the rules the signals depend
 * on so a regression in match logic gets caught.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  matchDealByTitle,
  matchContactByEmail,
  isAlreadyClosing,
  daysFromNow,
  withinLastHours,
  contactDisplayName,
  triggersFiredRecently,
} from '@/lib/briefing/signal-sources/hubspot';

type DealRow = {
  id: string;
  title: string;
  closeDate: string | null;
  stageId: string;
  DealStage: { kind: string | null; position: number } | null;
};

function deal(overrides: Partial<DealRow> = {}): DealRow {
  return {
    id: 'd1',
    title: 'Chen deal',
    closeDate: null,
    stageId: 'stage-1',
    DealStage: { kind: 'active', position: 2 },
    ...overrides,
  };
}

describe('briefing.hubspot — cross-walk helpers', () => {
  describe('matchDealByTitle', () => {
    it('matches case-insensitively + trims whitespace', () => {
      const deals = [deal({ id: 'a', title: 'Chen deal' }), deal({ id: 'b', title: 'Reyes' })];
      expect(matchDealByTitle('  CHEN DEAL  ', deals)?.id).toBe('a');
      expect(matchDealByTitle('reyes', deals)?.id).toBe('b');
    });

    it('returns null when nothing matches — the brief drops the signal', () => {
      const deals = [deal({ title: 'Chen' })];
      expect(matchDealByTitle('Reyes', deals)).toBeNull();
    });

    it('returns null on null / empty / whitespace-only inputs', () => {
      expect(matchDealByTitle(null, [deal()])).toBeNull();
      expect(matchDealByTitle('', [deal()])).toBeNull();
      expect(matchDealByTitle('   ', [deal()])).toBeNull();
    });
  });

  describe('matchContactByEmail', () => {
    const contacts = [
      { id: 'c1', name: 'Sarah', email: 'sarah@example.com' },
      { id: 'c2', name: 'Marcus', email: 'MARCUS@example.com' },
      { id: 'c3', name: 'Empty', email: null },
    ];

    it('matches case-insensitively on either side', () => {
      expect(matchContactByEmail('SARAH@example.com', contacts)?.id).toBe('c1');
      expect(matchContactByEmail('marcus@example.com', contacts)?.id).toBe('c2');
    });

    it('skips contacts with no email — never matches null to null', () => {
      expect(matchContactByEmail(null, contacts)).toBeNull();
      expect(matchContactByEmail('', contacts)).toBeNull();
    });

    it('returns null when no email matches — the new-contact signal then fires', () => {
      expect(matchContactByEmail('newperson@example.com', contacts)).toBeNull();
    });
  });

  describe('isAlreadyClosing', () => {
    it('true only when the Chippi stage kind is exactly closing', () => {
      expect(isAlreadyClosing(deal({ DealStage: { kind: 'closing', position: 5 } }))).toBe(true);
      expect(isAlreadyClosing(deal({ DealStage: { kind: 'active', position: 2 } }))).toBe(false);
      expect(isAlreadyClosing(deal({ DealStage: { kind: 'closed', position: 6 } }))).toBe(false);
      expect(isAlreadyClosing(deal({ DealStage: null }))).toBe(false);
    });
  });

  describe('contactDisplayName', () => {
    it('joins first + last when both are present', () => {
      expect(
        contactDisplayName({
          id: 'h1',
          email: null,
          firstname: 'Tara',
          lastname: 'Mendes',
          createdate: null,
        }),
      ).toBe('Tara Mendes');
    });

    it('uses the present half when one of first/last is blank', () => {
      expect(
        contactDisplayName({
          id: 'h2',
          email: null,
          firstname: 'Tara',
          lastname: null,
          createdate: null,
        }),
      ).toBe('Tara');
    });

    it('falls back to email local-part when both names are blank', () => {
      expect(
        contactDisplayName({
          id: 'h3',
          email: 'jordan@example.com',
          firstname: null,
          lastname: '',
          createdate: null,
        }),
      ).toBe('jordan');
    });

    it('returns null when there is nothing usable — the signal drops', () => {
      expect(
        contactDisplayName({
          id: 'h4',
          email: null,
          firstname: null,
          lastname: null,
          createdate: null,
        }),
      ).toBeNull();
      expect(
        contactDisplayName({
          id: 'h5',
          email: '   ',
          firstname: '   ',
          lastname: '   ',
          createdate: null,
        }),
      ).toBeNull();
    });
  });
});

describe('briefing.hubspot — time helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('daysFromNow', () => {
    it('returns 0 for a date today (UTC midnight reference)', () => {
      expect(daysFromNow('2026-05-30T20:00:00Z')).toBe(0);
    });

    it('returns positive days for future dates', () => {
      expect(daysFromNow('2026-06-06T12:00:00Z')).toBe(7);
    });

    it('returns negative for past dates', () => {
      expect(daysFromNow('2026-05-20T12:00:00Z')).toBeLessThan(0);
    });

    it('returns null on null / invalid dates', () => {
      expect(daysFromNow(null)).toBeNull();
      expect(daysFromNow('not a date')).toBeNull();
    });
  });

  describe('withinLastHours', () => {
    it('true when the timestamp is within the window', () => {
      expect(withinLastHours('2026-05-30T11:00:00Z', 24)).toBe(true);
      expect(withinLastHours('2026-05-29T13:00:00Z', 24)).toBe(true);
    });

    it('false when older than the window', () => {
      expect(withinLastHours('2026-05-29T11:00:00Z', 24)).toBe(false);
    });

    it('false on null / invalid', () => {
      expect(withinLastHours(null, 24)).toBe(false);
      expect(withinLastHours('not a date', 24)).toBe(false);
    });
  });

  describe('triggersFiredRecently', () => {
    it('true when the named trigger fired inside the window', () => {
      const rows = [
        { triggerSlug: 'HUBSPOT_CONTACT_CREATED_TRIGGER', lastFiredAt: '2026-05-30T11:00:00Z' },
        { triggerSlug: 'HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER', lastFiredAt: '2026-05-25T11:00:00Z' },
      ];
      expect(triggersFiredRecently(rows, 'HUBSPOT_CONTACT_CREATED_TRIGGER')).toBe(true);
      expect(triggersFiredRecently(rows, 'HUBSPOT_DEAL_STAGE_UPDATED_TRIGGER')).toBe(false);
    });

    it('false when the trigger is missing from the list (never fired)', () => {
      expect(
        triggersFiredRecently(
          [{ triggerSlug: 'OTHER', lastFiredAt: '2026-05-30T11:00:00Z' }],
          'HUBSPOT_CONTACT_CREATED_TRIGGER',
        ),
      ).toBe(false);
    });

    it('false when the trigger row exists but lastFiredAt is null', () => {
      expect(
        triggersFiredRecently(
          [{ triggerSlug: 'HUBSPOT_CONTACT_CREATED_TRIGGER', lastFiredAt: null }],
          'HUBSPOT_CONTACT_CREATED_TRIGGER',
        ),
      ).toBe(false);
    });
  });
});
