import { NextRequest, NextResponse } from 'next/server';
import { requireManager, canEditSettings } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { formConfigSchema } from '@/lib/form-config-schema';
import { auth } from '@clerk/nextjs/server';
import { checkRateLimit } from '@/lib/rate-limit';

const MAX_FORM_CONFIG_SIZE = 512_000;
const MAX_TOTAL_QUESTIONS = 200;

/**
 * GET /api/manager/form-config
 * Returns BOTH rental and buyer team form configs.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: team, error } = await supabase
    .from('Team')
    .select('id, teamFormConfig, teamRentalFormConfig, teamBuyerFormConfig')
    .eq('id', ctx.team.id)
    .maybeSingle();

  if (error) {
    console.error('[manager/form-config] fetch failed', error);
    return NextResponse.json({ error: 'Failed to fetch form config' }, { status: 500 });
  }

  // Backwards compatibility: if rentalFormConfig is null but old teamFormConfig exists
  let rentalFormConfig = team?.teamRentalFormConfig ?? null;
  const buyerFormConfig = team?.teamBuyerFormConfig ?? null;

  if (!rentalFormConfig && team?.teamFormConfig) {
    rentalFormConfig = team.teamFormConfig;
  }

  return NextResponse.json({
    teamId: ctx.team.id,
    rentalFormConfig,
    buyerFormConfig,
  });
}

/**
 * PUT /api/manager/form-config
 * Validate and save a team-level form config.
 * Accepts { leadType: 'rental' | 'buyer', formConfig }
 */
export async function PUT(req: NextRequest) {
  const { userId: clerkId } = await auth();

  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!canEditSettings(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the owner or admins can update form config' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const leadType = body.leadType as string | undefined;
  if (!leadType || (leadType !== 'rental' && leadType !== 'buyer')) {
    return NextResponse.json({ error: 'leadType must be "rental" or "buyer"' }, { status: 400 });
  }

  // Validate the form config
  const parsed = formConfigSchema.safeParse(body.formConfig);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid form config', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const formConfig = parsed.data;

  // Rate limit: 10 updates per hour
  const { allowed } = await checkRateLimit(`manager-form-config:put:${ctx.team.id}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many form updates. Try again in a bit.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  // Size & question count limits
  const configSize = JSON.stringify(formConfig).length;
  if (configSize > MAX_FORM_CONFIG_SIZE) {
    return NextResponse.json({ error: `Form config exceeds ${MAX_FORM_CONFIG_SIZE} byte size limit` }, { status: 413 });
  }
  const totalQuestions = formConfig.sections.reduce((sum, s) => sum + s.questions.length, 0);
  if (totalQuestions > MAX_TOTAL_QUESTIONS) {
    return NextResponse.json({ error: `Form exceeds max ${MAX_TOTAL_QUESTIONS} questions` }, { status: 400 });
  }

  const column = leadType === 'rental' ? 'teamRentalFormConfig' : 'teamBuyerFormConfig';

  const { error: updateErr } = await supabase
    .from('Team')
    .update({ [column]: formConfig })
    .eq('id', ctx.team.id);

  if (updateErr) {
    console.error('[manager/form-config] update failed', updateErr);
    return NextResponse.json({ error: 'Failed to save form config' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'Team',
    resourceId: ctx.team.id,
    metadata: {
      field: column,
      leadType,
      sectionCount: formConfig.sections.length,
    },
  });

  return NextResponse.json({
    teamId: ctx.team.id,
    [column]: formConfig,
    leadType,
  });
}

/**
 * DELETE /api/manager/form-config
 * Reset one or both team form configs.
 * Accepts { leadType?: 'rental' | 'buyer' }
 */
export async function DELETE(req: NextRequest) {
  const { userId: clerkId } = await auth();

  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!canEditSettings(ctx.membership.role)) {
    return NextResponse.json(
      { error: 'Only the owner or admins can reset form config' },
      { status: 403 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // No body is OK — resets both
  }

  const leadType = body.leadType as string | undefined;

  const updates: Record<string, unknown> = {};
  if (!leadType || leadType === 'rental') {
    updates.teamRentalFormConfig = null;
  }
  if (!leadType || leadType === 'buyer') {
    updates.teamBuyerFormConfig = null;
  }
  if (!leadType) {
    updates.teamFormConfig = null; // Also clear legacy column
  }

  const { error: updateErr } = await supabase
    .from('Team')
    .update(updates)
    .eq('id', ctx.team.id);

  if (updateErr) {
    console.error('[manager/form-config] delete failed', updateErr);
    return NextResponse.json({ error: 'Failed to reset form config' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'Team',
    resourceId: ctx.team.id,
    metadata: {
      field: 'teamFormConfig',
      action: 'reset',
      leadType: leadType || 'both',
    },
  });

  return NextResponse.json({ success: true });
}
