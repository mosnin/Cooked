/**
 * Chippi typography + spacing scale.
 *
 * Single source of truth for every page's visual hierarchy. Agents and
 * components import from here so the eye lands on the same thing on every
 * screen. The values are Tailwind utility class strings; consumers compose
 * them via `cn(...)`.
 *
 * The hierarchy rule: every page has ONE focal element. Title + focal stats
 * are the loud notes. Section headings recede; body recedes further; muted
 * labels recede furthest. Spacing breathes between sections, tightens within.
 *
 * ── The type ladder ─────────────────────────────────────────────────────────
 * Snapped to a 1.2 modular ratio (minor third — the Pythagorean step that
 * the eye reads as proportional rather than arbitrary). Rounded to whole px:
 *
 *   30 → 25 → 21 → 17 → 14 → 12 → 11
 *   H1   STAT  H2   H3   BODY  CAP   META
 *
 * 11 sits one step BELOW the ratio (would be 10) by deliberate exception —
 * it's the legibility floor for chrome metadata. Below the music, but above
 * silence. Do not add a tier between 14 and 12, or between 17 and 21; those
 * are the dead intervals of the ladder.
 */

/* ─── Display: focal numbers + page titles ─────────────────────────────── */

/** Page-level h1 — serif Times, the screen's headline. */
export const H1 = 'text-3xl tracking-tight text-foreground';
/** Inline style — apply with style={{ fontFamily: 'var(--font-title)' }} */
export const TITLE_FONT = { fontFamily: 'var(--font-title)' } as const;

/** Focal stat number — same scale as H1 but treated as data. Use serif. */
export const STAT_NUMBER = 'text-3xl tracking-tight text-foreground tabular-nums';
/** Compact stat (when 4+ are in a row). 25px = H1 × 1/1.2. */
export const STAT_NUMBER_COMPACT = 'text-[25px] leading-tight tracking-tight text-foreground tabular-nums';

/* ─── Section headings ─────────────────────────────────────────────────── */

/** Section h2 — sub-page heading. 21px = STAT_COMPACT × 1/1.2. */
export const H2 = 'text-[21px] leading-snug tracking-tight font-semibold text-foreground';

/** Card / panel heading. 17px = H2 × 1/1.2. */
export const H3 = 'text-[17px] leading-snug font-semibold text-foreground';

/** Quiet small-caps section label (above a group of fields or rows). */
export const SECTION_LABEL =
  'text-[11px] font-medium uppercase tracking-wider text-muted-foreground';

/* ─── Body ─────────────────────────────────────────────────────────────── */

/** Default body — 14px, the trunk of the ladder. */
export const BODY = 'text-sm text-foreground';

/** Muted body — subtitles, helper text, secondary info. */
export const BODY_MUTED = 'text-sm text-muted-foreground';

/**
 * Compact body for dense surfaces (tables, sidebars).
 *
 * Aliases BODY at the snapped ladder — the old 13px tier was a dead
 * interval between BODY (14) and CAPTION (12) that the eye couldn't
 * sense as a distinct step. Kept as a named import so existing call
 * sites read semantically ("this is the compact zone") without
 * fracturing the ladder.
 */
export const BODY_COMPACT = BODY;

/** Caption / chrome / metadata. 12px = BODY × 1/1.2. */
export const CAPTION = 'text-xs text-muted-foreground';

/** Smallest tabular metadata (timestamps, ids). */
export const META = 'text-[11px] tabular-nums text-muted-foreground';

/* ─── Spacing rhythm ───────────────────────────────────────────────────── */

/** Between MAJOR page sections (header → list → empty state). */
export const PAGE_RHYTHM = 'space-y-12';

/** Between sub-sections within a section. */
export const SECTION_RHYTHM = 'space-y-6';

/** Between form fields or list rows. */
export const FIELD_RHYTHM = 'space-y-4';

/** Tight inline cluster (label + chip, icon + text). */
export const INLINE_TIGHT = 'gap-1.5';

/** Standard inline cluster (toolbar buttons, action row). */
export const INLINE = 'gap-2';

/** Between hairline-divided rows: padding only, no margin. */
export const ROW_PAD = 'py-3';
export const ROW_PAD_TIGHT = 'py-2.5';

/* ─── Layout containers ────────────────────────────────────────────────── */

/** Standard page container max width — re-exported from the geometry
 *  module (Phase 6) so the Vitruvian macro frame stays in one place. */
export { PAGE_MAX } from '@/lib/geometry';

/** Reading column — single-form pages, settings, intake customize. */
export const READING_MAX = 'max-w-3xl mx-auto';

/* ─── Helper class strings for primary actions ─────────────────────────── */

/** The locked primary action pill. Use on Save / Add / Confirm / Send. */
export const PRIMARY_PILL =
  'inline-flex items-center gap-1.5 rounded-full px-4 h-9 text-sm font-medium ' +
  'bg-foreground text-background hover:bg-foreground/90 active:scale-[0.98] ' +
  'transition-all duration-150 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background';

/**
 * `CHIPPI_PILL` — primary pill for buttons that DIRECTLY invoke
 * Chippi ("Tell Chippi", "Ask Chippi", "Chippi, help with this").
 *
 * Same vocabulary as PRIMARY_PILL but with a barely-perceptible warm
 * halo on hover: the bg shifts to a layered foreground-over-brand
 * gradient so the realtor feels Chippi at the moment they reach for
 * the button. STYLESHEET.md §Color §The brand orange rule sanctions
 * this as one of the five named contexts.
 *
 * Do NOT reach for this on a generic Save / Send / Add button.
 * Those stay PRIMARY_PILL. The warmth is the brand's punctuation —
 * if everything has it, nothing has it.
 *
 * Importing this constant counts as a deliberate brand-orange use
 * for the stray-orange lint rule (Phase 2). Call sites don't need
 * to wrap the class themselves.
 */
export const CHIPPI_PILL =
  'inline-flex items-center gap-1.5 rounded-full px-4 h-9 text-sm font-medium ' +
  'bg-foreground text-background ' +
  'hover:bg-gradient-to-r hover:from-foreground hover:via-foreground hover:to-orange-500/90 ' +
  'active:scale-[0.98] transition-all duration-150 focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-background';

/** Secondary ghost — Cancel, Discard, secondary action. */
export const GHOST_PILL =
  'inline-flex items-center gap-1.5 rounded-full px-4 h-9 text-sm font-medium ' +
  'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] ' +
  'transition-colors duration-150';

/** Quiet text link — "Edit", "Cancel" inline within a row. */
export const QUIET_LINK =
  'text-sm text-muted-foreground hover:text-foreground transition-colors duration-150';
