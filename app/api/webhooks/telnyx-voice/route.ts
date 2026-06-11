/**
 * Telnyx Voice (Call Control) webhook — public, no Clerk.
 *
 * Telnyx POSTs call-control events here as the call moves through its lifecycle.
 * We handle:
 *   - call.initiated        → mark ringing
 *   - call.answered         → (agent leg) bridge to the contact + start recording
 *   - call.bridged          → mark answered
 *   - call.hangup           → mark completed/failed/no_answer + duration
 *   - call.recording.saved  → download, transcribe, Chippi-summarize, persist
 *
 * Auth: this is a machine-to-machine webhook, so there's no Clerk session. We
 * gate on a shared secret query param (?secret=TELNYX_WEBHOOK_SECRET) when one
 * is configured. (Telnyx Ed25519 signature verification would be stronger but
 * needs the public key + raw-body handling; the shared secret is the pragmatic
 * gate and the route does nothing destructive — it only updates rows it owns.)
 *
 * This route NEVER throws and ALWAYS returns 200 — a non-200 makes Telnyx retry
 * the event, which would compound any transient failure.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  bridgeAndRecord,
  decodeClientState,
  downloadRecording,
  encodeClientState,
} from '@/lib/voice';
import { getLLMClient, openaiModel } from '@/lib/llm';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  // Shared-secret gate (only enforced when configured).
  const expected = process.env.TELNYX_WEBHOOK_SECRET;
  if (expected) {
    const provided = req.nextUrl.searchParams.get('secret');
    if (provided !== expected) {
      logger.warn('[telnyx-voice] rejected — bad secret');
      // Still 200 so a probe can't distinguish a wrong secret from a bad route,
      // but we do nothing.
      return ok();
    }
  }

  let event: any;
  try {
    const body = await req.json();
    event = body?.data ?? body;
  } catch {
    logger.warn('[telnyx-voice] unparseable body');
    return ok();
  }

  const eventType: string | undefined = event?.event_type ?? event?.record_type;
  const payload = event?.payload ?? {};
  const callControlId: string | undefined = payload?.call_control_id;
  const clientState = decodeClientState(payload?.client_state);

  try {
    switch (eventType) {
      case 'call.initiated':
        await updateByCallId(callControlId, { status: 'ringing' });
        break;

      case 'call.answered':
        // The agent leg answered. Bridge to the contact and start recording.
        // We only bridge if client_state carries a bridgeTo target (i.e. this is
        // the outbound agent leg we created, not the contact leg we transferred).
        if (callControlId && clientState.bridgeTo) {
          await updateByCallId(callControlId, { status: 'answered' });
          await bridgeAndRecord(
            callControlId,
            clientState.bridgeTo,
            // Forward state minus bridgeTo so the contact leg doesn't re-bridge.
            encodeClientState({ spaceId: clientState.spaceId, contactId: clientState.contactId }),
          );
        }
        break;

      case 'call.bridged':
        await updateByCallId(callControlId, { status: 'answered' });
        break;

      case 'call.hangup': {
        const cause: string | undefined = payload?.hangup_cause;
        const durationSec = parseDuration(payload);
        const status =
          cause === 'normal_clearing' || cause === 'originator_cancel'
            ? 'completed'
            : cause === 'user_busy' || cause === 'no_answer' || cause === 'timeout'
              ? 'no_answer'
              : 'failed';
        await updateByCallId(callControlId, {
          status: durationSec && durationSec > 0 ? 'completed' : status,
          durationSec: durationSec ?? undefined,
        });
        break;
      }

      case 'call.recording.saved':
        await handleRecordingSaved(callControlId, payload);
        break;

      default:
        // Unhandled event types are fine — Telnyx sends many we don't care about.
        break;
    }
  } catch (err) {
    // Never let a handler error escape — Telnyx would retry the event.
    logger.error('[telnyx-voice] handler error', { eventType }, err);
  }

  return ok();
}

// ── DB helpers ──────────────────────────────────────────────────────────────

async function updateByCallId(
  callControlId: string | undefined,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!callControlId) return;
  const { error } = await supabase
    .from('CallLog')
    .update({ ...fields, updatedAt: new Date().toISOString() })
    .eq('telnyxCallId', callControlId);
  if (error) {
    logger.error('[telnyx-voice] update failed', { err: error.message });
  }
}

function parseDuration(payload: any): number | null {
  // Telnyx sends start/end timestamps on hangup; derive seconds from them.
  const start = payload?.start_time ? Date.parse(payload.start_time) : NaN;
  const end = payload?.end_time ? Date.parse(payload.end_time) : NaN;
  if (!isNaN(start) && !isNaN(end) && end >= start) {
    return Math.round((end - start) / 1000);
  }
  const direct = payload?.call_duration_secs ?? payload?.duration_secs;
  return typeof direct === 'number' ? direct : null;
}

// ── Recording → transcript → Chippi summary ─────────────────────────────────

async function handleRecordingSaved(
  callControlId: string | undefined,
  payload: any,
): Promise<void> {
  // Telnyx surfaces the recording URLs under recording_urls / public_recording_urls.
  const recordingUrl: string | undefined =
    payload?.recording_urls?.mp3 ??
    payload?.recording_urls?.wav ??
    payload?.public_recording_urls?.mp3 ??
    payload?.public_recording_urls?.wav;

  if (!recordingUrl) {
    logger.warn('[telnyx-voice] recording.saved with no URL', { callControlId });
    return;
  }

  // Persist the URL immediately so it's available even if transcription fails.
  await updateByCallId(callControlId, { recordingUrl });

  // Transcribe via Whisper (needs OPENAI_API_KEY). Gate cleanly when absent.
  let transcript: string | null = null;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const file = await downloadRecording(recordingUrl);
    if (file && file.size <= 25 * 1024 * 1024) {
      try {
        const openai = new OpenAI({ apiKey: openaiKey });
        const result = await openai.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          response_format: 'text',
        });
        transcript = typeof result === 'string' ? result.trim() : null;
      } catch (err) {
        logger.error('[telnyx-voice] transcription failed', { callControlId }, err);
      }
    }
  } else {
    logger.warn('[telnyx-voice] OPENAI_API_KEY missing — skipping transcription');
  }

  if (!transcript) {
    await updateByCallId(callControlId, { recordingUrl });
    return;
  }

  // Chippi summary — 2-3 sentences. Gate on any LLM key being present.
  let summary: string | null = null;
  try {
    const client = getLLMClient();
    const completion = await client.chat.completions.create({
      model: openaiModel('gpt-4o-mini'),
      temperature: 0.2,
      max_tokens: 180,
      messages: [
        {
          role: 'system',
          content:
            'You are Chippi, a real-estate CRM assistant. Summarize this phone-call ' +
            'transcript for the agent in 2-3 plain sentences: what was discussed, any ' +
            'commitments, and the next step. Be specific and factual. No preamble.',
        },
        { role: 'user', content: `Call transcript:\n"""\n${transcript}\n"""` },
      ],
    });
    summary = completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    logger.error('[telnyx-voice] summary failed', { callControlId }, err);
  }

  await updateByCallId(callControlId, {
    recordingUrl,
    transcript,
    ...(summary ? { summary } : {}),
  });
  logger.info('[telnyx-voice] recording processed', {
    callControlId,
    hasTranscript: Boolean(transcript),
    hasSummary: Boolean(summary),
  });
}
