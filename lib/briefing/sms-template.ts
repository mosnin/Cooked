/**
 * SMS body builder for the daily brief.
 *
 * Target: ≤160 characters, single segment. Overflow rule: truncate the
 * HEADLINE on a word boundary with an ellipsis. Never split into two
 * segments — one brief, one SMS, one tap.
 *
 * Body shape:    "Chippi: {headline} {deepLink}"
 *
 * The "Chippi:" prefix gives the realtor instant recognition before
 * they open the message — Telnyx long codes don't have alphanumeric
 * sender IDs.
 */

const SMS_LIMIT = 160;
const PREFIX = 'Chippi: ';

export interface BriefSmsParams {
  headline: string;
  spaceSlug: string;
  briefDate: string; // YYYY-MM-DD
  appOrigin: string; // e.g. https://my.usechippi.com — no trailing slash
}

/**
 * Build the SMS body. Returns the body string and a flag indicating
 * whether the headline had to be truncated (useful for telemetry — if
 * a high fraction of sends are truncated, the composer's headlines are
 * running long).
 */
export function buildBriefSms(params: BriefSmsParams): { body: string; truncated: boolean } {
  const { headline, spaceSlug, briefDate, appOrigin } = params;
  const deepLink = `${appOrigin}/s/${spaceSlug}/chippi?brief=${briefDate}`;

  // Sanitize headline: strip newlines / tabs, normalize whitespace
  const cleanHeadline = headline.replace(/\s+/g, ' ').trim();

  // Compute the fixed overhead: prefix + space + url
  const overhead = PREFIX.length + 1 + deepLink.length;
  const headlineBudget = SMS_LIMIT - overhead;

  if (cleanHeadline.length <= headlineBudget) {
    return {
      body: `${PREFIX}${cleanHeadline} ${deepLink}`,
      truncated: false,
    };
  }

  // Truncate to fit on a word boundary, ending with an ellipsis.
  // The ellipsis costs 1 char, so the effective budget is headlineBudget - 1.
  const target = headlineBudget - 1;
  let cut = cleanHeadline.slice(0, target);

  // Walk back to the nearest space (but no further than half the target
  // — if there are no spaces in the last half, just hard-cut at target).
  const minCut = Math.floor(target / 2);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > minCut) {
    cut = cut.slice(0, lastSpace);
  }

  return {
    body: `${PREFIX}${cut}… ${deepLink}`,
    truncated: true,
  };
}

/**
 * The one-time opt-in disclosure SMS that precedes the FIRST brief SMS
 * a realtor ever receives. Telnyx A2P 10DLC convention.
 *
 * Sent as its own message immediately before the first real brief.
 * Persistence signal: SpaceSetting.briefSmsConsentSentAt would lock
 * this to one-time — for now we use smsSentAt == NULL on every Brief
 * row for that space as the proxy (first-ever brief send).
 */
export const BRIEF_SMS_FIRST_DISCLOSURE =
  'Chippi daily brief — reply STOP to opt out, HELP for help. Msg & data rates may apply.';
