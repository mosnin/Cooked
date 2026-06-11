/**
 * Team lead-routing engine (BP7b + BP7d rules layer).
 *
 * Given a teamId (and optionally the inbound lead's leadType /
 * budget / tags) decide which rep_member should receive the next
 * inbound lead. Routing is configured on the Team row:
 *
 *   autoAssignEnabled   boolean  — kill switch, off by default
 *   assignmentMethod    'manual' | 'round_robin' | 'score_based'
 *   lastAssignedUserId  text     — cursor used by round-robin/tiebreak
 *
 * Layered on top (BP7d) is the DealRoutingRule table: an ordered list
 * of criteria → destination rules evaluated BEFORE the global
 * assignmentMethod. First matching rule wins; if no rule matches, or
 * the matched rule's destination is ineligible, fall through to the
 * next rule / eventually the assignmentMethod fallback.
 *
 * An "eligible agent" is a TeamMembership with role='rep_member'
 * whose User.status is NOT 'offboarded' (treated as active) AND whose
 * Space row (ownerId = user.id, teamId = this team) exists.
 *
 * This module is defensive by design:
 *   - Never throws. All failure paths return null and log.
 *   - Pre-migration safe: if the new Team columns don't exist yet,
 *     the autoAssign flag is treated as false, so the caller falls back
 *     to the manager-owner space (current behaviour). The DealRoutingRule
 *     table being absent is similarly tolerated (returns [] rules).
 *   - Cursor updates are fire-and-forget; a failed write never blocks
 *     the returned routing decision.
 *   - Backwards compatible: calling without a `lead` argument behaves
 *     identically to BP7b — no criteria can match a missing input, so
 *     the engine always falls through to the legacy path.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export type RoutingMethod = 'round_robin' | 'score_based' | 'rule';

export interface RoutingResult {
  agentUserId: string;
  agentSpaceId: string;
  method: RoutingMethod;
  /**
   * When `method === 'rule'`, the id of the DealRoutingRule that matched.
   * Useful for log observability / audit. Always null for pure
   * assignmentMethod picks.
   */
  ruleId?: string | null;
}

/**
 * Shape of the inbound lead used for rule criteria matching.
 * All fields optional — callers pass what they have validated.
 */
export interface RoutingLeadInput {
  leadType?: string | null;
  budget?: number | null;
  tags?: string[] | null;
}

type AssignmentMethod = 'manual' | 'round_robin' | 'score_based';

interface TeamRoutingConfig {
  autoAssignEnabled: boolean;
  assignmentMethod: AssignmentMethod;
  lastAssignedUserId: string | null;
}

interface EligibleAgent {
  userId: string;
  spaceId: string;
}

interface DealRoutingRuleRow {
  id: string;
  teamId: string;
  name: string;
  priority: number;
  enabled: boolean;
  leadType: string | null;
  minBudget: number | null;
  maxBudget: number | null;
  matchTag: string | null;
  destinationUserId: string | null;
  destinationPoolMethod: 'round_robin' | 'score_based' | null;
  destinationPoolTag: string | null;
  createdAt: string;
}

/**
 * Load the three routing-config columns off the Team row. If the
 * columns are missing (migration hasn't landed yet), returns a safe
 * default that disables auto-assignment.
 */
async function loadTeamRoutingConfig(
  teamId: string,
): Promise<TeamRoutingConfig | null> {
  try {
    const { data, error } = await supabase
      .from('Team')
      .select('autoAssignEnabled, assignmentMethod, lastAssignedUserId')
      .eq('id', teamId)
      .maybeSingle();

    if (error) {
      // 42703 = undefined_column → schema hasn't migrated yet. Treat as
      // auto-assign disabled. Anything else is unexpected but still safe
      // to degrade to disabled.
      const code = (error as { code?: string }).code;
      if (code === '42703') {
        logger.debug('[team-routing] routing columns not present yet; treating as disabled', {
          teamId,
        });
        return { autoAssignEnabled: false, assignmentMethod: 'manual', lastAssignedUserId: null };
      }
      logger.warn('[team-routing] failed to load team routing config', { teamId }, error);
      return null;
    }

    if (!data) {
      logger.warn('[team-routing] team row not found', { teamId });
      return null;
    }

    const row = data as {
      autoAssignEnabled?: boolean | null;
      assignmentMethod?: string | null;
      lastAssignedUserId?: string | null;
    };

    const method: AssignmentMethod =
      row.assignmentMethod === 'round_robin' || row.assignmentMethod === 'score_based'
        ? row.assignmentMethod
        : 'manual';

    return {
      autoAssignEnabled: row.autoAssignEnabled === true,
      assignmentMethod: method,
      lastAssignedUserId: row.lastAssignedUserId ?? null,
    };
  } catch (err) {
    logger.error('[team-routing] unexpected error loading routing config', { teamId }, err);
    return null;
  }
}

/**
 * Load enabled DealRoutingRule rows for this team, ordered by
 * priority ASC (lowest number = evaluated first), then createdAt ASC
 * as a stable tiebreak. Returns [] if the table is absent (pre-BP7d),
 * which makes every caller fall straight through to the legacy engine.
 */
async function loadEnabledRules(teamId: string): Promise<DealRoutingRuleRow[]> {
  try {
    const { data, error } = await supabase
      .from('DealRoutingRule')
      .select(
        'id, teamId, name, priority, enabled, leadType, minBudget, maxBudget, matchTag, destinationUserId, destinationPoolMethod, destinationPoolTag, createdAt',
      )
      .eq('teamId', teamId)
      .eq('enabled', true)
      .order('priority', { ascending: true })
      .order('createdAt', { ascending: true });

    if (error) {
      const code = (error as { code?: string }).code;
      // 42P01 = undefined_table — migration not applied. Silent.
      if (code === '42P01') return [];
      logger.warn('[team-routing] failed to load routing rules', { teamId }, error);
      return [];
    }

    return (data ?? []) as DealRoutingRuleRow[];
  } catch (err) {
    logger.warn('[team-routing] routing-rule load threw', { teamId }, err);
    return [];
  }
}

/**
 * AND-combined criteria check. A rule with every criteria field null is
 * a catch-all that matches any lead. Every populated criteria tightens
 * the predicate.
 */
function ruleMatches(rule: DealRoutingRuleRow, lead: RoutingLeadInput): boolean {
  if (rule.leadType) {
    const leadLeadType = (lead.leadType ?? '').toString().trim().toLowerCase();
    if (leadLeadType !== rule.leadType.trim().toLowerCase()) return false;
  }

  if (rule.minBudget !== null) {
    if (typeof lead.budget !== 'number' || Number.isNaN(lead.budget)) return false;
    if (lead.budget < rule.minBudget) return false;
  }

  if (rule.maxBudget !== null) {
    if (typeof lead.budget !== 'number' || Number.isNaN(lead.budget)) return false;
    if (lead.budget > rule.maxBudget) return false;
  }

  if (rule.matchTag) {
    const tag = rule.matchTag.trim().toLowerCase();
    const tags = (lead.tags ?? []).map((t) => (t ?? '').toString().trim().toLowerCase());
    if (!tags.includes(tag)) return false;
  }

  return true;
}

/**
 * Enumerate eligible rep_member agents for a team. An agent is
 * eligible when:
 *   - role === 'rep_member'
 *   - User exists AND User.status !== 'offboarded' (missing status column
 *     or null status is treated as active)
 *   - A Space exists with ownerId = user.id AND teamId = this team
 *
 * Results are sorted deterministically by userId (lex ascending) so that
 * round-robin and tie-break logic are stable across calls.
 */
async function getEligibleAgents(teamId: string): Promise<EligibleAgent[]> {
  try {
    const { data: memberships, error: memberError } = await supabase
      .from('TeamMembership')
      .select('userId, role')
      .eq('teamId', teamId)
      .eq('role', 'rep_member');
    if (memberError) {
      logger.warn('[team-routing] failed to enumerate memberships', { teamId }, memberError);
      return [];
    }

    const userIds = (memberships ?? [])
      .map((m: unknown) => (m as { userId: string }).userId)
      .filter(Boolean);
    if (userIds.length === 0) return [];

    // Fetch user status + team-scoped spaces in parallel.
    const [usersResult, spacesResult] = await Promise.all([
      supabase.from('User').select('id, status').in('id', userIds),
      supabase
        .from('Space')
        .select('id, ownerId, teamId')
        .in('ownerId', userIds)
        .eq('teamId', teamId),
    ]);

    let userRows: Array<{ id: string; status?: string | null }> = [];
    if (usersResult.error) {
      // If the status column doesn't exist yet, retry without it — we
      // simply treat everyone as active.
      const code = (usersResult.error as { code?: string }).code;
      if (code === '42703') {
        const { data: usersNoStatus, error: retryErr } = await supabase
          .from('User')
          .select('id')
          .in('id', userIds);
        if (retryErr) {
          logger.warn('[team-routing] failed to fetch users (fallback)', { teamId }, retryErr);
          return [];
        }
        userRows = (usersNoStatus ?? []).map(
          (u: unknown) => ({ ...(u as { id: string }), status: null }),
        );
      } else {
        logger.warn('[team-routing] failed to fetch users', { teamId }, usersResult.error);
        return [];
      }
    } else {
      userRows = (usersResult.data ?? []) as Array<{ id: string; status?: string | null }>;
    }

    if (spacesResult.error) {
      logger.warn('[team-routing] failed to fetch spaces', { teamId }, spacesResult.error);
      return [];
    }

    const activeUserIds = new Set<string>();
    for (const row of userRows) {
      if (row.status !== 'offboarded') activeUserIds.add(row.id);
    }

    const spaceByOwner = new Map<string, string>();
    for (const s of spacesResult.data ?? []) {
      const row = s as { id: string; ownerId: string };
      // If a user somehow has multiple spaces in this team, the
      // first one wins — the set is keyed by ownerId.
      if (!spaceByOwner.has(row.ownerId)) spaceByOwner.set(row.ownerId, row.id);
    }

    const eligible: EligibleAgent[] = [];
    for (const userId of userIds) {
      if (!activeUserIds.has(userId)) continue;
      const spaceId = spaceByOwner.get(userId);
      if (!spaceId) continue;
      eligible.push({ userId, spaceId });
    }

    eligible.sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    return eligible;
  } catch (err) {
    logger.error('[team-routing] unexpected error enumerating agents', { teamId }, err);
    return [];
  }
}

/**
 * Pick the agent AFTER `lastAssignedUserId` in the (already sorted)
 * candidate list. Wraps to index 0 if the cursor is null, not found,
 * or refers to the last element.
 */
function pickNextAfterCursor(
  candidates: EligibleAgent[],
  cursorUserId: string | null,
): EligibleAgent {
  if (candidates.length === 0) {
    throw new Error('pickNextAfterCursor called with empty candidates');
  }
  if (!cursorUserId) return candidates[0];
  const idx = candidates.findIndex((c) => c.userId === cursorUserId);
  if (idx === -1) return candidates[0];
  const next = candidates[(idx + 1) % candidates.length];
  return next;
}

/**
 * Fire-and-forget update of the round-robin cursor. Failures are logged
 * but never propagate — the routing decision has already been made.
 */
async function updateCursor(teamId: string, newCursorUserId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('Team')
      .update({ lastAssignedUserId: newCursorUserId })
      .eq('id', teamId);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '42703') {
        // Column doesn't exist yet. Silent.
        return;
      }
      logger.warn('[team-routing] cursor update failed', { teamId, newCursorUserId }, error);
    }
  } catch (err) {
    logger.warn('[team-routing] cursor update threw', { teamId, newCursorUserId }, err);
  }
}

/**
 * Count active lead-pipeline Contacts per agent space. "Active" means:
 *   - spaceId = agent.spaceId
 *   - type IN ('QUALIFICATION','DEMO','APPLICATION')
 *   - snoozedUntil IS NULL OR snoozedUntil < now()
 *
 * Returns a map keyed by spaceId. Missing entries imply zero.
 */
async function countActiveLeadsBySpace(spaceIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (spaceIds.length === 0) return counts;

  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('Contact')
      .select('spaceId, snoozedUntil')
      .in('spaceId', spaceIds)
      .in('type', ['QUALIFICATION', 'DEMO', 'APPLICATION']);

    if (error) {
      logger.warn('[team-routing] contact count query failed; treating all counts as 0', {}, error);
      return counts;
    }

    for (const row of data ?? []) {
      const r = row as { spaceId: string; snoozedUntil: string | null };
      if (r.snoozedUntil && r.snoozedUntil >= nowIso) continue;
      counts.set(r.spaceId, (counts.get(r.spaceId) ?? 0) + 1);
    }
  } catch (err) {
    logger.warn('[team-routing] contact count threw; treating all counts as 0', {}, err);
  }

  return counts;
}

/**
 * Run round-robin selection over an arbitrary pool (already filtered to
 * eligible agents), honouring the Team round-robin cursor for stability.
 */
function pickRoundRobin(
  pool: EligibleAgent[],
  cursor: string | null,
): EligibleAgent {
  return pickNextAfterCursor(pool, cursor);
}

/**
 * Run score-based selection over an arbitrary pool. Mirrors the top-level
 * score_based branch: min-load first, cursor tiebreak.
 */
async function pickScoreBased(
  pool: EligibleAgent[],
  cursor: string | null,
): Promise<EligibleAgent> {
  const counts = await countActiveLeadsBySpace(pool.map((a) => a.spaceId));
  let minCount = Number.POSITIVE_INFINITY;
  for (const a of pool) {
    const c = counts.get(a.spaceId) ?? 0;
    if (c < minCount) minCount = c;
  }
  const tied = pool.filter((a) => (counts.get(a.spaceId) ?? 0) === minCount);
  return pickNextAfterCursor(tied, cursor);
}

/**
 * Try to resolve a rule into a concrete agent. Returns null when the
 * rule's destination is not eligible (specific agent offboarded / no
 * longer in this team / no space; or the pool is empty) — the
 * caller should treat null as "skip this rule, move to the next".
 *
 * eligible: pre-computed active rep pool for this team, passed
 * in so we don't re-query the DB per rule.
 */
async function resolveRuleDestination(
  rule: DealRoutingRuleRow,
  eligible: EligibleAgent[],
  cursor: string | null,
): Promise<EligibleAgent | null> {
  // Destination A: specific agent
  if (rule.destinationUserId) {
    const match = eligible.find((a) => a.userId === rule.destinationUserId);
    if (!match) {
      logger.info('[team-routing] rule destination agent ineligible; skipping rule', {
        ruleId: rule.id,
        destinationUserId: rule.destinationUserId,
      });
      return null;
    }
    return match;
  }

  // Destination B: pool method. destinationPoolTag is *accepted* by the
  // schema but IGNORED at the engine level until TeamMembership
  // grows a tags column — see migration header for the TODO.
  if (rule.destinationPoolMethod) {
    if (rule.destinationPoolTag) {
      logger.debug('[team-routing] destinationPoolTag present but ignored (no tags column yet)', {
        ruleId: rule.id,
        destinationPoolTag: rule.destinationPoolTag,
      });
    }
    const pool = eligible;
    if (pool.length === 0) return null;

    if (rule.destinationPoolMethod === 'round_robin') {
      return pickRoundRobin(pool, cursor);
    }
    return pickScoreBased(pool, cursor);
  }

  // Should be unreachable thanks to the XOR CHECK constraint, but guard
  // anyway so a corrupt row can't take routing down.
  logger.warn('[team-routing] rule has neither destinationUserId nor destinationPoolMethod', {
    ruleId: rule.id,
  });
  return null;
}

/**
 * Pick which rep_member should receive a new lead for this team.
 * Returns null when:
 *   - autoAssignEnabled is false
 *   - assignmentMethod is 'manual' AND no rule with criteria matches
 *   - no eligible agent (zero active rep_members OR none has a Space
 *     inside this team)
 * Callers should fall back to the manager owner's space when null.
 *
 * BP7d behaviour: enabled DealRoutingRule rows are evaluated first, in
 * priority ASC order. The first rule whose criteria matches the `lead`
 * AND whose destination resolves to an eligible agent wins. If no rule
 * matches (or every matching rule's destination is ineligible), the
 * engine falls through to the legacy assignmentMethod behaviour.
 *
 * Pre-migration resilience: if the new columns/tables don't exist yet,
 * the auto-assign path is treated as disabled and rules as [] — the null
 * return keeps every caller safe.
 */
export async function routeTeamLead(
  teamId: string,
  lead?: RoutingLeadInput,
): Promise<RoutingResult | null> {
  try {
    const config = await loadTeamRoutingConfig(teamId);
    if (!config) return null;
    if (!config.autoAssignEnabled) return null;

    // Short-circuit: when the caller omits a lead AND the method is
    // 'manual', we can skip the agent-enumeration and rules loads
    // entirely — neither can produce a routing result in that case.
    // This keeps BP7b's query footprint intact for the no-arg path.
    if (!lead && config.assignmentMethod === 'manual') return null;

    // Eligible pool is needed by both the rules layer AND the fallback,
    // so compute once.
    const agents = await getEligibleAgents(teamId);
    if (agents.length === 0) {
      logger.info('[team-routing] no eligible agents; caller falls back to owner space', {
        teamId,
        method: config.assignmentMethod,
      });
      return null;
    }

    // ── Rules layer (BP7d) ─────────────────────────────────────────────
    // Only evaluate rules when the caller actually passed a lead. Without
    // lead input, no rule with criteria can match, and a catch-all rule
    // (no criteria) would surprise BP7b-era callers that don't know the
    // rules layer exists. Safer to preserve legacy behaviour for the
    // no-arg call.
    if (lead) {
      const rules = await loadEnabledRules(teamId);
      for (const rule of rules) {
        if (!ruleMatches(rule, lead)) continue;

        const picked = await resolveRuleDestination(rule, agents, config.lastAssignedUserId);
        if (!picked) continue; // fall through to next rule

        void updateCursor(teamId, picked.userId);
        logger.info('[team-routing] rule match', {
          teamId,
          ruleId: rule.id,
          ruleName: rule.name,
          pickedUserId: picked.userId,
          destinationKind: rule.destinationUserId ? 'agent' : 'pool',
          poolMethod: rule.destinationPoolMethod,
        });
        return {
          agentUserId: picked.userId,
          agentSpaceId: picked.spaceId,
          method: 'rule',
          ruleId: rule.id,
        };
      }
    }

    // ── Legacy assignmentMethod fallback ───────────────────────────────
    // With a lead passed and method=manual, the rules layer had a chance
    // to match — if none did, fall back to null (no routing).
    if (config.assignmentMethod === 'manual') return null;

    if (config.assignmentMethod === 'round_robin') {
      const picked = pickRoundRobin(agents, config.lastAssignedUserId);
      void updateCursor(teamId, picked.userId);
      logger.info('[team-routing] round-robin pick', {
        teamId,
        pickedUserId: picked.userId,
        pool: agents.length,
        cursor: config.lastAssignedUserId,
      });
      return {
        agentUserId: picked.userId,
        agentSpaceId: picked.spaceId,
        method: 'round_robin',
        ruleId: null,
      };
    }

    // score_based
    const picked = await pickScoreBased(agents, config.lastAssignedUserId);
    void updateCursor(teamId, picked.userId);
    logger.info('[team-routing] score-based pick', {
      teamId,
      pickedUserId: picked.userId,
      pool: agents.length,
    });
    return {
      agentUserId: picked.userId,
      agentSpaceId: picked.spaceId,
      method: 'score_based',
      ruleId: null,
    };
  } catch (err) {
    logger.error('[team-routing] unexpected failure; returning null', { teamId }, err);
    return null;
  }
}
