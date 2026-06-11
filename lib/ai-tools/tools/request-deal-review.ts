/**
 * `request_deal_review` — flag a deal for manager sign-off.
 *
 * Approval-gated. Team-only — solo agents (no Space.teamId)
 * get a clean error.
 *
 * Inserts a DealReviewRequest row matching the schema in migration
 * 20260510000000_deal_review_requests.sql. The partial unique index
 * `idx_dealreview_open_per_deal` enforces at most one OPEN review per
 * deal; we surface that as a friendly "already pending" message rather
 * than a Postgres error.
 */

import crypto from 'crypto';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { defineTool } from '../types';

const parameters = z
  .object({
    dealId: z.string().min(1).describe('The Deal.id to flag for review.'),
    reason: z
      .string()
      .trim()
      .min(10)
      .max(1000)
      .describe('Why the manager should look at this deal. Surfaces verbatim.'),
  })
  .describe('Flag a deal for manager review.');

interface RequestDealReviewResult {
  dealId: string;
  reviewId: string;
  status: 'open' | 'duplicate';
}

export const requestDealReviewTool = defineTool<typeof parameters, RequestDealReviewResult>({
  name: 'request_deal_review',
  riskLevel: 'low',
  description:
    "Team-only. Flag a deal for the manager's review queue. Prompts for approval first.",
  parameters,
  requiresApproval: true,
  rateLimit: { max: 20, windowSeconds: 3600 },
  summariseCall(args) {
    const slug =
      typeof args?.dealId === 'string' && args.dealId.length > 0
        ? args.dealId.slice(0, 8)
        : 'deal';
    return `Request a review of deal ${slug}`;
  },

  async handler(args, ctx) {
    const { data: deal, error: dealErr } = await supabase
      .from('Deal')
      .select('id, title')
      .eq('id', args.dealId)
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    if (dealErr) {
      return { summary: `Deal lookup failed: ${dealErr.message}`, display: 'error' };
    }
    if (!deal) {
      return { summary: `No deal with id "${args.dealId}".`, display: 'error' };
    }

    const { data: space, error: spaceErr } = await supabase
      .from('Space')
      .select('id, ownerId, teamId')
      .eq('id', ctx.space.id)
      .maybeSingle();
    if (spaceErr) {
      return { summary: `Workspace lookup failed: ${spaceErr.message}`, display: 'error' };
    }
    const teamId = (space as { teamId: string | null } | null)?.teamId ?? null;
    if (!teamId) {
      return {
        summary: 'Review requests need a team — this is a solo workspace.',
        display: 'error',
      };
    }

    // Check for an existing open review on this deal (the partial unique
    // index would block the insert anyway; surface the duplicate cleanly).
    const { data: existing } = await supabase
      .from('DealReviewRequest')
      .select('id')
      .eq('dealId', args.dealId)
      .eq('status', 'open')
      .maybeSingle();
    if (existing) {
      return {
        summary: `"${deal.title}" already has an open review request.`,
        data: {
          dealId: args.dealId,
          reviewId: (existing as { id: string }).id,
          status: 'duplicate',
        },
        display: 'plain',
      };
    }

    const reviewId = crypto.randomUUID();
    const ownerId = (space as { ownerId: string }).ownerId;
    const { error: insertErr } = await supabase.from('DealReviewRequest').insert({
      id: reviewId,
      dealId: args.dealId,
      requestingUserId: ownerId,
      teamId,
      status: 'open',
      reason: args.reason.trim(),
    });
    if (insertErr) {
      logger.error(
        '[tools.request_deal_review] insert failed',
        { dealId: args.dealId },
        insertErr,
      );
      return { summary: `Couldn't open the review: ${insertErr.message}`, display: 'error' };
    }

    return {
      summary: `Requested a review of the ${deal.title} deal.`,
      data: { dealId: args.dealId, reviewId, status: 'open' },
      display: 'success',
    };
  },
});
