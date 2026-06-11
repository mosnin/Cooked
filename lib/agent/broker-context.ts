/**
 * Server-side permission resolver for the broker Chippi surface
 * (`/broker/chippi` → `/api/ai/broker-task`).
 *
 * This is defense layer 2 of three (per AGENTS.md and the Chippi-for-Brokers
 * Phase 1 spec):
 *
 *   1. ROUTE GUARD   — `app/broker/chippi/page.tsx` server component
 *                      redirects when the caller isn't a broker.
 *   2. API GATE      — this module. `app/api/ai/broker-task/route.ts` calls
 *                      `resolveBrokerContext()` before forwarding to Modal.
 *                      A realtor_member trying to hit the broker chat —
 *                      even if they slip past the route guard somehow —
 *                      receives a 403 right here.
 *   3. TOOL-RUNTIME  — `agent/tools/broker/_guards.py:require_broker_role`
 *                      refuses tool execution unless AgentContext carries
 *                      a broker role. Phase 2/3 tools wrap every handler
 *                      body with that check.
 *
 * Layer 2 lives in its own module (not as ad-hoc code inside the route) so
 * the next route Phase 2/3 adds can reuse the same gate without copying
 * the logic — and so the contract for "what counts as broker access" is
 * single-source-of-truth.
 */

import { getBrokerMemberContext } from '@/lib/permissions';
import type { Brokerage, BrokerageMembership } from '@/lib/types';

/**
 * Roles allowed to use the broker chat surface.
 *
 * `realtor_member` is excluded by design — a realtor inside a brokerage
 * already has their own Chippi at `/s/<slug>/chippi`. The broker chat is
 * the chief-of-staff variant, scoped to brokerage-wide operations, and
 * realtor_members do not run those operations.
 */
const BROKER_ROLES = ['broker_owner', 'broker_admin'] as const;
type BrokerRole = (typeof BROKER_ROLES)[number];

export interface BrokerAgentContext {
  /** Brokerage row the caller has admin/owner access to. */
  brokerage: Brokerage;
  /** Their BrokerageMembership row — role and ids. */
  membership: BrokerageMembership;
  /** Internal `User.id` (NOT Clerk id). Same shape as other helpers expose. */
  dbUserId: string;
  /** Narrowed role — guaranteed one of `BROKER_ROLES` after this resolves. */
  brokerRole: BrokerRole;
}

/**
 * Resolve the calling Clerk user to a broker-admin-or-owner context, or
 * `null` if they are not a broker.
 *
 * Returns `null` when:
 *   - The user is not signed in (no Clerk session).
 *   - The user has no `BrokerageMembership` of any kind.
 *   - The user IS a brokerage member but only as `realtor_member` — the
 *     broker chat surface is not theirs.
 *   - The user's `User.status` is `offboarded` (handled inside
 *     `getBrokerMemberContext` already, propagated through the null).
 *
 * On success returns the brokerage, membership, internal user id, and a
 * narrowed `brokerRole` field the caller can forward to Modal without
 * re-running its own role check.
 *
 * Reuses `getBrokerMemberContext()` from `lib/permissions.ts:121` — does
 * not duplicate the membership / brokerage / offboarding lookups, so any
 * future change to "what does broker auth mean" lives in one place.
 */
export async function resolveBrokerContext(): Promise<BrokerAgentContext | null> {
  const ctx = await getBrokerMemberContext();
  if (!ctx) return null;

  // `getBrokerMemberContext` accepts realtor_member too — it's the helper
  // for "any brokerage member, including realtors". We filter HERE so the
  // gate exposes a single intent: the broker chat is for brokers.
  const role = ctx.membership.role;
  if (role !== 'broker_owner' && role !== 'broker_admin') {
    return null;
  }

  return {
    brokerage: ctx.brokerage,
    membership: ctx.membership,
    dbUserId: ctx.dbUserId,
    brokerRole: role,
  };
}
