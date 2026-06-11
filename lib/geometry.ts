/**
 * The Vitruvian macro frame — Phase 6.
 *
 * Single source of truth for every layout width above ~200px. Components
 * that lay out the shell (sidebar, page container, FocusCard, ChippiBar)
 * import their width from here so the geometry can never silently drift.
 *
 * ── The lattice ────────────────────────────────────────────────────────────
 *
 * The macro frame sits on TWO honest number families.
 *
 * 1. The rhythm family — multiples of U = 48 (the top of the harmonic
 *    spacing ladder 48 → 24 → 16 → 12, Pythagorean octave → fifth → fourth).
 *
 *      Sidebar       = U × 5  = 240
 *      ChippiBar     = U × 16 = 768
 *      Page padding  = U × 1  = 48   (lg, single side)
 *
 * 2. The φ family — the FocusCard inscribed inside the content column.
 *
 *      Page max          = 1500       (the design ceiling — chosen, not
 *                                       derived. The widest container any
 *                                       surface earns. Never wider.)
 *      Content column    = Page max - 2 × Page padding = 1404
 *      FocusCard         = round(Column / φ) = 868      (φ ≈ 1.618)
 *      Golden shoulder   = (Column - FocusCard) / 2 = 268
 *
 *    The FocusCard is the golden rectangle inscribed in the column. The
 *    shoulder is the golden complement that makes the card feel
 *    deliberate rather than small.
 *
 * 3. The chrome exception — collapsed sidebar = 56. Icon-rail convention,
 *    not a rhythm multiple. Documented as such so it doesn't drift.
 *
 * ── What this module is NOT ─────────────────────────────────────────────────
 *
 * Not a token for every width. Sub-container widths (max-w-2xl reading
 * columns, max-w-md modals) live in Tailwind because they're idiomatic
 * and don't compete with the macro frame. The cut-off is ~200px: anything
 * that lays out the shell or a focal surface lives here; chrome and form
 * containers stay in Tailwind utility classes.
 *
 * Mobile is governed by `mx-auto` + viewport, not by this module — these
 * numbers are CEILINGS, applied via `max-w-*`, and yield gracefully below
 * their threshold. The one exception is the sidebar, which is hidden
 * below `md`.
 */

/** Top of the harmonic spacing ladder (Pythagorean octave). The unit
 *  that rhythm-family widths multiply against. */
export const RHYTHM_U = 48;

/** The golden ratio. Used to inscribe the FocusCard inside the column. */
export const PHI = (1 + Math.sqrt(5)) / 2;

/* ─── Rhythm-family widths (multiples of RHYTHM_U) ────────────────────── */

/** Open sidebar — `RHYTHM_U × 5`. */
export const SIDEBAR_WIDTH_PX = 240;
/** Collapsed sidebar — icon-rail convention. Not derived from RHYTHM_U;
 *  this is the named exception so it doesn't drift. */
export const SIDEBAR_COLLAPSED_PX = 56;
/** ChippiBar (persistent floating composer) — `RHYTHM_U × 16`. */
export const CHIPPI_BAR_WIDTH_PX = 768;
/** Page padding, large viewport, single side — `RHYTHM_U × 1`. */
export const PAGE_PAD_LG_PX = 48;

/* ─── φ-family widths (the FocusCard chain) ───────────────────────────── */

/** The design ceiling. The widest container any surface earns. */
export const PAGE_MAX_PX = 1500;
/** Inner content column — `PAGE_MAX_PX - 2 × PAGE_PAD_LG_PX`. */
export const CONTENT_COLUMN_PX = PAGE_MAX_PX - 2 * PAGE_PAD_LG_PX;
/** FocusCard — the golden rectangle inscribed in the content column.
 *  `round(CONTENT_COLUMN_PX / PHI)`. */
export const FOCUS_CARD_WIDTH_PX = Math.round(CONTENT_COLUMN_PX / PHI);

/* ─── Tailwind class string tokens — what components actually import ──── */

/** Open sidebar width as a Tailwind class. */
export const SIDEBAR_WIDTH = 'w-[240px]';
/** Collapsed sidebar width as a Tailwind class. */
export const SIDEBAR_COLLAPSED = 'w-[56px]';
/** Page max width — applied to the dashboard shell + every wide page. */
export const PAGE_MAX = 'max-w-[1500px]';
/** FocusCard max width — the golden inset. */
export const FOCUS_CARD_MAX = 'max-w-[868px]';
/** ChippiBar max width — 768px matches Tailwind's `max-w-3xl`, kept as
 *  a named export so the intent reads clearly at the call site. */
export const CHIPPI_BAR_MAX = 'max-w-3xl';
