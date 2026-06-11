/**
 * Send validator — pure, framework-agnostic. Lives outside `route.ts`
 * because Next App Router rejects non-handler exports from a route file.
 *
 * Validates a send payload for either channel:
 *   - `channel: 'email'` → To (string|string[]) + Subject + Body, with
 *     optional Cc/Bcc. Recipients are email addresses.
 *   - `channel: 'whatsapp'` → To (string, single phone) + Body. No
 *     Subject. No Cc/Bcc. Plain text only.
 *
 * One reason this exists: the UI lets the realtor enter a comma-
 * separated string in the To/Cc/Bcc fields. The route handler shouldn't
 * have to deal with that — it should get a clean validated payload.
 * Bad shapes get rejected with a copy-ready error message, not a 500
 * from inside Composio.
 */

export type CommunicationChannel = 'email' | 'whatsapp';

export interface SendBody {
  channel?: unknown;
  to?: unknown;        // string | string[]
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
  /** Optional thread context (basic reply support). Email only. */
  inReplyToId?: unknown;
}

export interface ValidatedEmailSend {
  channel: 'email';
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyToId: string | null;
}

export interface ValidatedWhatsAppSend {
  channel: 'whatsapp';
  to: string; // single E.164-ish phone number
  body: string;
}

export type ValidatedSend = ValidatedEmailSend | ValidatedWhatsAppSend;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phone format check — loose. We require a leading + and 8-15 digits, the
 * E.164 range. The strict validation lives with the provider; this is a
 * "did the realtor type something that's plausibly a phone" gate.
 */
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

const MAX_RECIPIENTS = 50;
const MAX_SUBJECT = 250;
const MAX_BODY = 50_000;
const MAX_WHATSAPP_BODY = 4096; // Meta's WhatsApp message limit

/**
 * Split a string or string[] into a normalized email[] (trimmed,
 * deduped). Returns null on a non-string/non-array input — distinct from
 * "empty list", which is a valid intermediate. Callers decide whether
 * empty is allowed (To: no, Cc: yes).
 */
function parseRecipients(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  const raw: string[] = [];
  if (typeof value === 'string') {
    raw.push(...value.split(','));
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v !== 'string') return null;
      // Allow nested commas inside an array entry — realtors paste lists.
      raw.push(...v.split(','));
    }
  } else {
    return null;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const trimmed = r.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

/**
 * Pull the single phone number out of `to`. Accepts a bare string or a
 * one-element array (so the UI can normalise to one shape across both
 * channels). Strips spaces, hyphens, parens — realtors paste from
 * contact cards.
 */
function parsePhone(value: unknown): string | null {
  let raw: string | null = null;
  if (typeof value === 'string') {
    raw = value;
  } else if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    raw = value[0];
  } else {
    return null;
  }
  const cleaned = raw.replace(/[\s\-()]/g, '').trim();
  if (!cleaned) return null;
  return cleaned;
}

export function validateSendPayload(
  body: SendBody,
): { ok: true; value: ValidatedSend } | { ok: false; error: string } {
  const channel = body.channel === 'whatsapp' ? 'whatsapp' : 'email';

  if (channel === 'whatsapp') {
    const phone = parsePhone(body.to);
    if (!phone) return { ok: false, error: 'Add a phone number.' };
    if (!PHONE_RE.test(phone)) {
      return { ok: false, error: 'That phone number does not look right.' };
    }
    const text = typeof body.body === 'string' ? body.body : '';
    if (text.trim().length === 0) {
      return { ok: false, error: 'Write something to send.' };
    }
    if (text.length > MAX_WHATSAPP_BODY) {
      return { ok: false, error: 'Message is too long.' };
    }
    return {
      ok: true,
      value: { channel: 'whatsapp', to: phone, body: text },
    };
  }

  const to = parseRecipients(body.to);
  if (to === null) return { ok: false, error: 'Recipients are malformed.' };
  if (to.length === 0) return { ok: false, error: 'Add a recipient.' };
  if (to.length > MAX_RECIPIENTS) {
    return { ok: false, error: 'Too many recipients.' };
  }
  for (const addr of to) {
    if (!EMAIL_RE.test(addr)) {
      return { ok: false, error: `Invalid email: ${addr}` };
    }
  }

  const cc = parseRecipients(body.cc);
  if (cc === null) return { ok: false, error: 'Cc is malformed.' };
  for (const addr of cc) {
    if (!EMAIL_RE.test(addr)) {
      return { ok: false, error: `Invalid Cc: ${addr}` };
    }
  }

  const bcc = parseRecipients(body.bcc);
  if (bcc === null) return { ok: false, error: 'Bcc is malformed.' };
  for (const addr of bcc) {
    if (!EMAIL_RE.test(addr)) {
      return { ok: false, error: `Invalid Bcc: ${addr}` };
    }
  }

  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
    return { ok: false, error: 'Too many recipients.' };
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  if (!subject) return { ok: false, error: 'Subject is required.' };
  if (subject.length > MAX_SUBJECT) {
    return { ok: false, error: 'Subject is too long.' };
  }

  const bodyText = typeof body.body === 'string' ? body.body : '';
  // Don't .trim() the body — realtors sometimes intentionally include
  // leading/trailing whitespace for signatures and quoted replies.
  if (bodyText.trim().length === 0) {
    return { ok: false, error: 'Write something in the body.' };
  }
  if (bodyText.length > MAX_BODY) {
    return { ok: false, error: 'Body is too long.' };
  }

  const inReplyToId =
    typeof body.inReplyToId === 'string' && body.inReplyToId.trim()
      ? body.inReplyToId.trim()
      : null;

  return {
    ok: true,
    value: { channel: 'email', to, cc, bcc, subject, body: bodyText, inReplyToId },
  };
}
