/**
 * Telnyx Voice (Call Control) integration.
 *
 * Places click-to-call calls via the Telnyx Call Control v2 REST API and exposes
 * the small set of helpers the webhook route needs (answer, bridge, recording
 * download). We use `fetch` directly against https://api.telnyx.com/v2 rather
 * than the SDK so there's no new dependency and the surface stays tiny.
 *
 * Gating: requires TELNYX_API_KEY + TELNYX_VOICE_CONNECTION_ID +
 * TELNYX_FROM_NUMBER. When any is missing the module cleanly no-ops and returns
 * a structured `{ ok: false, reason: 'not_configured' }` — it never throws and
 * never makes a network call, so a deploy without credentials is safe.
 *
 * Flow (agent-first click-to-call):
 *   1. We dial the AGENT's own phone (create call). Telnyx rings the realtor.
 *   2. When the agent answers (call.answered webhook), the webhook bridges that
 *      leg to the CONTACT's number with recording enabled.
 *   3. On call.recording.saved the webhook downloads the recording, transcribes
 *      it, and asks Chippi for a summary.
 */

import { logger } from '@/lib/logger';

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

export interface VoiceConfig {
  apiKey: string;
  connectionId: string;
  fromNumber: string;
}

/** All three env vars must be present for the voice layer to operate. */
export function isVoiceConfigured(): boolean {
  return Boolean(
    process.env.TELNYX_API_KEY &&
      process.env.TELNYX_VOICE_CONNECTION_ID &&
      process.env.TELNYX_FROM_NUMBER,
  );
}

/** Resolve the gated config, or null when any credential is missing. */
export function getVoiceConfig(): VoiceConfig | null {
  const apiKey = process.env.TELNYX_API_KEY;
  const connectionId = process.env.TELNYX_VOICE_CONNECTION_ID;
  const fromNumber = process.env.TELNYX_FROM_NUMBER;
  if (!apiKey || !connectionId || !fromNumber) return null;
  return { apiKey, connectionId, fromNumber };
}

// Warn once at module load so a misconfigured deploy is obvious in logs.
if (!isVoiceConfigured()) {
  logger.warn(
    '[voice] Telnyx Voice not configured — calls will no-op. Set TELNYX_API_KEY, TELNYX_VOICE_CONNECTION_ID and TELNYX_FROM_NUMBER.',
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
function isBlockedNumber(e164: string): boolean {
  return PREMIUM_PREFIXES.some((p) => e164.startsWith(p));
}

/** Low-level Call Control POST. Returns the parsed JSON or throws. */
async function telnyxFetch(
  path: string,
  config: VoiceConfig,
  body?: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(`${TELNYX_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail ?? res.statusText;
    throw new Error(`Telnyx ${res.status}: ${detail}`);
  }
  return json;
}

export type PlaceCallResult =
  | { ok: true; telnyxCallId: string }
  | { ok: false; reason: 'not_configured' | 'invalid_number' | 'blocked_number' | 'error'; message?: string };

export interface PlaceClickToCallParams {
  spaceId: string;
  contactId?: string | null;
  /** The realtor's own phone — Telnyx dials this leg first. */
  agentNumber: string;
  /** The contact's phone — bridged in once the agent answers. */
  contactNumber: string;
}

/**
 * Dial the agent first. The contact number is stashed in client_state so the
 * webhook knows who to bridge to once the agent's leg answers. Recording is
 * started on the bridged call, not here, so the agent's ring isn't recorded.
 */
export async function placeClickToCall(params: PlaceClickToCallParams): Promise<PlaceCallResult> {
  const config = getVoiceConfig();
  if (!config) {
    logger.warn('[voice] placeClickToCall skipped — not configured', { spaceId: params.spaceId });
    return { ok: false, reason: 'not_configured' };
  }

  const agentE164 = toE164(params.agentNumber);
  const contactE164 = toE164(params.contactNumber);
  if (!agentE164 || !contactE164) {
    return { ok: false, reason: 'invalid_number' };
  }
  if (isBlockedNumber(agentE164) || isBlockedNumber(contactE164)) {
    logger.warn('[voice] blocked premium-rate number', { spaceId: params.spaceId });
    return { ok: false, reason: 'blocked_number' };
  }

  // client_state must be base64. We carry the bridge target + our row context
  // through the call so the webhook can act without a DB lookup on the agent leg.
  const clientState = encodeClientState({
    bridgeTo: contactE164,
    spaceId: params.spaceId,
    contactId: params.contactId ?? null,
  });

  try {
    const json = await telnyxFetch('/calls', config, {
      connection_id: config.connectionId,
      to: agentE164,
      from: config.fromNumber,
      client_state: clientState,
    });
    const telnyxCallId = json?.data?.call_control_id as string | undefined;
    if (!telnyxCallId) {
      return { ok: false, reason: 'error', message: 'No call_control_id returned' };
    }
    logger.info('[voice] click-to-call placed', { spaceId: params.spaceId, telnyxCallId });
    return { ok: true, telnyxCallId };
  } catch (err) {
    logger.error('[voice] placeClickToCall failed', { spaceId: params.spaceId }, err);
    return { ok: false, reason: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Helpers the webhook needs ───────────────────────────────────────────────

/** Answer an inbound leg (not used for outbound click-to-call, kept for parity). */
export async function answerCall(callControlId: string): Promise<boolean> {
  const config = getVoiceConfig();
  if (!config) return false;
  try {
    await telnyxFetch(`/calls/${callControlId}/actions/answer`, config);
    return true;
  } catch (err) {
    logger.error('[voice] answerCall failed', undefined, err);
    return false;
  }
}

/**
 * Bridge the answered agent leg to the contact and turn on recording. Telnyx
 * dials the contact as a new leg and records the combined audio (dual channel).
 */
export async function bridgeAndRecord(
  callControlId: string,
  contactNumber: string,
  clientState?: string,
): Promise<boolean> {
  const config = getVoiceConfig();
  if (!config) return false;
  const contactE164 = toE164(contactNumber);
  if (!contactE164) return false;
  try {
    // Start recording on the agent leg first so the whole bridged call is captured.
    await telnyxFetch(`/calls/${callControlId}/actions/record_start`, config, {
      format: 'mp3',
      channels: 'dual',
    });
    // Dial the contact and bridge. transfer creates the second leg and joins it.
    await telnyxFetch(`/calls/${callControlId}/actions/transfer`, config, {
      to: contactE164,
      from: config.fromNumber,
      ...(clientState ? { client_state: clientState } : {}),
    });
    return true;
  } catch (err) {
    logger.error('[voice] bridgeAndRecord failed', undefined, err);
    return false;
  }
}

/**
 * Download a recording from a Telnyx-hosted URL and return it as a File the
 * Whisper transcription API accepts. Returns null on any failure.
 */
export async function downloadRecording(url: string): Promise<File | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      logger.warn('[voice] recording download failed', { status: res.status });
      return null;
    }
    const buf = await res.arrayBuffer();
    const ext = url.includes('.wav') ? 'wav' : 'mp3';
    const type = ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
    return new File([buf], `recording.${ext}`, { type });
  } catch (err) {
    logger.error('[voice] downloadRecording failed', undefined, err);
    return null;
  }
}

// ── client_state helpers (base64 JSON round-trip) ───────────────────────────

export interface CallClientState {
  bridgeTo?: string | null;
  spaceId?: string | null;
  contactId?: string | null;
}

export function encodeClientState(state: CallClientState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
}

export function decodeClientState(encoded: string | null | undefined): CallClientState {
  if (!encoded) return {};
  try {
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as CallClientState;
  } catch {
    return {};
  }
}
