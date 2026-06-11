import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { getManagerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import {
  RULE_COLUMNS,
  applyRuleInvariants,
  nameField,
  priorityField,
  leadTypeField,
  budgetField,
  matchTagField,
  destinationUserIdField,
  destinationPoolMethodField,
  destinationPoolTagField,
  type DealRoutingRuleRow,
} from '@/lib/routing-rule-schema';

const createSchema = z
  .object({
    name: nameField,
    priority: priorityField.default(100),
    enabled: z.boolean().default(true),
    leadType: leadTypeField.default(null),
    minBudget: budgetField.default(null),
    maxBudget: budgetField.default(null),
    matchTag: matchTagField.default(null),
    destinationUserId: destinationUserIdField.default(null),
    destinationPoolMethod: destinationPoolMethodField.default(null),
    destinationPoolTag: destinationPoolTagField.default(null),
  })
  .superRefine(applyRuleInvariants);

// ── GET — any manager member may read their team's rules ──────────────────

/**
 * GET /api/manager/routing-rules
 *
 * Returns the team's routing rules ordered by priority ASC then
 * createdAt ASC — the same order the engine evaluates them in. Any
 * team member can read (helpful for debugging / transparency into
 * which rule fired). Only owner/admin may mutate (POST/PATCH/DELETE).
 */
export async function GET(): Promise<NextResponse> {
  const ctx = await getManagerMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('DealRoutingRule')
    .select(RULE_COLUMNS)
    .eq('teamId', ctx.team.id)
    .order('priority', { ascending: true })
    .order('createdAt', { ascending: true });

  if (error) {
    const code = (error as { code?: string }).code;
    // 42P01 = undefined_table — migration not applied. Return [] so the
    // UI can render an empty state instead of an error.
    if (code === '42P01') {
      return NextResponse.json([]);
    }
    logger.error(
      '[manager/routing-rules/GET] list failed',
      { teamId: ctx.team.id },
      error,
    );
    return NextResponse.json({ error: 'Failed to load routing rules' }, { status: 500 });
  }

  return NextResponse.json((data ?? []) as DealRoutingRuleRow[]);
}

// ── POST — create a new rule (manager_owner / manager_admin only) ───────────────

/**
 * POST /api/manager/routing-rules
 *
 * Creates a rule for the current team. See the migration header for
 * the evaluation model. Destination must be EXACTLY one of a specific
 * agent (destinationUserId) or a pool method (destinationPoolMethod).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId: clerkId } = await auth();

  const ctx = await getManagerMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.membership.role !== 'manager_owner' && ctx.membership.role !== 'manager_admin') {
    return NextResponse.json(
      { error: 'Only the owner or admins can create routing rules' },
      { status: 403 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid data', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // If destinationUserId is set, verify the user actually belongs to THIS
  // team — otherwise we'd accept cross-tenant IDs. We don't require
  // the target to be a rep_member (owners can legitimately want a
  // VIP rule that points at themselves) but we DO require team
  // membership.
  if (data.destinationUserId) {
    const { data: membership, error: memErr } = await supabase
      .from('TeamMembership')
      .select('userId, role')
      .eq('teamId', ctx.team.id)
      .eq('userId', data.destinationUserId)
      .maybeSingle();
    if (memErr) {
      logger.error(
        '[manager/routing-rules/POST] destination membership check failed',
        { teamId: ctx.team.id, destinationUserId: data.destinationUserId },
        memErr,
      );
      return NextResponse.json({ error: 'Failed to verify destination agent' }, { status: 500 });
    }
    if (!membership) {
      return NextResponse.json(
        { error: 'destinationUserId is not a member of this team' },
        { status: 400 },
      );
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('DealRoutingRule')
    .insert({
      teamId: ctx.team.id,
      name: data.name,
      priority: data.priority,
      enabled: data.enabled,
      leadType: data.leadType,
      minBudget: data.minBudget,
      maxBudget: data.maxBudget,
      matchTag: data.matchTag,
      destinationUserId: data.destinationUserId,
      destinationPoolMethod: data.destinationPoolMethod,
      destinationPoolTag: data.destinationPoolTag,
    })
    .select(RULE_COLUMNS)
    .single<DealRoutingRuleRow>();

  if (insertErr || !inserted) {
    logger.error(
      '[manager/routing-rules/POST] insert failed',
      { teamId: ctx.team.id },
      insertErr,
    );
    return NextResponse.json({ error: 'Failed to create routing rule' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'CREATE',
    resource: 'DealRoutingRule',
    resourceId: inserted.id,
    req,
    metadata: {
      teamId: ctx.team.id,
      name: inserted.name,
      priority: inserted.priority,
      destinationKind: inserted.destinationUserId ? 'agent' : 'pool',
    },
  });

  return NextResponse.json(inserted, { status: 201 });
}
