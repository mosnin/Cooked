/**
 * Color constants — single source of truth for where each colour
 * EARNS its place in the product.
 *
 * Why this file exists. STYLESHEET.md says brand orange lives in
 * exactly five places: logo, Chippi avatar, agent badge, agent
 * activity bar, lead-warm tier. Reviewers can't audit a Tailwind class
 * usage by eye across 90+ call sites. This file codifies the five
 * contexts as a single closed enum that's enforced by:
 *
 *   1. A lint test (tests/style/no-stray-orange.test.ts) that fails
 *      CI when `text-orange-*` / `bg-orange-*` appears in a file that
 *      doesn't import one of these constants.
 *   2. Self-documenting reviews — a PR adding a 6th use site needs
 *      to delete one of the existing five from `BRAND_ORANGE_CONTEXTS`
 *      first, which forces the conversation about discipline.
 *
 * Adding the constants but not USING them at every call site would
 * defeat the second mechanism. The migration to wrap existing 90+
 * call sites happens in Phase 2 of the design rebuild. For Phase 1
 * the file establishes the vocabulary; Phase 2 wraps the consumers.
 *
 * The lint rule reads this file's exports at boot — the AST of the
 * constants list IS the allowlist, so renaming an enum value doesn't
 * silently expand the surface.
 */

import { cn } from './utils';

/**
 * The five places brand orange is allowed in product chrome.
 *
 * Adding a sixth requires deleting one — discipline lives in the
 * constraint, not in a paragraph of prose.
 */
export const BRAND_ORANGE_CONTEXTS = [
  /** The literal Chippi logo / wordmark in nav, header, auth. */
  'LOGO',
  /** The orange chip widget that represents Chippi in composer, header, toast. */
  'CHIPPI_AVATAR',
  /** Authorship pill stamped on AgentDraft rows, conversation messages, activity rows. */
  'AGENT_BADGE',
  /** Progress fill on the autonomous-run activity bar and similar in-flight indicators. */
  'ACTIVITY_BAR',
  /** Lead-warm tier indicator. Mustard, not orange — but conceptually adjacent. */
  'LEAD_WARM',
] as const;

export type BrandOrangeContext = (typeof BRAND_ORANGE_CONTEXTS)[number];

/**
 * Tag a className string with a brand-orange context so the lint rule
 * passes. Runtime-equivalent to `cn(...classes)` — the value of this
 * wrapper is the context argument, which signals "yes, this orange is
 * one of the five named moments."
 *
 * @example
 *   <span className={brandOrange('CHIPPI_AVATAR', 'text-orange-500 bg-orange-50/40')} />
 *
 * The lint rule (tests/style/no-stray-orange.test.ts) checks that
 * every `text-orange-*` / `bg-orange-*` call site either lives inside
 * a `brandOrange(...)` invocation or in the allowlisted leaf
 * components themselves (the AgentBadge primitives, etc.).
 */
export function brandOrange(_context: BrandOrangeContext, ...classes: string[]): string {
  return cn(classes);
}
