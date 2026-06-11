/**
 * Server-side permission resolver for the manager Koala surface
 * (`/manager/koala` → `/api/ai/manager-task`).
 *
 * This is defense layer 2 of three (per AGENTS.md and the Koala-for-Managers
 * Phase 1 spec):
 *
 *   1. ROUTE GUARD   — `app/manager/koala/page.tsx` server component
 *                      redirects when the caller isn't a manager.
 *   2. API GATE      — this module. `app/api/ai/manager-task/route.ts` calls
 *                      `resolveManagerContext()` before forwarding to Modal.
 *                      A rep_member trying to hit the manager chat —
 *                      even if they slip past the route guard somehow —
 *                      receives a 403 right here.
 *   3. TOOL-RUNTIME  — `agent/tools/manager/_guards.py:require_manager_role`
 *                      refuses tool execution unless AgentContext carries
 *                      a manager role. Phase 2/3 tools wrap every handler
 *                      body with that check.
 *
 * Layer 2 lives in its own module (not as ad-hoc code inside the route) so
 * the next route Phase 2/3 adds can reuse the same gate without copying
 * the logic — and so the contract for "what counts as manager access" is
 * single-source-of-truth.
 */

import { getManagerMemberContext } from '@/lib/permissions';
import type { Team, TeamMembership } from '@/lib/types';

/**
 * Roles allowed to use the manager chat surface.
 *
 * `rep_member` is excluded by design — a rep inside a team
 * already has their own Koala at `/s/<slug>/koala`. The manager chat is
 * the chief-of-staff variant, scoped to team-wide operations, and
 * rep_members do not run those operations.
 */
const MANAGER_ROLES = ['manager_owner', 'manager_admin'] as const;
type ManagerRole = (typeof MANAGER_ROLES)[number];

export interface ManagerAgentContext {
  /** Team row the caller has admin/owner access to. */
  team: Team;
  /** Their TeamMembership row — role and ids. */
  membership: TeamMembership;
  /** Internal `User.id` (NOT Clerk id). Same shape as other helpers expose. */
  dbUserId: string;
  /** Narrowed role — guaranteed one of `MANAGER_ROLES` after this resolves. */
  managerRole: ManagerRole;
}

/**
 * Resolve the calling Clerk user to a manager-admin-or-owner context, or
 * `null` if they are not a manager.
 *
 * Returns `null` when:
 *   - The user is not signed in (no Clerk session).
 *   - The user has no `TeamMembership` of any kind.
 *   - The user IS a team member but only as `rep_member` — the
 *     manager chat surface is not theirs.
 *   - The user's `User.status` is `offboarded` (handled inside
 *     `getManagerMemberContext` already, propagated through the null).
 *
 * On success returns the team, membership, internal user id, and a
 * narrowed `managerRole` field the caller can forward to Modal without
 * re-running its own role check.
 *
 * Reuses `getManagerMemberContext()` from `lib/permissions.ts:121` — does
 * not duplicate the membership / team / offboarding lookups, so any
 * future change to "what does manager auth mean" lives in one place.
 */
export async function resolveManagerContext(): Promise<ManagerAgentContext | null> {
  const ctx = await getManagerMemberContext();
  if (!ctx) return null;

  // `getManagerMemberContext` accepts rep_member too — it's the helper
  // for "any team member, including reps". We filter HERE so the
  // gate exposes a single intent: the manager chat is for managers.
  const role = ctx.membership.role;
  if (role !== 'manager_owner' && role !== 'manager_admin') {
    return null;
  }

  return {
    team: ctx.team,
    membership: ctx.membership,
    dbUserId: ctx.dbUserId,
    managerRole: role,
  };
}
