/**
 * Marketing-site motion vocabulary.
 *
 * Apple-discipline: short, calm fades with a small translate. No springs,
 * no rotates, no scale-from-zero. The eye should feel arrival, not motion.
 *
 * Sites that read as "vibe-coded" all share the same tell — spring physics
 * and 600ms+ entrances. We reject both here.
 */

import type { Variants, Transition } from 'framer-motion';
import { EASE_APPLE } from '@/lib/motion';

/** Single entrance for content that lands as the section scrolls into view. */
export const MARKETING_REVEAL: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE_APPLE } },
};

/** Stagger container for revealing a row/grid of items in sequence. */
export const MARKETING_STAGGER_CONTAINER: Variants = {
  initial: { opacity: 1 },
  enter: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

/** Child of a stagger container — same fade+translate as MARKETING_REVEAL. */
export const MARKETING_STAGGER_ITEM: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.34, ease: EASE_APPLE } },
};

/** Hero entrance — slightly slower settle than section reveals because the
 *  eye has a moment to read the headline. Capped at 0.5s — past that it
 *  starts to read as "animation", not arrival. */
export const MARKETING_HERO_REVEAL: Variants = {
  initial: { opacity: 0, y: 14 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.48, ease: EASE_APPLE } },
};

/** Viewport reveal config to pass to motion.div's `viewport` prop.
 *  `once: true` means the section animates the first time it enters and
 *  stays put — no re-trigger on scroll-back, which would feel busy. */
export const MARKETING_VIEWPORT = { once: true, amount: 0.2 } as const;

/** Background scrim hover (rare — only on logo strip, etc.). */
export const MARKETING_HOVER: Transition = { duration: 0.18, ease: EASE_APPLE };
