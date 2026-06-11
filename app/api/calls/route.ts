/**
 * Calls — realtor-facing click-to-call + call log.
 *
 *   POST { slug, contactId?, toNumber }  → { call }   place a call, log it
 *   GET  ?slug=<slug>                    → { calls }  the space's calls, newest first
 *
 * Auth: requireSpaceOwner(slug) — the workspace owner (or a managing
 * broker_owner/broker_admin).
 *
 * Placing a call dials the AGENT first (their own number, resolved from the
 * Space's phoneNumber or TELNYX_AGENT_NUMBER), then bridges to the contact when
 * they answer. The CallLog row is inserted as 'initiated' before we dial so the
 * webhook can fill it in; if the voice layer isn't configured we still insert
 * the row (status 'failed') and tell the client cleanly — never a 500.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { placeClickToCall, toE164, getVoiceConfig } from '@/lib/voice';

export const runtime = 'nodejs';

const CALL_COLUMNS =
  'id, spaceId, contactId, direction, fromNumber, toNumber, telnyxCallId, status, recordingUrl, transcript, summary, durationSec, createdAt, updatedAt';

// ── GET — the space's calls, newest first ───────────────────────────────────

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const { data, error } = await supabase
    .from('CallLog')
    .select(`${CALL_COLUMNS}, Contact(name)`)
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('[calls] list failed', { spaceId: space.id, err: error.message });
    return NextResponse.json({ error: 'Could not load your calls.' }, { status: 500 });
  }

  // Flatten the embedded contact name onto each row for the client.
  const calls = (data ?? []).map((c: any) => ({
    ...c,
    contactName: c.Contact?.name ?? null,
    Contact: undefined,
  }));

  return NextResponse.json({ calls });
}

// ── POST — place a call ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: { slug?: string; contactId?: string | null; toNumber?: string };
  try {
    payload = (await req.json()) as typeof payload;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = payload.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  // A human placing calls won't exceed a handful a minute — clamp loops/abuse.
  const { allowed } = await checkRateLimit(`calls:place:${userId}`, 10, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  const toNumber = toE164(payload.toNumber);
  if (!toNumber) {
    return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 });
  }

  // If a contactId is given, it must belong to this space — never trust the body.
  let contactId: string | null = null;
  if (payload.contactId) {
    const { data: contact } = await supabase
      .from('Contact')
      .select('id')
      .eq('id', payload.contactId)
      .eq('spaceId', space.id)
      .maybeSingle();
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 });
    }
    contactId = contact.id;
  }

  // The agent's own number — what Telnyx rings first. It lives on
  // SpaceSetting.phoneNumber (the same place notify.ts reads it), NOT on the
  // Space row — getSpaceFromSlug never selects it, so the old `space.phoneNumber`
  // cast was always undefined and every call silently fell through to the env
  // fallback. TELNYX_AGENT_NUMBER stays as a deploy-wide fallback.
  const { data: settingRow } = await supabase
    .from('SpaceSetting')
    .select('phoneNumber')
    .eq('spaceId', space.id)
    .maybeSingle();
  const agentNumber = toE164(
    (settingRow as { phoneNumber?: string | null } | null)?.phoneNumber ??
      process.env.TELNYX_AGENT_NUMBER,
  );
  const fromNumber = process.env.TELNYX_FROM_NUMBER ?? '';

  // Insert the row first so the webhook has a target, and so the call shows up
  // in the log immediately even if dialing fails.
  const now = new Date().toISOString();
  const { data: row, error: insertErr } = await supabase
    .from('CallLog')
    .insert({
      spaceId: space.id,
      contactId,
      direction: 'outbound',
      fromNumber: fromNumber || 'unknown',
      toNumber,
      status: 'initiated',
      createdAt: now,
      updatedAt: now,
    })
    .select(CALL_COLUMNS)
    .single();

  if (insertErr || !row) {
    logger.error('[calls] insert failed', { spaceId: space.id, err: insertErr?.message });
    return NextResponse.json({ error: 'Could not start the call. Try again.' }, { status: 500 });
  }

  // Gate: no voice config or no agent number → mark failed, return cleanly.
  if (!getVoiceConfig() || !agentNumber) {
    await supabase
      .from('CallLog')
      .update({ status: 'failed', updatedAt: new Date().toISOString() })
      .eq('id', row.id);
    return NextResponse.json(
      {
        call: { ...row, status: 'failed' },
        configured: false,
        message: getVoiceConfig()
          ? 'Add your phone number in settings to place calls.'
          : 'Calling is not configured for this workspace yet.',
      },
      { status: 200 },
    );
  }

  const result = await placeClickToCall({
    spaceId: space.id,
    contactId,
    agentNumber,
    contactNumber: toNumber,
  });

  if (!result.ok) {
    await supabase
      .from('CallLog')
      .update({ status: 'failed', updatedAt: new Date().toISOString() })
      .eq('id', row.id);
    return NextResponse.json(
      { call: { ...row, status: 'failed' }, configured: result.reason !== 'not_configured' },
      { status: 200 },
    );
  }

  // Stamp the Telnyx leg id so webhooks correlate back to this row.
  const { data: updated } = await supabase
    .from('CallLog')
    .update({ telnyxCallId: result.telnyxCallId, updatedAt: new Date().toISOString() })
    .eq('id', row.id)
    .select(CALL_COLUMNS)
    .single();

  return NextResponse.json({ call: updated ?? { ...row, telnyxCallId: result.telnyxCallId }, configured: true });
}
