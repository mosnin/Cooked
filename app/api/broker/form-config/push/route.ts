import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getBrokerMemberContext } from '@/lib/permissions';
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
 * POST /api/broker/form-config/push
 *
 * Fan the brokerage's standard rental + buyer intake forms out to every
 * realtor_member's per-space form config (SpaceSetting.rentalFormConfig /
 * SpaceSetting.buyerFormConfig). Mirrors the proven fan-out discipline of
 * /api/broker/templates/[id]/publish:
 *
 *   - Owner/admin only (same gate as the sibling form-config route).
 *   - Members resolved via BrokerageMembership(role = realtor_member),
 *     then their Space SCOPED to this brokerageId so a dual-membership
 *     realtor's Space in another brokerage is never touched (cross-tenant
 *     leak guard, copied from the publish route).
 *   - A member who has locally customized their own form
 *     (SpaceSetting.formConfigSource = 'custom') is SKIPPED — we never
 *     silently stomp an agent's customisations. Everyone else is
 *     overwritten with the brokerage standard and stamped
 *     formConfigSource = 'brokerage'.
 *   - Members with no Space in this brokerage are counted as skipped.
 *
 * The brokerage configs are read server-side from the Brokerage row (the
 * source of truth that PUT /api/broker/form-config writes), not trusted
 * from the request body — the body's configs are validated and used only
 * as a fallback if a column is null (e.g. the broker pushed before saving).
 *
 * Supabase-js has no multi-statement transaction, so this is a best-effort
 * sequence of per-space writes. One member's failure is logged and counted
 * as a skip, never aborts the rest — partial success is still useful and
 * the broker can re-push to retry.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId: clerkId } = await auth();

  const ctx = await getBrokerMemberContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (ctx.membership.role !== 'broker_owner' && ctx.membership.role !== 'broker_admin') {
    return NextResponse.json(
      { error: 'Only the owner or admins can push forms to members' },
      { status: 403 },
    );
  }

  // Rate limit: 10 pushes per hour per brokerage (matches the sibling PUT).
  const { allowed } = await checkRateLimit(`broker-form-config:push:${ctx.brokerage.id}`, 10, 3600);
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
    // No body is fine — we read the brokerage configs from the DB below.
  }
  const bodyRental = formConfigSchema.safeParse(body.rentalFormConfig);
  const bodyBuyer = formConfigSchema.safeParse(body.buyerFormConfig);

  // 1. Load the brokerage's current standard forms (source of truth).
  const { data: brokerage, error: loadErr } = await supabase
    .from('Brokerage')
    .select('id, brokerageFormConfig, brokerageRentalFormConfig, brokerageBuyerFormConfig')
    .eq('id', ctx.brokerage.id)
    .maybeSingle();

  if (loadErr) {
    logger.error('[broker/form-config/push] load failed', { brokerageId: ctx.brokerage.id }, loadErr);
    return NextResponse.json({ error: 'Failed to load brokerage form config' }, { status: 500 });
  }

  // Resolve rental: DB column -> legacy column -> validated request body.
  let rentalFormConfig =
    brokerage?.brokerageRentalFormConfig ?? brokerage?.brokerageFormConfig ?? null;
  if (!rentalFormConfig && bodyRental.success) {
    rentalFormConfig = bodyRental.data;
  }
  let buyerFormConfig = brokerage?.brokerageBuyerFormConfig ?? null;
  if (!buyerFormConfig && bodyBuyer.success) {
    buyerFormConfig = bodyBuyer.data;
  }

  if (!rentalFormConfig && !buyerFormConfig) {
    return NextResponse.json(
      { error: 'No brokerage form config to push. Save a rental or buyer form first.' },
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

  // 2. Enumerate realtor_member userIds for this brokerage.
  const { data: memberships, error: memberErr } = await supabase
    .from('BrokerageMembership')
    .select('userId')
    .eq('brokerageId', ctx.brokerage.id)
    .eq('role', 'realtor_member')
    .returns<MembershipRow[]>();

  if (memberErr) {
    logger.error('[broker/form-config/push] member fetch failed', { brokerageId: ctx.brokerage.id }, memberErr);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }

  const agentUserIds = Array.from(
    new Set(((memberships ?? []) as MembershipRow[]).map((m) => m.userId)),
  );

  let pushed = 0;
  let skipped = 0;

  if (agentUserIds.length > 0) {
    // 3. Resolve each agent's Space, SCOPED to this brokerage so a
    //    dual-membership realtor's Space elsewhere is never written.
    const { data: spaces, error: spaceErr } = await supabase
      .from('Space')
      .select('id, ownerId')
      .in('ownerId', agentUserIds)
      .eq('brokerageId', ctx.brokerage.id)
      .returns<SpaceRow[]>();

    if (spaceErr) {
      logger.error('[broker/form-config/push] space fetch failed', { brokerageId: ctx.brokerage.id }, spaceErr);
      return NextResponse.json({ error: 'Failed to load agent spaces' }, { status: 500 });
    }

    const spaceRows = (spaces ?? []) as SpaceRow[];
    const ownersWithSpace = new Set(spaceRows.map((s) => s.ownerId));

    // Members with no Space in this brokerage — count one skip each.
    for (const userId of agentUserIds) {
      if (!ownersWithSpace.has(userId)) {
        skipped += 1;
        logger.warn('[broker/form-config/push] agent has no space; skipped', { userId });
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
        logger.error('[broker/form-config/push] settings fetch failed', { brokerageId: ctx.brokerage.id }, settingErr);
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
          logger.info('[broker/form-config/push] skipped (locally customized)', {
            spaceId: space.id,
          });
          continue;
        }

        if (setting) {
          const { error: updateErr } = await supabase
            .from('SpaceSetting')
            .update({ ...configUpdate, formConfigSource: 'brokerage' })
            .eq('spaceId', space.id);
          if (updateErr) {
            skipped += 1;
            logger.error('[broker/form-config/push] update failed', { spaceId: space.id }, updateErr);
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
              formConfigSource: 'brokerage',
            });
          if (insertErr) {
            skipped += 1;
            logger.error('[broker/form-config/push] insert failed', { spaceId: space.id }, insertErr);
          } else {
            pushed += 1;
          }
        }
      } catch (err) {
        skipped += 1;
        logger.error('[broker/form-config/push] unexpected error for space', { spaceId: space.id }, err);
      }
    }
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'Brokerage',
    resourceId: ctx.brokerage.id,
    req,
    metadata: {
      brokerageId: ctx.brokerage.id,
      event: 'form-config-push',
      pushedRental: !!rentalFormConfig,
      pushedBuyer: !!buyerFormConfig,
      pushed,
      skipped,
    },
  });

  return NextResponse.json({ pushed, skipped });
}
