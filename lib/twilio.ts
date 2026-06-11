/**
 * Twilio Voice integration (replaces the old Telnyx Call Control layer).
 *
 * Places click-to-call calls via the Twilio Programmable Voice REST API and
 * exposes the small helper set the webhook route needs (TwiML generation,
 * recording fetch, signature validation). We call `fetch` directly against the
 * Twilio REST API with HTTP Basic auth (Account SID + Auth Token) rather than
 * pulling in the `twilio` SDK, so there's no new dependency and the surface
 * stays tiny.
 *
 * Gating: requires TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_PHONE_NUMBER.
 * When any is missing the module cleanly no-ops and returns a structured
 * `{ ok: false, reason: 'not_configured' }` — it never throws and never makes a
 * network call, so a deploy without credentials is safe.
 *
 * Flow (agent-first click-to-call, same UX the Telnyx layer offered):
 *   1. We create a call to the AGENT's own phone. Twilio rings the rep and,
 *      once the agent answers, fetches TwiML from our webhook `Url`.
 *   2. That TwiML `<Dial record="record-from-answer-dual">`s the CONTACT, so the
 *      bridged leg is recorded (the agent's ring is not).
 *   3. Twilio posts statusCallback events through the call lifecycle and a
 *      recordingStatusCallback when the recording is ready; the webhook
 *      transcribes it (Whisper) and asks Axil for a summary, OR persists a
 *      Twilio transcription callback if one is wired.
 *
 * Context (spaceId / contactId / the number to bridge to) rides on the callback
 * URLs as query params — Twilio has no Telnyx-style `client_state`, and the
 * StatusCallback/recordingStatusCallback URLs are echoed back verbatim, so the
 * webhook can act on the agent leg without a DB round-trip.
 */

import 'server-only';
import crypto from 'node:crypto';
import { logger } from '@/lib/logger';

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  /** The Twilio number calls are placed FROM (E.164). */
  fromNumber: string;
}

/** All three env vars must be present for the voice layer to operate. */
export function isTwilioConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );
}

/** Resolve the gated config, or null when any credential is missing. */
export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return null;
  return { accountSid, authToken, fromNumber };
}

// Warn once at module load so a misconfigured deploy is obvious in logs.
if (!isTwilioConfigured()) {
  logger.warn(
    '[twilio] Twilio Voice not configured — calls will no-op. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER.',
  );
}

/** Normalize a loose phone string to E.164, or null if it can't be one. */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.length < 10) return null;
  const e164 = cleaned.startsWith('+') ? cleaned : `+1${cleaned}`;
  return /^\+\d{10,15}$/.test(e164) ? e164 : null;
}

// Premium-rate prefixes blocked to prevent toll fraud (mirrors lib/sms.ts).
const PREMIUM_PREFIXES = ['+1900', '+1976', '+44870', '+44871', '+44872', '+44090', '+44091'];
export function isBlockedNumber(e164: string): boolean {
  return PREMIUM_PREFIXES.some((p) => e164.startsWith(p));
}

// ── Auth + low-level REST ────────────────────────────────────────────────────

/** The Basic-auth header value for the Twilio REST API. */
function basicAuthHeader(config: TwilioConfig): string {
  const token = Buffer.from(`${config.accountSid}:${config.authToken}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

/**
 * Low-level form-encoded POST to the Account's REST resource. Twilio's REST API
 * is application/x-www-form-urlencoded, not JSON. Returns parsed JSON or throws.
 */
async function twilioPost(
  resource: string,
  config: TwilioConfig,
  params: Record<string, string | string[] | undefined>,
): Promise<any> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    // Twilio accepts a repeated key for array-valued params (e.g. StatusCallbackEvent).
    if (Array.isArray(value)) {
      for (const v of value) form.append(key, v);
    } else {
      form.append(key, value);
    }
  }
  const url = `${TWILIO_API_BASE}/Accounts/${config.accountSid}${resource}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(config),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.message ?? res.statusText;
    throw new Error(`Twilio ${res.status}: ${detail}`);
  }
  return json;
}

// ── TwiML helpers ────────────────────────────────────────────────────────────

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap inner TwiML verbs in a <Response> document. */
export function twimlResponse(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

export interface TwimlDialOptions {
  /** The Twilio number to show as caller id on the bridged leg. */
  callerId: string;
  /** Absolute URL Twilio posts recording-status callbacks to. */
  recordingStatusCallback?: string;
  /** A short message played to the agent before the contact is dialed. */
  whisper?: string;
}

/**
 * Build the TwiML that bridges the answered agent leg to the contact with
 * dual-channel recording from answer. This is what the webhook returns when
 * Twilio fetches the call's `Url` after the agent picks up.
 */
export function twimlDialContact(contactNumber: string, opts: TwimlDialOptions): string {
  const callback = opts.recordingStatusCallback
    ? ` recordingStatusCallback="${escapeXml(opts.recordingStatusCallback)}" recordingStatusCallbackEvent="completed"`
    : '';
  const say = opts.whisper
    ? `<Say>${escapeXml(opts.whisper)}</Say>`
    : '';
  // record-from-answer-dual records both legs once the contact answers, so the
  // agent's ring isn't captured and each party lands on its own channel.
  const dial =
    `<Dial callerId="${escapeXml(opts.callerId)}" answerOnBridge="true" ` +
    `record="record-from-answer-dual"${callback}>` +
    `<Number>${escapeXml(contactNumber)}</Number>` +
    `</Dial>`;
  return twimlResponse(`${say}${dial}`);
}

// ── Outbound call creation ───────────────────────────────────────────────────

export type PlaceCallResult =
  | { ok: true; twilioCallSid: string }
  | {
      ok: false;
      reason: 'not_configured' | 'invalid_number' | 'blocked_number' | 'error';
      message?: string;
    };

export interface CreateCallParams {
  /** The rep's own phone — Twilio dials this leg first (E.164). */
  to: string;
  /**
   * Absolute URL Twilio fetches TwiML from once the agent answers. This is the
   * webhook route; it returns the <Dial> that bridges to the contact. Context
   * (contact number, spaceId, contactId) is carried as query params on this URL.
   */
  url: string;
  /** Absolute URL for call-lifecycle status callbacks. */
  statusCallback?: string;
  /** Absolute URL for recording-status callbacks (recording ready). */
  recordingStatusCallback?: string;
}

/**
 * Create an outbound call to the agent. Recording is requested on the call so
 * Twilio fires a recordingStatusCallback when the audio is ready; the bridged
 * recording is configured by the TwiML at `url`. We pass the lifecycle events
 * we care about as repeated StatusCallbackEvent params.
 */
export async function createCall(params: CreateCallParams): Promise<PlaceCallResult> {
  const config = getTwilioConfig();
  if (!config) {
    logger.warn('[twilio] createCall skipped — not configured');
    return { ok: false, reason: 'not_configured' };
  }

  const toE = toE164(params.to);
  if (!toE) return { ok: false, reason: 'invalid_number' };
  if (isBlockedNumber(toE)) {
    logger.warn('[twilio] blocked premium-rate number');
    return { ok: false, reason: 'blocked_number' };
  }

  try {
    const json = await twilioPost('/Calls.json', config, {
      To: toE,
      From: config.fromNumber,
      Url: params.url,
      // Record the whole call too (belt-and-suspenders with the TwiML <Dial
      // record>); whichever fires first, the recordingStatusCallback persists it.
      Record: 'true',
      RecordingStatusCallback: params.recordingStatusCallback,
      RecordingStatusCallbackEvent: ['completed'],
      StatusCallback: params.statusCallback,
      StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      StatusCallbackMethod: 'POST',
    });
    const sid = json?.sid as string | undefined;
    if (!sid) return { ok: false, reason: 'error', message: 'No call SID returned' };
    logger.info('[twilio] click-to-call placed', { twilioCallSid: sid });
    return { ok: true, twilioCallSid: sid };
  } catch (err) {
    logger.error('[twilio] createCall failed', undefined, err);
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Recording fetch ──────────────────────────────────────────────────────────

/**
 * Download a recording from a Twilio recording URL and return it as a File the
 * Whisper transcription API accepts. Twilio recording media requires Basic auth;
 * the `.mp3`/`.wav` suffix selects the format. Returns null on any failure.
 */
export async function fetchRecording(url: string): Promise<File | null> {
  const config = getTwilioConfig();
  try {
    // Twilio recording URLs come without an extension; request mp3 explicitly.
    const mediaUrl = /\.(mp3|wav)$/i.test(url) ? url : `${url}.mp3`;
    const res = await fetch(mediaUrl, {
      headers: config ? { Authorization: basicAuthHeader(config) } : undefined,
    });
    if (!res.ok) {
      logger.warn('[twilio] recording download failed', { status: res.status });
      return null;
    }
    const buf = await res.arrayBuffer();
    const ext = mediaUrl.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';
    const type = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
    return new File([buf], `recording.${ext}`, { type });
  } catch (err) {
    logger.error('[twilio] fetchRecording failed', undefined, err);
    return null;
  }
}

// ── X-Twilio-Signature validation ────────────────────────────────────────────

/**
 * Validate Twilio's `X-Twilio-Signature` header.
 *
 * Twilio signs each request with HMAC-SHA1 keyed by the account Auth Token over
 * a string built from the FULL request URL (including query string) followed by
 * the POST body params sorted by key and concatenated as `key + value` (no
 * separators). The result is base64-encoded and compared to the header.
 *
 * For GET requests (or requests with no POST body), `params` is empty and the
 * signed string is just the URL. We compare in constant time.
 *
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null | undefined,
  authToken: string,
): boolean {
  if (!signature || !authToken) return false;

  // url + each (key, value) with keys sorted ascending, concatenated.
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }

  const expected = crypto.createHmac('sha1', authToken).update(data, 'utf8').digest('base64');

  // Constant-time compare; length-guard first so timingSafeEqual doesn't throw.
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
