/**
 * POST /api/agent/rescore-contact
 *
 * Internal endpoint — called by the Modal agent to trigger a fresh AI
 * lead score for a contact. Secured with AGENT_INTERNAL_SECRET.
 *
 * Reuses the exact same scoring logic as the UI rescore button to ensure
 * consistency between human-triggered and agent-triggered rescores.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { scoreLeadApplicationDynamic } from '@/lib/lead-scoring';
import { assertCanSpend, chargeWorkflow, CreditsExhaustedError } from '@/lib/billing/meter';
import type { Contact, IntakeFormConfig } from '@/lib/types';
import type { ScoringModel } from '@/lib/scoring/scoring-model-types';

const AGENT_INTERNAL_SECRET = process.env.AGENT_INTERNAL_SECRET ?? '';

export async function POST(req: NextRequest) {
  // Fail loudly on missing secret — misconfiguration should be caught immediately
  if (!AGENT_INTERNAL_SECRET) {
    console.error('[agent/rescore-contact] AGENT_INTERNAL_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 503 });
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${AGENT_INTERNAL_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { contactId, spaceId } = body;

  if (!contactId || !spaceId) {
    return NextResponse.json({ error: 'contactId and spaceId required' }, { status: 400 });
  }

  const { data: rows, error: fetchError } = await supabase
    .from('Contact')
    .select('*')
    .eq('id', contactId)
    .eq('spaceId', spaceId);

  if (fetchError || !rows?.length) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  const contact = rows[0] as Contact;

  // Skip contacts with no scoreable data
  if (!contact.applicationData && !contact.formConfigSnapshot) {
    return NextResponse.json({ skipped: true, reason: 'No application data to score' });
  }

  // Skip if already pending
  if (contact.scoringStatus === 'pending') {
    return NextResponse.json({ skipped: true, reason: 'Already scoring' });
  }

  // Meter the AI work — this autonomous path runs the SAME scoreLeadApplicationDynamic
  // as the metered UI rescore button, so it must charge the same 'lead_score' credit.
  // Without this the highest-volume scoring path (Chippi auto-rescores on triggers +
  // sweeps) ran completely free. No-op unless CREDITS_ENFORCED.
  try {
    await assertCanSpend(spaceId, 'lead_score');
  } catch (err) {
    if (err instanceof CreditsExhaustedError) {
      return NextResponse.json({ skipped: true, reason: 'Out of credits' }, { status: 402 });
    }
    throw err;
  }

  // Every write below is double-scoped by (id, spaceId). The SELECT above
  // already proved this contact lives in this spaceId, but a future code
  // path that drops the SELECT can't reach across tenants if the writes
  // themselves are also scoped. Treat the bearer secret as proving "this
  // caller is Modal" — never as proving "this payload's spaceId is what
  // Modal was originally authorized for."
  await supabase
    .from('Contact')
    .update({ scoringStatus: 'pending' })
    .eq('id', contactId)
    .eq('spaceId', spaceId);

  const formConfig = (contact as Record<string, unknown>).formConfigSnapshot as IntakeFormConfig | null ?? null;
  const resolvedLeadType = contact.leadType || (contact as Record<string, unknown>).formLeadType as string || 'rental';

  let scoringModel: ScoringModel | null = null;
  if (formConfig) {
    const col = resolvedLeadType === 'buyer' ? 'buyerScoringModel' : 'rentalScoringModel';
    const { data: ss } = await supabase
      .from('SpaceSetting')
      .select(col)
      .eq('spaceId', spaceId)
      .maybeSingle();
    if (ss) scoringModel = (ss as Record<string, unknown>)[col] as ScoringModel | null;
  }

  const applicationData = contact.applicationData as Record<string, unknown> | null;

  try {
    const result = await scoreLeadApplicationDynamic({
      contactId,
      formConfig,
      answers: formConfig && applicationData
        ? (applicationData as Record<string, string | string[] | number | boolean>)
        : undefined,
      scoringModel,
      name: contact.name,
      email: contact.email,
      phone: contact.phone ?? '',
      budget: contact.budget,
      applicationData: !formConfig
        ? (applicationData as (Record<string, unknown> & { legalName: string }) | null)
        : undefined,
      leadType: resolvedLeadType as 'rental' | 'buyer',
    });

    await supabase
      .from('Contact')
      .update({
        scoringStatus: result.scoringStatus,
        leadScore: result.leadScore,
        scoreLabel: result.scoreLabel,
        scoreSummary: result.scoreSummary,
        scoreDetails: result.scoreDetails,
        updatedAt: new Date().toISOString(),
      })
      .eq('id', contactId)
      .eq('spaceId', spaceId);

    // Charge only after a successful score (best-effort; never blocks the result).
    await chargeWorkflow(spaceId, 'lead_score');

    return NextResponse.json({ success: true, score: result.leadScore, label: result.scoreLabel });
  } catch {
    await supabase
      .from('Contact')
      .update({ scoringStatus: 'failed', updatedAt: new Date().toISOString() })
      .eq('id', contactId)
      .eq('spaceId', spaceId);
    return NextResponse.json({ error: 'Scoring failed' }, { status: 500 });
  }
}
