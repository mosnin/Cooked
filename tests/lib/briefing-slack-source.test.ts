/**
 * Pure-helper tests for the Slack signal source. Composio is intentionally
 * not mocked — `gather()` short-circuits to [] when no connection is
 * configured, which is what the test environment is. The two functions
 * worth locking are the mention extractor and the teammate match, since
 * a bug in either silently misroutes signals.
 */

import { describe, expect, it } from 'vitest';
import { extractMentions, mentionsRealtor, isTeammate } from '@/lib/briefing/signal-sources/slack';

describe('slack signal source — pure helpers', () => {
  describe('extractMentions', () => {
    it('pulls a single mention token', () => {
      expect(extractMentions('hey <@U0ME123>, wire instructions?')).toEqual(['U0ME123']);
    });

    it('returns multiple mentions in order', () => {
      expect(extractMentions('<@U01> and <@U02> please')).toEqual(['U01', 'U02']);
    });

    it('ignores bare @-names — Slack-rendered mentions use angle brackets', () => {
      expect(extractMentions('hi @priya, see this')).toEqual([]);
    });

    it('returns empty for null, undefined, and empty text', () => {
      expect(extractMentions(null)).toEqual([]);
      expect(extractMentions(undefined)).toEqual([]);
      expect(extractMentions('')).toEqual([]);
    });
  });

  describe('mentionsRealtor', () => {
    it('returns true when the realtor id appears in the text', () => {
      expect(mentionsRealtor('hey <@U0ME>, this one', 'U0ME')).toBe(true);
    });

    it('returns false when a different teammate is mentioned', () => {
      expect(mentionsRealtor('<@U0JESS> can you check this?', 'U0ME')).toBe(false);
    });

    it('returns false when the realtor id is null (unknown self)', () => {
      expect(mentionsRealtor('<@U0ME> ping', null)).toBe(false);
    });

    it('returns false on null/empty text', () => {
      expect(mentionsRealtor(null, 'U0ME')).toBe(false);
      expect(mentionsRealtor('', 'U0ME')).toBe(false);
    });
  });

  describe('isTeammate', () => {
    const team = new Set(['U0JESS', 'U0PRIYA', 'U0ME']);

    it('returns true when the sender is in the team set', () => {
      expect(isTeammate('U0PRIYA', team)).toBe(true);
    });

    it('returns false when the sender is outside the team (e.g. Slack Connect)', () => {
      expect(isTeammate('U0STRANGER', team)).toBe(false);
    });

    it('returns false when the sender id is missing', () => {
      expect(isTeammate(undefined, team)).toBe(false);
      expect(isTeammate(null, team)).toBe(false);
      expect(isTeammate('', team)).toBe(false);
    });
  });
});
