/**
 * `analyze_rep` — manager-only performance read on one rep's pipeline.
 *
 * Read-only. Gated identically to `summarize_rep`: the caller must hold a
 * manager_owner / manager_admin TeamMembership, and the target rep must
 * belong to one of the caller's teams. The check operates on `ctx.userId`
 * (Clerk) rather than going through `auth()` since tools have ctx pre-resolved.
 *
 * Unlike `summarize_rep` (a recent-activity rollup), this tool answers
 * "how is this rep performing, and where do their deals stall?" It pulls
 * the rep's full deal history plus their DealStages and runs them through
 * the pure metrics in `lib/deal-metrics.ts`:
 *   - average time-to-close (won deals)
 *   - conversion rate (won vs lost)
 *   - per-stage bottlenecks (worst stalling stage among active deals)
 *
 * The metrics return null on insufficient data; the summary degrades to plain
 * language ("not enough closed deals to gauge time-to-close yet.") rather than
 * a misleading zero.
 */

import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { defineTool } from '../types';
import {
  avgTimeToCloseDays,
  conversionRate,
  stageBottlenecks,
  type DealMetricRow,
  type StageMetricRow,
} from '@/lib/deal-metrics';

const parameters = z
  .object({
    repUserId: z.string().min(1).describe('User.id of the rep to analyze.'),
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe('Optional lookback window in days. Omit to analyze the rep\'s full deal history.'),
  })
  .describe(
    'Analyze one rep\'s pipeline performance and find where their deals stall. Manager access required.',
  );

interface AnalyzeRepResult {
  rep: { name: string | null; email: string };
  windowDays: number | null;
  deals: { active: number; won: number; lost: number; total: number };
  avgTimeToCloseDays: number | null;
  conversionRate: number | null;
  worstStage: {
    stageId: string;
    stageName: string;
    count: number;
    avgAgeDays: number;
  } | null;
  stages: Array<{
    stageId: string;
    stageName: string;
    count: number;
    avgAgeDays: number;
  }>;
}

export const analyzeRepTool = defineTool<typeof parameters, AnalyzeRepResult>({
  name: 'analyze_rep',
  riskLevel: 'safe',
  description:
    'Manager-only. Analyze one rep\'s pipeline performance: average time-to-close, conversion rate, and the stage where their deals stall most.',
  parameters,
  requiresApproval: false,
  // Read-only, but heavier than a rollup: it scans the rep's full deal
  // history per call. A per-hour cap bounds repeated manager fan-out without
  // getting in the way of normal analysis.
  rateLimit: { max: 30, windowSeconds: 3600 },

  async handler(args, ctx) {
    // ── Caller must be manager_owner / manager_admin somewhere ────────────────
    const { data: callerUser } = await supabase
      .from('User')
      .select('id')
      .eq('clerkId', ctx.userId)
      .maybeSingle();
    if (!callerUser) {
      return { summary: 'Manager access required.', display: 'error' };
    }
    const { data: callerMemberships } = await supabase
      .from('TeamMembership')
      .select('teamId, role')
      .eq('userId', (callerUser as { id: string }).id)
      .in('role', ['manager_owner', 'manager_admin']);
    const callerTeamIds = new Set(
      ((callerMemberships ?? []) as Array<{ teamId: string }>).map((m) => m.teamId),
    );
    if (callerTeamIds.size === 0) {
      return { summary: 'Manager access required.', display: 'error' };
    }

    // ── Rep must be in one of the caller's teams ───────────────────
    const { data: repMembership } = await supabase
      .from('TeamMembership')
      .select('teamId, userId')
      .eq('userId', args.repUserId)
      .maybeSingle();
    if (!repMembership) {
      return { summary: 'That user is not a team member.', display: 'error' };
    }
    if (!callerTeamIds.has((repMembership as { teamId: string }).teamId)) {
      return { summary: 'Manager access required for that rep.', display: 'error' };
    }

    // ── Fetch rep profile + their space ────────────────────────────────
    const [{ data: rep }, { data: space }] = await Promise.all([
      supabase
        .from('User')
        .select('id, name, email')
        .eq('id', args.repUserId)
        .maybeSingle(),
      supabase
        .from('Space')
        .select('id')
        .eq('ownerId', args.repUserId)
        .maybeSingle(),
    ]);
    if (!rep) {
      return { summary: 'Rep not found.', display: 'error' };
    }
    if (!space) {
      return {
        summary: `${(rep as { name: string | null }).name ?? 'Rep'} has no workspace yet.`,
        display: 'error',
      };
    }
    const spaceId = (space as { id: string }).id;
    const profile = rep as { name: string | null; email: string };
    const who = profile.name ?? profile.email;

    // ── Pull the rep's deals + their stages (scoped to their space) ─────
    const windowDays = args.windowDays ?? null;
    let dealsQuery = supabase
      .from('Deal')
      .select('id, status, stageId, createdAt, closedAt, stageChangedAt')
      .eq('spaceId', spaceId);
    if (windowDays != null) {
      const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
      dealsQuery = dealsQuery.gte('createdAt', since);
    }

    const [dealsRes, stagesRes] = await Promise.all([
      dealsQuery,
      supabase.from('DealStage').select('id, name').eq('spaceId', spaceId),
    ]);

    const dealRows = (dealsRes.data ?? []) as DealMetricRow[];
    const stageRows = (stagesRes.data ?? []) as StageMetricRow[];

    const counts = {
      active: dealRows.filter((d) => d.status === 'active').length,
      won: dealRows.filter((d) => d.status === 'won').length,
      lost: dealRows.filter((d) => d.status === 'lost').length,
      total: dealRows.length,
    };

    const avgClose = avgTimeToCloseDays(dealRows);
    const conv = conversionRate(dealRows);
    const bottlenecks = stageBottlenecks(dealRows, stageRows);

    const result: AnalyzeRepResult = {
      rep: { name: profile.name, email: profile.email },
      windowDays,
      deals: counts,
      avgTimeToCloseDays: avgClose,
      conversionRate: conv,
      worstStage: bottlenecks.worstStage,
      stages: bottlenecks.stages,
    };

    // ── Natural-language read, degrading gracefully on null metrics ─────────
    if (counts.total === 0) {
      return {
        summary: windowDays
          ? `${who} has no deals in the last ${windowDays} days yet.`
          : `${who} has no deals yet.`,
        data: result,
        display: 'plain',
      };
    }

    const closeLine =
      avgClose == null
        ? 'not enough closed deals to gauge time-to-close yet'
        : `closes won deals in about ${Math.round(avgClose)} days on average`;

    const convLine =
      conv == null
        ? 'nothing has closed yet, so conversion is still unknown'
        : `converts ${Math.round(conv * 100)}% of closed deals to wins`;

    const stallLine = bottlenecks.worstStage
      ? `deals stall longest in "${bottlenecks.worstStage.stageName}" (${bottlenecks.worstStage.count} active, ~${Math.round(bottlenecks.worstStage.avgAgeDays)} days each)`
      : 'no active deals are stalling right now';

    const scope = windowDays ? ` over the last ${windowDays} days` : '';

    return {
      summary: `${who}${scope}: ${counts.active} active, ${counts.won} won, ${counts.lost} lost. They ${closeLine} and ${convLine}. Bottleneck: ${stallLine}.`,
      data: result,
      display: 'plain',
    };
  },
});
