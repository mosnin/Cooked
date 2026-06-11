/**
 * Rep / manager conversation isolation boundary.
 *
 * Manager-Koala and team team chats live in the SAME `Conversation`
 * table as rep conversations today, keyed by `spaceId` and distinguished
 * only by a reserved title prefix. A manager_owner also owns their personal
 * rep space, so space ownership ALONE is not isolation — the rep
 * surface must additionally refuse any conversation whose title carries a
 * reserved prefix.
 *
 * This module is the single source of truth for that boundary. Keep it
 * dependency-free (no supabase, no clerk) so the predicates are trivially
 * unit-testable and so every rep read path routes through the same
 * checks. If this class of leak is to fail CI, it has to live in one place.
 *
 * No em dashes below this point are in code — the prose above is comment.
 */

/** Title prefix on a manager's personal Koala conversation. */
export const MANAGER_TITLE_PREFIX = '[MANAGER_KOALA]';

/** Title prefix on a team-wide team chat conversation. */
export const TEAM_TITLE_PREFIX = '[TEAM_CHAT]';

/**
 * Every reserved prefix the rep surface must never serve. Sourced by the
 * supabase `.not('title','like', ...)` list filters so the exclusion set
 * lives in exactly one place.
 */
export const RESERVED_TITLE_PREFIXES = [MANAGER_TITLE_PREFIX, TEAM_TITLE_PREFIX] as const;

/**
 * The SQL LIKE patterns for the reserved prefixes, ready to hand to
 * supabase `.not('title', 'like', pattern)`. Derived from the constants so
 * the prefix is never restated as a string literal at the call sites.
 */
export const RESERVED_TITLE_LIKE_PATTERNS = RESERVED_TITLE_PREFIXES.map(
  (prefix) => `${prefix}%`,
) as readonly string[];

/**
 * True when a title belongs to a manager-side surface (manager Koala or team
 * chat) and must therefore be hidden from the rep. Used by the list
 * filters and the per-conversation guards.
 */
export function isReservedConversationTitle(title: string | null | undefined): boolean {
  const t = title ?? '';
  return RESERVED_TITLE_PREFIXES.some((prefix) => t.startsWith(prefix));
}

/**
 * The rep-side boundary predicate. True ONLY when:
 *   - the conversation exists,
 *   - it belongs to THIS rep space (`conv.spaceId === spaceId`), and
 *   - its title is not a reserved manager/team title.
 *
 * Any read path that loads messages or mutates a conversation on the rep
 * surface must gate on this. A false result means "deny": 404, or fall
 * through to the empty state. Never expose.
 */
export function isRepConversation(
  conv: { spaceId: string; title: string } | null | undefined,
  spaceId: string,
): boolean {
  if (!conv) return false;
  if (conv.spaceId !== spaceId) return false;
  if (isReservedConversationTitle(conv.title)) return false;
  return true;
}
