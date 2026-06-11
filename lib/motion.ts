import type { Variants, Transition } from 'framer-motion';

/** Premium ease-out cubic — Apple-ish curve for entrances. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.4, 0, 0.2, 1];
/** Apple "out-quint" curve — slightly longer settle than EASE_OUT. Use on
 *  entrance moments where the eye has time to read the arrival (page fades,
 *  dialog scale-ins, subject reveals, row entrances, wizard steps,
 *  drop-snap). EASE_OUT is still the default for list staggers. */
export const EASE_APPLE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const DURATION_FAST = 0.15;
export const DURATION_BASE = 0.22;
export const DURATION_SLOW = 0.32;
/**
 * Snap-back when a kanban card is dropped. Deliberately short and tight —
 * no spring overshoot. Matches the Apple Drop guideline of 180ms ease.
 */
export const DURATION_DROP = 0.18;

/** Page-level fade + tiny y-translate. */
export const PAGE_VARIANTS: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST } },
};

/** Stagger container — children animate in sequence. */
export const STAGGER_CONTAINER: Variants = {
  initial: { opacity: 1 },
  enter: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

/** Stagger child — fade + tiny y. Use inside STAGGER_CONTAINER. */
export const STAGGER_ITEM: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: { opacity: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
};

/**
 * Chat-surface entrance — a calmer 8px slide-up for content that lands
 * inside a thread (assistant message bubbles, brief sections). The
 * default PAGE_VARIANTS' 4px movement is right for dense lists; chat
 * bubbles sit looser and benefit from a slightly longer settle so the
 * arrival registers without snapping.
 *
 * Duration sits at 0.26s — past DURATION_BASE (page entrances), short
 * of the 0.3s threshold that starts to feel sluggish. Use directly with
 * `initial`/`animate` on motion elements.
 */
export const CHAT_ENTRANCE_VARIANTS: Variants = {
  initial: { opacity: 0, y: 8 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.26, ease: EASE_OUT } },
};

/** Stagger delay between siblings inside a chat-surface list (suggestion
 *  chips, brief sections). 40ms — Apple cadence, not the 100ms that
 *  reads as "animation". */
export const CHAT_STAGGER_DELAY = 0.04;

/** Hover scale for rows/cards — very subtle. */
export const HOVER_ROW: Transition = { duration: DURATION_FAST };

/** Modal/dialog content variant. */
export const DIALOG_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.97, y: 4 },
  enter: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION_BASE, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: DURATION_FAST } },
};
