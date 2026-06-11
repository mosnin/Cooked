import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getManagerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { formConfigSchema } from '@/lib/form-config-schema';
import { checkRateLimit } from '@/lib/rate-limit';

const MAX_FORM_CONFIG_SIZE = 512_000;
const MAX_TOTAL_QUESTIONS = 200;

type MembershipRow = { userId: string };
type SpaceRow = { id: string; ownerId: string };
type SpaceSettingRow = {
  id: string;
  spaceId: string;
  formConfigSource: string | null;
};

/**
 * POST /api/manager/form-config/push
 *
 * Fan the team's standard rental + buyer intake forms out to every
 * rep_member's per-space form config (SpaceSetting.rentalFormConfig /
 * SpaceSetting.buyerFormConfig). Mirrors the proven fan-out discipline of
 * /api/manager/templates/[id]/publish:
 *
 *   - Owner/admin only (same gate as the sibling form-config route).
 *   - Members resolved via TeamMembership(role = rep_member),
 *     then their Space SCOPED to this teamId so a dual-membership
 *     rep's Space in another team is never touched (cross-tenant
 *     leak guard, copied from the publish route).
 *   - A member who has locally customized their own form
 *     (SpaceSetting.formConfigSource = 'custom') is SKIPPED — we never
 *     silently stomp an agent's customisations. Everyone else is
 *     overwritten with the team standard and stamped
 *     formConfigSource = 'team'.
 *   - Members with no Space in this team are counted as skipped.
 *
 * The team configs are read server-side from the Team row (the
 * source of truth that PUT /api/manager/form-config writes), not trusted
 * from the request body — the body's configs are validated and used only
 * as a fallback if a column is null (e.g. the manager pushed before saving).
 *
 * Supabase-js has no multi-statement transaction, so this is a best-effort
 * sequence of per-space writes. One member's failure is logged and counted
 * as a skip, never aborts the rest — partial success is still useful and
 * the manager can re-push to retry.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId: clerkId } = await auth();

  const ctx = await getManagerMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.membership.role !== 'manager_owner' && ctx.membership.role !== 'manager_admin') {
    return NextResponse.json(
      { error: 'Only the owner or admins can push forms to members' },
      { status: 403 },
    );
  }

  // Rate limit: 10 pushes per hour per team (matches the sibling PUT).
  const { allowed } = await checkRateLimit(`manager-form-config:push:${ctx.team.id}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many pushes. Try again in a bit.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  // Optional body fallback — validate if present, ignore if garbage.
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine — we read the team configs from the DB below.
  }
  const bodyRental = formConfigSchema.safeParse(body.rentalFormConfig);
  const bodyBuyer = formConfigSchema.safeParse(body.buyerFormConfig);

  // 1. Load the team's current standard forms (source of truth).
  const { data: team, error: loadErr } = await supabase
    .from('Team')
    .select('id, teamFormConfig, teamRentalFormConfig, teamBuyerFormConfig')
    .eq('id', ctx.team.id)
    .maybeSingle();

  if (loadErr) {
    logger.error('[manager/form-config/push] load failed', { teamId: ctx.team.id }, loadErr);
    return NextResponse.json({ error: 'Failed to load team form config' }, { status: 500 });
  }

  // Resolve rental: DB column -> legacy column -> validated request body.
  let rentalFormConfig =
    team?.teamRentalFormConfig ?? team?.teamFormConfig ?? null;
  if (!rentalFormConfig && bodyRental.success) {
    rentalFormConfig = bodyRental.data;
  }
  let buyerFormConfig = team?.teamBuyerFormConfig ?? null;
  if (!buyerFormConfig && bodyBuyer.success) {
    buyerFormConfig = bodyBuyer.data;
  }

  if (!rentalFormConfig && !buyerFormConfig) {
    return NextResponse.json(
      { error: 'No team form config to push. Save a rental or buyer form first.' },
      { status: 400 },
    );
  }

  // Guard the same size/question limits the write routes enforce, so a
  // pathological config never lands in a member's space.
  for (const cfg of [rentalFormConfig, buyerFormConfig]) {
    if (!cfg) continue;
    if (JSON.stringify(cfg).length > MAX_FORM_CONFIG_SIZE) {
      return NextResponse.json(
        { error: `Form config exceeds ${MAX_FORM_CONFIG_SIZE} byte size limit` },
        { status: 413 },
      );
    }
    const totalQuestions = (cfg.sections ?? []).reduce(
      (sum: number, s: { questions: unknown[] }) => sum + s.questions.length,
      0,
    );
    if (totalQuestions > MAX_TOTAL_QUESTIONS) {
      return NextResponse.json(
        { error: `Form exceeds max ${MAX_TOTAL_QUESTIONS} questions` },
        { status: 400 },
      );
    }
  }

  // 2. Enumerate rep_member userIds for this team.
  const { data: memberships, error: memberErr } = await supabase
    .from('TeamMembership')
    .select('userId')
    .eq('teamId', ctx.team.id)
    .eq('role', 'rep_member')
    .returns<MembershipRow[]>();

  if (memberErr) {
    logger.error('[manager/form-config/push] member fetch failed', { teamId: ctx.team.id }, memberErr);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }

  const agentUserIds = Array.from(
    new Set(((memberships ?? []) as MembershipRow[]).map((m) => m.userId)),
  );

  let pushed = 0;
  let skipped = 0;

  if (agentUserIds.length > 0) {
    // 3. Resolve each agent's Space, SCOPED to this team so a
    //    dual-membership rep's Space elsewhere is never written.
    const { data: spaces, error: spaceErr } = await supabase
      .from('Space')
      .select('id, ownerId')
      .in('ownerId', agentUserIds)
      .eq('teamId', ctx.team.id)
      .returns<SpaceRow[]>();

    if (spaceErr) {
      logger.error('[manager/form-config/push] space fetch failed', { teamId: ctx.team.id }, spaceErr);
      return NextResponse.json({ error: 'Failed to load agent spaces' }, { status: 500 });
    }

    const spaceRows = (spaces ?? []) as SpaceRow[];
    const ownersWithSpace = new Set(spaceRows.map((s) => s.ownerId));

    // Members with no Space in this team — count one skip each.
    for (const userId of agentUserIds) {
      if (!ownersWithSpace.has(userId)) {
        skipped += 1;
        logger.warn('[manager/form-config/push] agent has no space; skipped', { userId });
      }
    }

    const targetSpaceIds = spaceRows.map((s) => s.id);

    // 4. Load existing SpaceSetting rows so we can (a) detect local
    //    customisation and (b) decide update-vs-insert per space.
    const settingBySpace = new Map<string, SpaceSettingRow>();
    if (targetSpaceIds.length > 0) {
      const { data: settings, error: settingErr } = await supabase
        .from('SpaceSetting')
        .select('id, spaceId, formConfigSource')
        .in('spaceId', targetSpaceIds)
        .returns<SpaceSettingRow[]>();

      if (settingErr) {
        logger.error('[manager/form-config/push] settings fetch failed', { teamId: ctx.team.id }, settingErr);
        return NextResponse.json({ error: 'Failed to load member settings' }, { status: 500 });
      }
      for (const row of settings ?? []) {
        settingBySpace.set(row.spaceId, row);
      }
    }

    // Columns to write — only push the configs that actually exist.
    const configUpdate: Record<string, unknown> = {};
    if (rentalFormConfig) configUpdate.rentalFormConfig = rentalFormConfig;
    if (buyerFormConfig) configUpdate.buyerFormConfig = buyerFormConfig;

    // 5. Sequential per-space writes, each isolated so one failure doesn't
    //    abandon the rest.
    for (const space of spaceRows) {
      try {
        const setting = settingBySpace.get(space.id);

        // Respect agent customisation — never stomp a custom form.
        if (setting && setting.formConfigSource === 'custom') {
          skipped += 1;
          logger.info('[manager/form-config/push] skipped (locally customized)', {
            spaceId: space.id,
          });
          continue;
        }

        if (setting) {
          const { error: updateErr } = await supabase
            .from('SpaceSetting')
            .update({ ...configUpdate, formConfigSource: 'team' })
            .eq('spaceId', space.id);
          if (updateErr) {
            skipped += 1;
            logger.error('[manager/form-config/push] update failed', { spaceId: space.id }, updateErr);
          } else {
            pushed += 1;
          }
        } else {
          const { error: insertErr } = await supabase
            .from('SpaceSetting')
            .insert({
              id: crypto.randomUUID(),
              spaceId: space.id,
              ...configUpdate,
              formConfigSource: 'team',
            });
          if (insertErr) {
            skipped += 1;
            logger.error('[manager/form-config/push] insert failed', { spaceId: space.id }, insertErr);
          } else {
            pushed += 1;
          }
        }
      } catch (err) {
        skipped += 1;
        logger.error('[manager/form-config/push] unexpected error for space', { spaceId: space.id }, err);
      }
    }
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'Team',
    resourceId: ctx.team.id,
    req,
    metadata: {
      teamId: ctx.team.id,
      event: 'form-config-push',
      pushedRental: !!rentalFormConfig,
      pushedBuyer: !!buyerFormConfig,
      pushed,
      skipped,
    },
  });

  return NextResponse.json({ pushed, skipped });
}
