/**
 * Realtor / broker conversation isolation boundary.
 *
 * Broker-Chippi and brokerage team chats live in the SAME `Conversation`
 * table as realtor conversations today, keyed by `spaceId` and distinguished
 * only by a reserved title prefix. A broker_owner also owns their personal
 * realtor space, so space ownership ALONE is not isolation — the realtor
 * surface must additionally refuse any conversation whose title carries a
 * reserved prefix.
 *
 * This module is the single source of truth for that boundary. Keep it
 * dependency-free (no supabase, no clerk) so the predicates are trivially
 * unit-testable and so every realtor read path routes through the same
 * checks. If this class of leak is to fail CI, it has to live in one place.
 *
 * No em dashes below this point are in code — the prose above is comment.
 */

/** Title prefix on a broker's personal Chippi conversation. */
export const BROKER_TITLE_PREFIX = '[BROKER_CHIPPI]';

/** Title prefix on a brokerage-wide team chat conversation. */
export const TEAM_TITLE_PREFIX = '[BROKERAGE_CHAT]';

/**
 * Every reserved prefix the realtor surface must never serve. Sourced by the
 * supabase `.not('title','like', ...)` list filters so the exclusion set
 * lives in exactly one place.
 */
export const RESERVED_TITLE_PREFIXES = [BROKER_TITLE_PREFIX, TEAM_TITLE_PREFIX] as const;

/**
 * The SQL LIKE patterns for the reserved prefixes, ready to hand to
 * supabase `.not('title', 'like', pattern)`. Derived from the constants so
 * the prefix is never restated as a string literal at the call sites.
 */
export const RESERVED_TITLE_LIKE_PATTERNS = RESERVED_TITLE_PREFIXES.map(
  (prefix) => `${prefix}%`,
) as readonly string[];

/**
 * True when a title belongs to a broker-side surface (broker Chippi or team
 * chat) and must therefore be hidden from the realtor. Used by the list
 * filters and the per-conversation guards.
 */
export function isReservedConversationTitle(title: string | null | undefined): boolean {
  const t = title ?? '';
  return RESERVED_TITLE_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/**
 * The realtor-side boundary predicate. True ONLY when:
 *   - the conversation exists,
 *   - it belongs to THIS realtor space (`conv.spaceId === spaceId`), and
 *   - its title is not a reserved broker/team title.
 *
 * Any read path that loads messages or mutates a conversation on the realtor
 * surface must gate on this. A false result means "deny": 404, or fall
 * through to the empty state. Never expose.
 */
export function isRealtorConversation(
  conv: { spaceId: string; title: string } | null | undefined,
  spaceId: string,
): boolean {
  if (!conv) return false;
  if (conv.spaceId !== spaceId) return false;
  if (isReservedConversationTitle(conv.title)) return false;
  return true;
}
