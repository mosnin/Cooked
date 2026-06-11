/**
 * The first-touch draft Chippi "writes" during the onboarding reveal.
 *
 * This is the payoff of the welcome promise ("by the end, I'll already
 * be working on it"). At the final onboarding stage Chippi types out a
 * real first-touch message - in the realtor's chosen voice, naming
 * their business, tuned to their primary lead source - so the realtor
 * SEES the agent work before the dashboard ever loads.
 *
 * Why deterministic, not an LLM call. Onboarding is the single
 * highest-stakes first impression in the product. An LLM call here is
 * slow (seconds of dead air), costs money on every signup, and - worst
 * - can misfire on the one screen we cannot afford to get wrong. A
 * template keyed off the realtor's own inputs is instant, free, and
 * cannot produce a bad sentence. The MAGIC is the live typing
 * animation, not the generation. Keep it here, pure and tested.
 *
 * Everything in this file is a pure function of its inputs - no I/O,
 * no Date.now(), no randomness. That's what makes it unit-testable and
 * what makes the reveal identical every time the realtor sees it.
 */

export type DraftTone = 'warm' | 'direct';

export interface OnboardingDraftInput {
  /** Realtor's full name; we use the first token. */
  name: string;
  /** Business name shown to leads. */
  businessName: string;
  /** Chosen voice from the voice-pick stage. */
  tone: DraftTone;
  /** Audience values from the who-you-serve stage (e.g. 'first_time_buyers'). */
  clientTypes: string[];
  /** Lead-source values from the sources stage (e.g. 'zillow'). */
  leadSources: string[];
}

export interface OnboardingDraftResult {
  /** One-line framing shown above the typed draft. */
  frame: string;
  /** The message body that types out, character by character. */
  body: string;
}

/** Lead-source value → the phrase that reads naturally in "a new ___ lead". */
const SOURCE_PHRASE: Record<string, string> = {
  sphere: 'referral',
  zillow: 'Zillow',
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  idx_website: 'website',
  open_houses: 'open-house',
  follow_up_boss: 'Follow-up Boss',
  mailchimp: 'email',
  google_ads: 'Google Ads',
};

/**
 * One audience-aware clause, warm tone only. Keeps the demo feeling
 * "tuned to me" without over-engineering a combinatorial template.
 * First matching audience wins; absence is fine (clause omitted).
 */
const AUDIENCE_WARM_CLAUSE: Record<string, string> = {
  first_time_buyers: " I'll walk you through every step. First homes are my favorite.",
  move_up_families: " Whether you're upsizing or relocating, I'll make the move smooth.",
  luxury: ' I give every client white-glove attention from first call to keys.',
  investors: " I'll get you the numbers that matter: cap rate, comps, cash flow.",
  sellers: " I'll show you exactly what your home can command in today's market.",
  renters: " I'll line up places that fit before they hit the open market.",
};

/** Pick the realtor's first name, or a friendly fallback. */
function firstNameOf(name: string): string {
  const t = name.trim().split(/\s+/)[0];
  return t || 'there';
}

/**
 * The hypothetical lead the demo message is addressed to. A realistic
 * first name reads like a real message; the `frame` makes clear it's a
 * preview, so there's no "who is this?" confusion.
 */
const DEMO_LEAD_NAME = 'Jordan';

/**
 * Compose the onboarding reveal draft. Pure - same inputs always
 * produce the same frame + body.
 */
export function composeOnboardingDraft(input: OnboardingDraftInput): OnboardingDraftResult {
  const firstName = firstNameOf(input.name);
  const business = input.businessName.trim() || 'your business';

  // Primary source = first selected. "via X" clause only when we have a
  // natural phrase for it; otherwise the message reads fine without.
  const primarySource = input.leadSources[0];
  const sourcePhrase = primarySource ? SOURCE_PHRASE[primarySource] : undefined;
  const via = sourcePhrase ? ` via ${sourcePhrase}` : '';

  const frame = sourcePhrase
    ? `The moment a new ${sourcePhrase} lead lands, here's what I'll send:`
    : `The moment a new lead reaches out, here's what I'll send:`;

  if (input.tone === 'direct') {
    // Direct: respect their time, lead with the ask, one clear next step.
    const body =
      `Hi ${DEMO_LEAD_NAME}, ${firstName} here with ${business}. ` +
      `Got your inquiry${via}. To get you moving fast: what's your target area, ` +
      `price range, and timeline? Reply here and I'll send matching listings today. ${firstName}`;
    return { frame, body };
  }

  // Warm: open the door, reassure, invite - with one audience-aware touch.
  const audienceClause =
    input.clientTypes.map((c) => AUDIENCE_WARM_CLAUSE[c]).find(Boolean) ?? '';
  const body =
    `Hi ${DEMO_LEAD_NAME}, thanks for reaching out${via}! ` +
    `I'd love to help you find the right place.${audienceClause} ` +
    `To point you at the best fits, what are you looking for? Area, timing, must-haves? ` +
    `No rush, and no pressure. ${firstName}, ${business}`;
  return { frame, body };
}
