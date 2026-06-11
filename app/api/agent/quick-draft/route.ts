/**
 * POST /api/agent/quick-draft
 *
 * The /chippi home's inline draft engine. Phase 7 — no more chat teleport.
 * The realtor taps "Send a check-in" on the home, this composes a draft
 * inline and returns it; the UI shows it; the realtor taps Send and the
 * existing AgentDraft → PATCH approve → sendDraft pipeline fires the email
 * (or SMS, or note). One surface, one tap, done.
 *
 * Two modes on one route — keeps the chat-prefill teleporter dead and the
 * file count honest:
 *
 *   • mode: 'preview' (default) — Looks up the deal/person, fetches a tight
 *     slice of recent activity, calls OpenAI to compose subject+body. Pure
 *     read; no DB writes. 5s timeout. Returns { channel, subject?, body }.
 *
 *   • mode: 'send' — Caller provides the (possibly edited) subject + body
 *     they saw. Inserts an AgentDraft (status: pending), reuses the
 *     existing PATCH endpoint's logic via direct sendDraft + status flip.
 *     Returns the delivery result.
 *
 * The OpenAI compose call lives in `lib/agent/quick-draft.ts` — both this
 * route AND the on-demand agent tools (`draft_email`, `draft_sms`) call
 * it. Next.js 15.5 enforces that route files only export the
 * runtime / config / HTTP-verb symbols, so the compose function CAN'T
 * live in a route module any longer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSpaceForUser } from '@/lib/space';
import { sendDraft, type DeliveryResult } from '@/lib/delivery';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { enrichContext, type EnrichedContext } from '@/lib/ai-tools/context-enrichment';
import {
  composeQuickDraft,
  type Channel,
  type Context,
  type Intent,
} from '@/lib/agent/quick-draft';

interface PreviewBody {
  mode?: 'preview';
  context: Context;
  id: string;
  intent: Intent;
}
interface SendBody {
  mode: 'send';
  context: Context;
  id: string;
  intent: Intent;
  channel: Channel;
  subject?: string;
  body: string;
}
type Body = PreviewBody | SendBody;

const ALLOWED_INTENTS: Intent[] = ['check-in', 'log-call', 'welcome', 'reach-out'];
const ALLOWED_CONTEXTS: Context[] = ['deal', 'person'];
const ALLOWED_CHANNELS: Channel[] = ['email', 'sms', 'note'];

/**
 * Map an intent to a channel. Log-call is always a note (internal record);
 * everything else is email — that's the realtor's primary outbound rail and
 * the only one the chat tool fires today. The realtor can always Edit →
 * chat to switch channels.
 */
function channelForIntent(intent: Intent): Channel {
  return intent === 'log-call' ? 'note' : 'email';
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const { allowed } = await checkRateLimit(`ai:quick-draft:${userId}`, 20, 60);
  if (!allowed) {
    return NextResponse.json(
      { error: 'too many requests. try again shortly.' },
      { status: 429, headers: { 'Retry-After': '60' } },
    );
  }

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || !ALLOWED_CONTEXTS.includes(body.context) || typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'context and id are required' }, { status: 400 });
  }
  if (!ALLOWED_INTENTS.includes(body.intent)) {
    return NextResponse.json({ error: 'unknown intent' }, { status: 400 });
  }

  const mode = body.mode ?? 'preview';

  // ── Resolve subject via the shared enrichContext helper. Phase 13:
  //    one query path, one shape — the same SUBJECT CONTEXT the agent loop
  //    sees. We also need contactId/dealId for the SEND branch, which the
  //    helper doesn't expose, so we keep one targeted lookup for the IDs.
  const enriched: EnrichedContext | null = await enrichContext(
    { kind: body.context, id: body.id },
    space.id,
  );
  if (!enriched) {
    return NextResponse.json(
      { error: body.context === 'deal' ? 'Deal not found' : 'Contact not found' },
      { status: 404 },
    );
  }

  let contactId: string | null = null;
  let dealId: string | null = null;

  if (body.context === 'deal') {
    const { data: deal } = await supabase
      .from('Deal')
      .select('id, contactId')
      .eq('id', body.id)
      .eq('spaceId', space.id)
      .maybeSingle();
    if (!deal) return NextResponse.json({ error: 'Deal not found' }, { status: 404 });
    dealId = (deal as { id: string }).id;
    contactId = ((deal as { contactId?: string | null }).contactId) ?? null;
  } else {
    contactId = body.id;
  }

  const subjectLabel = enriched.subjectLabel;

  // ── PREVIEW ──────────────────────────────────────────────────────────────
  if (mode === 'preview') {
    const channel = channelForIntent(body.intent);

    const composed = await composeQuickDraft({
      kind: body.context,
      id: body.id,
      intent: body.intent,
      channel,
      spaceId: space.id,
    });

    if (!composed) {
      return NextResponse.json({ error: 'compose_failed' }, { status: 502 });
    }

    return NextResponse.json({
      channel,
      subject: channel === 'email' ? composed.subject ?? `Quick check-in` : null,
      body: composed.body,
      contactId,
      dealId,
      subjectLabel,
    });
  }

  // ── SEND ─────────────────────────────────────────────────────────────────
  if (mode === 'send') {
    // Narrow the discriminated union — `mode === 'send'` was checked via the
    // local `mode` variable, which TS can't trace back to `body`. Cast once
    // here and let the validations below ensure the runtime shape.
    const sendBody = body as SendBody;
    if (!ALLOWED_CHANNELS.includes(sendBody.channel)) {
      return NextResponse.json({ error: 'invalid channel' }, { status: 400 });
    }
    if (typeof sendBody.body !== 'string' || sendBody.body.trim().length === 0) {
      return NextResponse.json({ error: 'body required' }, { status: 400 });
    }
    if (sendBody.channel === 'email' && (typeof sendBody.subject !== 'string' || !sendBody.subject.trim())) {
      return NextResponse.json({ error: 'subject required for email' }, { status: 400 });
    }

    // Insert an AgentDraft so the artifact exists in the same audit trail
    // as agent-generated drafts. Approving it would normally go through
    // PATCH /api/agent/drafts/[id], but we can't HTTP-call ourselves cleanly
    // from server code — and the logic is small. We replicate it inline:
    // insert pending → sendDraft → flip status. Same audit shape.
    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from('AgentDraft')
      .insert({
        spaceId: space.id,
        contactId,
        dealId,
        channel: sendBody.channel,
        subject: sendBody.channel === 'email' ? sendBody.subject!.trim() : null,
        content: sendBody.body.trim(),
        reasoning: `Quick draft from /chippi home (${sendBody.intent}).`,
        priority: 0,
        status: 'pending',
      })
      .select('id, channel, subject, content, contactId')
      .single();

    if (insertError || !inserted) {
      logger.error('[quick-draft] insert failed', { err: insertError?.message });
      return NextResponse.json({ error: 'Failed to create draft' }, { status: 500 });
    }

    const draftId = (inserted as { id: string }).id;

    // Hydrate contact for delivery (needs email/phone).
    let contact = { name: subjectLabel, email: null as string | null, phone: null as string | null };
    if (contactId) {
      const { data: row } = await supabase
        .from('Contact')
        .select('name, email, phone')
        .eq('id', contactId)
        .eq('spaceId', space.id)
        .maybeSingle();
      if (row) contact = row as typeof contact;
    }

    const deliveryResult: DeliveryResult = await sendDraft(
      { channel: sendBody.channel, subject: sendBody.channel === 'email' ? sendBody.subject! : null, content: sendBody.body.trim() },
      contact,
      space.name,
      { spaceId: space.id, userId },
    );

    const finalStatus = deliveryResult.sent ? 'sent' : 'approved';
    const { error: patchError } = await supabase
      .from('AgentDraft')
      .update({ status: finalStatus, updatedAt: now })
      .eq('id', draftId)
      .eq('spaceId', space.id);
    if (patchError) {
      logger.error('[quick-draft] status update failed', { err: patchError.message });
    }

    void audit({
      actorClerkId: userId,
      action: 'CREATE',
      resource: 'AgentDraft',
      resourceId: draftId,
      spaceId: space.id,
      metadata: {
        source: 'quick-draft',
        intent: sendBody.intent,
        contextKind: sendBody.context,
        channel: sendBody.channel,
        finalStatus,
        deliverySent: deliveryResult.sent,
        deliveryError: deliveryResult.error,
      },
    });

    return NextResponse.json({
      id: draftId,
      status: finalStatus,
      contactName: contact.name,
      deliveryResult,
    });
  }

  return NextResponse.json({ error: 'unknown mode' }, { status: 400 });
}
