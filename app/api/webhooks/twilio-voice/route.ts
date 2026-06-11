/**
 * Twilio Voice webhook — public, no Clerk (replaces the Telnyx Call Control
 * webhook).
 *
 * Twilio POSTs here as a call moves through its lifecycle and as media lands. A
 * single endpoint multiplexes four kinds of request, distinguished by the
 * `?type=` query param we set when we register each callback:
 *
 *   ?type=dial          → agent answered; return TwiML that <Dial>s the contact
 *                         with dual-channel recording (the call's `Url`).
 *   ?type=status        → call-status callback: initiated / ringing / in-progress
 *                         / completed / busy / no-answer / failed → status+duration.
 *   ?type=recording     → recording-status callback: recording ready → store
 *                         RecordingUrl + RecordingSid, then transcribe (Whisper)
 *                         and ask Axil for a summary.
 *   ?type=transcription → Twilio transcription callback (when wired): persist
 *                         TranscriptionText + status onto the row.
 *
 * Auth: this is a machine-to-machine webhook with no Clerk session. EVERY
 * request is validated against the `X-Twilio-Signature` header (HMAC-SHA1 of the
 * full URL + sorted POST params, keyed by the account Auth Token). When the
 * token is configured and the signature is absent/invalid we reject; the route
 * otherwise only updates rows it owns and is rate-limited per source IP.
 *
 * Like the Telnyx route before it, the data callbacks (status/recording/
 * transcription) ALWAYS return 200 so a transient handler failure doesn't make
 * Twilio retry-storm; the `dial` branch returns TwiML (or a safe empty Response).
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/rate-limit';
import {
  fetchRecording,
  twimlResponse,
  twimlDialContact,
  validateTwilioSignature,
  toE164,
} from '@/lib/twilio';
import { getLLMClient, openaiModel } from '@/lib/llm';
import OpenAI from 'openai';

export const runtime = 'nodejs';

const ok = () => NextResponse.json({ ok: true });
const xml = (body: string) =>
  new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
const emptyTwiml = () => xml(twimlResponse(''));

export async function POST(req: NextRequest) {
  // Rate-limit per source IP — a webhook endpoint is internet-reachable, and a
  // flood of bogus posts should be cheaply shed before any DB work.
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`twilio-voice:${ip}`, 120, 60);
  if (!allowed) {
    logger.warn('[twilio-voice] rate limited', { ip });
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // Twilio sends application/x-www-form-urlencoded. Read the raw body, parse the
  // params, and validate the signature against the EXACT URL Twilio signed.
  let params: Record<string, string> = {};
  try {
    const form = await req.formData();
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') params[key] = value;
    }
  } catch {
    logger.warn('[twilio-voice] unparseable body');
    return ok();
  }

  // Signature gate (only enforced when the Auth Token is configured). Twilio
  // signs the full URL including the query string; reconstruct it from the
  // request. Behind a proxy, X-Forwarded-* reflects the public URL Twilio hit.
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signedUrl = reconstructUrl(req);
    const signature = req.headers.get('x-twilio-signature');
    if (!validateTwilioSignature(signedUrl, params, signature, authToken)) {
      logger.warn('[twilio-voice] rejected — bad signature', { url: signedUrl });
      // 403 (not 200): a signature failure is a real rejection, and Twilio does
      // not treat 403 as retryable the way it does a 5xx.
      return NextResponse.json({ error: 'invalid_signature' }, { status: 403 });
    }
  }

  const type = req.nextUrl.searchParams.get('type');

  // ── TwiML fetch: the agent answered → bridge to the contact and record ──────
  if (type === 'dial') {
    const bridgeTo = toE164(req.nextUrl.searchParams.get('bridgeTo'));
    if (!bridgeTo) {
      logger.warn('[twilio-voice] dial with no bridge target');
      return emptyTwiml();
    }
    const callerId = process.env.TWILIO_PHONE_NUMBER ?? '';
    // Echo the same recording callback the call was created with so the bridged
    // recording lands on this row.
    const recordingStatusCallback = absoluteCallbackUrl(req, {
      type: 'recording',
      spaceId: req.nextUrl.searchParams.get('spaceId'),
      contactId: req.nextUrl.searchParams.get('contactId'),
    });
    return xml(
      twimlDialContact(bridgeTo, {
        callerId,
        recordingStatusCallback,
        whisper: 'Connecting your call. This call is recorded.',
      }),
    );
  }

  // ── Data callbacks — never throw, always 200 ────────────────────────────────
  try {
    switch (type) {
      case 'status':
        await handleStatusCallback(params);
        break;
      case 'recording':
        await handleRecordingCallback(params);
        break;
      case 'transcription':
        await handleTranscriptionCallback(params);
        break;
      default:
        // Unknown/legacy callback shape — sniff the params so we still persist
        // the common cases even if the `type` query param is dropped.
        if (params.TranscriptionText !== undefined || params.TranscriptionStatus) {
          await handleTranscriptionCallback(params);
        } else if (params.RecordingUrl || params.RecordingSid) {
          await handleRecordingCallback(params);
        } else if (params.CallStatus) {
          await handleStatusCallback(params);
        }
        break;
    }
  } catch (err) {
    logger.error('[twilio-voice] handler error', { type }, err);
  }

  return ok();
}

// Twilio also fetches TwiML with GET in some configurations; support the dial
// branch over GET so the bridge still works. Signature validation for GET signs
// the URL alone (no body params).
export async function GET(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) {
    const signedUrl = reconstructUrl(req);
    const signature = req.headers.get('x-twilio-signature');
    if (!validateTwilioSignature(signedUrl, {}, signature, authToken)) {
      logger.warn('[twilio-voice] GET rejected — bad signature');
      return NextResponse.json({ error: 'invalid_signature' }, { status: 403 });
    }
  }
  if (req.nextUrl.searchParams.get('type') === 'dial') {
    const bridgeTo = toE164(req.nextUrl.searchParams.get('bridgeTo'));
    if (!bridgeTo) return emptyTwiml();
    const callerId = process.env.TWILIO_PHONE_NUMBER ?? '';
    const recordingStatusCallback = absoluteCallbackUrl(req, {
      type: 'recording',
      spaceId: req.nextUrl.searchParams.get('spaceId'),
      contactId: req.nextUrl.searchParams.get('contactId'),
    });
    return xml(twimlDialContact(bridgeTo, { callerId, recordingStatusCallback }));
  }
  return emptyTwiml();
}

// ── Callback handlers ────────────────────────────────────────────────────────

/**
 * Map Twilio CallStatus onto the CallLog status vocabulary
 * (initiated/ringing/answered/completed/failed/no_answer).
 */
function mapCallStatus(callStatus: string | undefined): string | null {
  switch (callStatus) {
    case 'initiated':
    case 'queued':
      return 'initiated';
    case 'ringing':
      return 'ringing';
    case 'in-progress':
    case 'answered':
      return 'answered';
    case 'completed':
      return 'completed';
    case 'busy':
    case 'no-answer':
      return 'no_answer';
    case 'failed':
    case 'canceled':
      return 'failed';
    default:
      return null;
  }
}

async function handleStatusCallback(params: Record<string, string>): Promise<void> {
  const callSid = params.CallSid;
  if (!callSid) return;
  const status = mapCallStatus(params.CallStatus);
  if (!status) return;

  const durationRaw = params.CallDuration ? parseInt(params.CallDuration, 10) : NaN;
  const durationSec = !isNaN(durationRaw) && durationRaw > 0 ? durationRaw : undefined;

  // A completed call with non-zero duration is genuinely completed; a "completed"
  // CallStatus with zero duration on the agent leg (e.g. they never answered)
  // stays no_answer.
  const finalStatus =
    status === 'completed' && !durationSec ? 'no_answer' : status;

  await updateByCallSid(callSid, {
    status: finalStatus,
    ...(durationSec ? { durationSec } : {}),
  });
}

async function handleRecordingCallback(params: Record<string, string>): Promise<void> {
  const callSid = params.CallSid;
  const recordingSid = params.RecordingSid;
  const recordingUrl = params.RecordingUrl;
  if (!callSid && !recordingSid) return;
  if (!recordingUrl) {
    logger.warn('[twilio-voice] recording callback with no URL', { callSid });
    return;
  }

  // Persist URL + SID immediately and mark the transcript pending so the UI can
  // show a "Transcribing…" badge even if transcription later fails.
  await updateByCallSid(callSid, {
    recordingSid,
    recordingUrl,
    transcriptStatus: 'pending',
  }, recordingSid);

  // Transcribe via Whisper (needs OPENAI_API_KEY). Gate cleanly when absent.
  let transcript: string | null = null;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const file = await fetchRecording(recordingUrl);
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
        logger.error('[twilio-voice] transcription failed', { callSid }, err);
      }
    }
  } else {
    logger.warn('[twilio-voice] OPENAI_API_KEY missing — skipping transcription');
  }

  if (!transcript) {
    // No transcript produced — leave the recording, mark transcript failed so the
    // UI stops showing a perpetual "pending" badge.
    await updateByCallSid(callSid, { transcriptStatus: 'failed' }, recordingSid);
    return;
  }

  // Axil summary — 2-3 sentences for the rep. Gate on any LLM key being present.
  const summary = await summarizeForAxil(transcript, callSid);

  await updateByCallSid(
    callSid,
    {
      transcript,
      transcriptStatus: 'available',
      ...(summary ? { summary } : {}),
    },
    recordingSid,
  );
  logger.info('[twilio-voice] recording processed', {
    callSid,
    hasTranscript: Boolean(transcript),
    hasSummary: Boolean(summary),
  });
}

async function handleTranscriptionCallback(params: Record<string, string>): Promise<void> {
  const callSid = params.CallSid;
  const recordingSid = params.RecordingSid;
  if (!callSid && !recordingSid) return;

  const status = params.TranscriptionStatus; // 'completed' | 'failed'
  const text = params.TranscriptionText?.trim();

  if (status === 'failed' || !text) {
    await updateByCallSid(callSid, { transcriptStatus: 'failed' }, recordingSid);
    return;
  }

  // Twilio gave us the transcript directly — persist it and let Axil summarize.
  const summary = await summarizeForAxil(text, callSid);
  await updateByCallSid(
    callSid,
    {
      transcript: text,
      transcriptStatus: 'available',
      ...(summary ? { summary } : {}),
    },
    recordingSid,
  );
  logger.info('[twilio-voice] transcription callback persisted', { callSid });
}

// ── Axil summary ─────────────────────────────────────────────────────────────

/**
 * Ask Axil for a short, sales-native summary of a call transcript. Returns null
 * on any failure (no LLM key, model error) — the transcript is the canon, the
 * summary is a bonus. These summaries also feed Axil's coaching.
 */
async function summarizeForAxil(transcript: string, callSid?: string): Promise<string | null> {
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
            'You are Axil, an AI sales assistant. Summarize this sales-call transcript ' +
            'for the rep in 2-3 plain sentences: what the prospect needs, any objections ' +
            'or commitments, and the next step. Be specific and factual. No preamble.',
        },
        { role: 'user', content: `Call transcript:\n"""\n${transcript}\n"""` },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    logger.error('[twilio-voice] summary failed', { callSid }, err);
    return null;
  }
}

// ── DB + URL helpers ─────────────────────────────────────────────────────────

/**
 * Update the CallLog row for a call. Correlates by Twilio Call SID; when only a
 * Recording SID is known (a transcription/recording callback without CallSid)
 * we fall back to matching the recordingSid we stored earlier.
 */
async function updateByCallSid(
  callSid: string | undefined,
  fields: Record<string, unknown>,
  recordingSid?: string,
): Promise<void> {
  const patch = { ...fields, updatedAt: new Date().toISOString() };
  if (callSid) {
    const { error } = await supabase
      .from('CallLog')
      .update(patch)
      .eq('twilioCallSid', callSid);
    if (error) logger.error('[twilio-voice] update failed', { err: error.message });
    return;
  }
  if (recordingSid) {
    const { error } = await supabase
      .from('CallLog')
      .update(patch)
      .eq('recordingSid', recordingSid);
    if (error) logger.error('[twilio-voice] update-by-recording failed', { err: error.message });
  }
}

/** Reconstruct the public URL Twilio signed (honoring proxy forwarding). */
function reconstructUrl(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  return `${proto}://${host}${req.nextUrl.pathname}${req.nextUrl.search}`;
}

/** Build an absolute callback URL on this route, carrying context query params. */
function absoluteCallbackUrl(
  req: NextRequest,
  query: Record<string, string | null | undefined>,
): string {
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host;
  const u = new URL(`${proto}://${host}${req.nextUrl.pathname}`);
  for (const [k, v] of Object.entries(query)) {
    if (v) u.searchParams.set(k, v);
  }
  return u.toString();
}
