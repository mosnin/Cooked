/**
 * Unit tests for the rep / manager conversation isolation predicates.
 *
 * These are pure functions with no I/O, so the surface to cover is the
 * boundary itself: which conversations a rep surface may serve and which
 * it must refuse. If someone weakens `isRepConversation` (drops the
 * spaceId check, drops a prefix), these assertions fail.
 */

import { describe, it, expect } from 'vitest';
import {
  MANAGER_TITLE_PREFIX,
  TEAM_TITLE_PREFIX,
  RESERVED_TITLE_PREFIXES,
  RESERVED_TITLE_LIKE_PATTERNS,
  isReservedConversationTitle,
  isRepConversation,
} from '@/lib/chat/conversation-access';

const SPACE = 'space_rep_1';
const OTHER_SPACE = 'space_rep_2';

describe('reserved title constants', () => {
  it('pins the exact manager and team prefixes the manager side writes', () => {
    expect(MANAGER_TITLE_PREFIX).toBe('[MANAGER_KOALA]');
    expect(TEAM_TITLE_PREFIX).toBe('[TEAM_CHAT]');
    expect(RESERVED_TITLE_PREFIXES).toEqual(['[MANAGER_KOALA]', '[TEAM_CHAT]']);
  });

  it('derives SQL LIKE patterns from the prefixes', () => {
    expect(RESERVED_TITLE_LIKE_PATTERNS).toEqual(['[MANAGER_KOALA]%', '[TEAM_CHAT]%']);
  });
});

describe('isReservedConversationTitle', () => {
  it('flags manager-prefixed titles', () => {
    expect(isReservedConversationTitle('[MANAGER_KOALA] my notes')).toBe(true);
    expect(isReservedConversationTitle('[MANAGER_KOALA]')).toBe(true);
  });

  it('flags team-prefixed titles', () => {
    expect(isReservedConversationTitle('[TEAM_CHAT] standup')).toBe(true);
    expect(isReservedConversationTitle('[TEAM_CHAT]')).toBe(true);
  });

  it('passes plain rep titles', () => {
    expect(isReservedConversationTitle('Follow up with the Garcias')).toBe(false);
    expect(isReservedConversationTitle('New conversation')).toBe(false);
  });

  it('only matches at the START of the title, never mid-string', () => {
    // A rep could legitimately type the literal text later in a title.
    // Only a leading prefix is reserved.
    expect(isReservedConversationTitle('re: [MANAGER_KOALA] question')).toBe(false);
    expect(isReservedConversationTitle('about [TEAM_CHAT]')).toBe(false);
  });

  it('treats null / undefined / empty as not reserved', () => {
    expect(isReservedConversationTitle(null)).toBe(false);
    expect(isReservedConversationTitle(undefined)).toBe(false);
    expect(isReservedConversationTitle('')).toBe(false);
  });
});

describe('isRepConversation', () => {
  it('passes a rep-owned conversation in the right space', () => {
    expect(
      isRepConversation({ spaceId: SPACE, title: 'Follow up with the Garcias' }, SPACE),
    ).toBe(true);
  });

  it('fails when the conversation belongs to a DIFFERENT space', () => {
    // Wrong space is a cross-tenant attempt even with an innocent title.
    expect(
      isRepConversation({ spaceId: OTHER_SPACE, title: 'Follow up' }, SPACE),
    ).toBe(false);
  });

  it('fails a manager-prefixed conversation even when the space matches', () => {
    // The manager_owner owns this rep space too, so spaceId matches.
    // The prefix is the only thing standing between the rep and the
    // manager's private Koala history.
    expect(
      isRepConversation({ spaceId: SPACE, title: '[MANAGER_KOALA] private' }, SPACE),
    ).toBe(false);
  });

  it('fails a team-prefixed conversation even when the space matches', () => {
    expect(
      isRepConversation({ spaceId: SPACE, title: '[TEAM_CHAT] team room' }, SPACE),
    ).toBe(false);
  });

  it('fails a manager-prefixed conversation in a foreign space (both gates trip)', () => {
    expect(
      isRepConversation({ spaceId: OTHER_SPACE, title: '[MANAGER_KOALA] x' }, SPACE),
    ).toBe(false);
  });

  it('fails null / undefined (no conversation row)', () => {
    expect(isRepConversation(null, SPACE)).toBe(false);
    expect(isRepConversation(undefined, SPACE)).toBe(false);
  });
});
