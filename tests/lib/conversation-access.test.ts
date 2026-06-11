/**
 * Unit tests for the realtor / broker conversation isolation predicates.
 *
 * These are pure functions with no I/O, so the surface to cover is the
 * boundary itself: which conversations a realtor surface may serve and which
 * it must refuse. If someone weakens `isRealtorConversation` (drops the
 * spaceId check, drops a prefix), these assertions fail.
 */

import { describe, it, expect } from 'vitest';
import {
  BROKER_TITLE_PREFIX,
  TEAM_TITLE_PREFIX,
  RESERVED_TITLE_PREFIXES,
  RESERVED_TITLE_LIKE_PATTERNS,
  isReservedConversationTitle,
  isRealtorConversation,
} from '@/lib/chat/conversation-access';

const SPACE = 'space_realtor_1';
const OTHER_SPACE = 'space_realtor_2';

describe('reserved title constants', () => {
  it('pins the exact broker and team prefixes the broker side writes', () => {
    expect(BROKER_TITLE_PREFIX).toBe('[BROKER_CHIPPI]');
    expect(TEAM_TITLE_PREFIX).toBe('[BROKERAGE_CHAT]');
    expect(RESERVED_TITLE_PREFIXES).toEqual(['[BROKER_CHIPPI]', '[BROKERAGE_CHAT]']);
  });

  it('derives SQL LIKE patterns from the prefixes', () => {
    expect(RESERVED_TITLE_LIKE_PATTERNS).toEqual(['[BROKER_CHIPPI]%', '[BROKERAGE_CHAT]%']);
  });
});

describe('isReservedConversationTitle', () => {
  it('flags broker-prefixed titles', () => {
    expect(isReservedConversationTitle('[BROKER_CHIPPI] my notes')).toBe(true);
    expect(isReservedConversationTitle('[BROKER_CHIPPI]')).toBe(true);
  });

  it('flags team-prefixed titles', () => {
    expect(isReservedConversationTitle('[BROKERAGE_CHAT] standup')).toBe(true);
    expect(isReservedConversationTitle('[BROKERAGE_CHAT]')).toBe(true);
  });

  it('passes plain realtor titles', () => {
    expect(isReservedConversationTitle('Follow up with the Garcias')).toBe(false);
    expect(isReservedConversationTitle('New conversation')).toBe(false);
  });

  it('only matches at the START of the title, never mid-string', () => {
    // A realtor could legitimately type the literal text later in a title.
    // Only a leading prefix is reserved.
    expect(isReservedConversationTitle('re: [BROKER_CHIPPI] question')).toBe(false);
    expect(isReservedConversationTitle('about [BROKERAGE_CHAT]')).toBe(false);
  });

  it('treats null / undefined / empty as not reserved', () => {
    expect(isReservedConversationTitle(null)).toBe(false);
    expect(isReservedConversationTitle(undefined)).toBe(false);
    expect(isReservedConversationTitle('')).toBe(false);
  });
});

describe('isRealtorConversation', () => {
  it('passes a realtor-owned conversation in the right space', () => {
    expect(
      isRealtorConversation({ spaceId: SPACE, title: 'Follow up with the Garcias' }, SPACE),
    ).toBe(true);
  });

  it('fails when the conversation belongs to a DIFFERENT space', () => {
    // Wrong space is a cross-tenant attempt even with an innocent title.
    expect(
      isRealtorConversation({ spaceId: OTHER_SPACE, title: 'Follow up' }, SPACE),
    ).toBe(false);
  });

  it('fails a broker-prefixed conversation even when the space matches', () => {
    // The broker_owner owns this realtor space too, so spaceId matches.
    // The prefix is the only thing standing between the realtor and the
    // broker's private Chippi history.
    expect(
      isRealtorConversation({ spaceId: SPACE, title: '[BROKER_CHIPPI] private' }, SPACE),
    ).toBe(false);
  });

  it('fails a team-prefixed conversation even when the space matches', () => {
    expect(
      isRealtorConversation({ spaceId: SPACE, title: '[BROKERAGE_CHAT] team room' }, SPACE),
    ).toBe(false);
  });

  it('fails a broker-prefixed conversation in a foreign space (both gates trip)', () => {
    expect(
      isRealtorConversation({ spaceId: OTHER_SPACE, title: '[BROKER_CHIPPI] x' }, SPACE),
    ).toBe(false);
  });

  it('fails null / undefined (no conversation row)', () => {
    expect(isRealtorConversation(null, SPACE)).toBe(false);
    expect(isRealtorConversation(undefined, SPACE)).toBe(false);
  });
});
