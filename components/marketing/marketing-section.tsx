'use client';

/**
 * `<MarketingSection>` — the workhorse layout the homepage and product
 * pages alternate to tell a story. Apple's "tick-tock": text on one side,
 * media on the other; next section flips. The eye learns the rhythm and
 * reads the page faster.
 *
 * Apple-discipline:
 * - One headline per section. Subhead is a SINGLE sentence.
 * - Bullets are rare and short. Default to prose.
 * - Vertical breath: `py-24 md:py-32` — sections need air between them or
 *   the page reads as a brochure.
 * - No card chrome around the media — it sits on the background.
 * - Motion reveals on scroll-into-view, once per section.
 *
 * Tick-tock cadence (side-by-side mode): the media reveals first, the
 * words catch up ~120ms behind. Apple cadence — the picture announces the
 * topic, the words land into it. In stacked mode the words still come
 * first; there's no media-vs-words competition to choreograph.
 *
 * Eyebrow flourish (side-by-side mode only): a 24px hairline grows in to
 * the left of the eyebrow as the section enters viewport. Stacked layouts
 * use centered titles, so the hairline would compete with the centerline —
 * it's intentionally omitted there.
 */

import { motion, useReducedMotion } from 'motion/react';
import type { Variants } from 'framer-motion';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { TITLE_FONT, GHOST_PILL } from '@/lib/typography';
import { EASE_APPLE } from '@/lib/motion';
import {
  MARKETING_REVEAL,
  MARKETING_VIEWPORT,
  MARKETING_STAGGER_CONTAINER,
  MARKETING_STAGGER_ITEM,
} from '@/lib/marketing-motion';

/** Side-by-side reveal — media leads, words catch up 120ms later. Local
 *  variants so the cadence stays inside this primitive; we don't need to
 *  ship two more exports from lib/marketing-motion.ts for a one-off
 *  choreography that only this component cares about. */
const SECTION_MEDIA_REVEAL: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { delay: 0, duration: 0.34, ease: EASE_APPLE },
  },
};
const SECTION_WORDS_REVEAL: Variants = {
  initial: { opacity: 0, y: 12 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { delay: 0.12, duration: 0.34, ease: EASE_APPLE },
  },
};

export interface MarketingSectionProps {
  /** Small all-caps tag above the headline (e.g. "INBOX"). Optional. */
  eyebrow?: string;
  /** Section headline — serif Times, ~40–56px. */
  title: string;
  /** One-sentence subtitle, muted. */
  sub?: string;
  /** Optional bullet list — short verbs, no more than 4. */
  bullets?: string[];
  /** Optional inline link rendered below copy ("Learn more →"). */
  learnMore?: { label: string; href: string };
  /** Which side the media goes on (defaults to right). */
  side?: 'left' | 'right';
  /** Stacked single-column layout — used when the section is media-only or
   *  the words are tight enough that the side-by-side tick-tock isn't needed. */
  stacked?: boolean;
  /** Media (slot or real). Sits opposite the words in tick-tock layout. */
  children?: React.ReactNode;
  /** Override container width. */
  className?: string;
}

export function MarketingSection({
  eyebrow,
  title,
  sub,
  bullets,
  learnMore,
  side = 'right',
  stacked = false,
  children,
  className,
}: MarketingSectionProps) {
  const reduced = useReducedMotion();

  // The hairline flourish only earns its place in side-by-side layouts —
  // stacked layouts have a centered title that the hairline would compete
  // against. Reduced-motion users see the hairline at full width without
  // animation; the visual cue is preserved, just not the growth.
  const showHairline = !stacked;
  const hairline = showHairline ? (
    reduced ? (
      <span
        aria-hidden
        className="block h-px bg-foreground/40 mr-3"
        style={{ width: 24 }}
      />
    ) : (
      <motion.span
        aria-hidden
        initial={{ width: 0 }}
        whileInView={{ width: 24 }}
        viewport={MARKETING_VIEWPORT}
        transition={{ duration: 0.18, ease: EASE_APPLE }}
        className="block h-px bg-foreground/40 mr-3"
      />
    )
  ) : null;

  const words = (
    <div className={cn('max-w-xl', stacked && 'mx-auto text-center')}>
      {eyebrow && (
        <motion.p
          variants={MARKETING_STAGGER_ITEM}
          className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
        >
          {showHairline ? (
            <span className="inline-flex items-center">
              {hairline}
              {eyebrow}
            </span>
          ) : (
            eyebrow
          )}
        </motion.p>
      )}
      <motion.h2
        variants={MARKETING_STAGGER_ITEM}
        style={TITLE_FONT}
        className="mt-4 text-[34px] sm:text-[44px] md:text-[56px] leading-[1.05] tracking-[-0.02em] text-foreground"
      >
        {title}
      </motion.h2>
      {sub && (
        <motion.p
          variants={MARKETING_STAGGER_ITEM}
          className="mt-5 text-base md:text-lg text-muted-foreground leading-snug"
        >
          {sub}
        </motion.p>
      )}
      {bullets && bullets.length > 0 && (
        <motion.ul
          variants={MARKETING_STAGGER_ITEM}
          className={cn(
            'mt-6 space-y-2 text-base text-foreground/85',
            stacked && 'inline-block text-left',
          )}
        >
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-2 h-1 w-1 rounded-full bg-foreground/70 flex-shrink-0"
              />
              <span>{b}</span>
            </li>
          ))}
        </motion.ul>
      )}
      {learnMore && (
        <motion.div variants={MARKETING_STAGGER_ITEM} className="mt-8">
          <Link href={learnMore.href} className={GHOST_PILL}>
            {learnMore.label} <span aria-hidden>→</span>
          </Link>
        </motion.div>
      )}
    </div>
  );

  return (
    <motion.section
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={MARKETING_STAGGER_CONTAINER}
      className={cn('relative py-24 md:py-32', className)}
    >
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        {stacked ? (
          <div className="space-y-12">
            {words}
            {children && <motion.div variants={MARKETING_REVEAL}>{children}</motion.div>}
          </div>
        ) : (
          <div
            className={cn(
              'grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-center',
            )}
          >
            <motion.div
              variants={SECTION_WORDS_REVEAL}
              className={side === 'right' ? 'md:order-1' : 'md:order-2'}
            >
              {words}
            </motion.div>
            {children && (
              <motion.div
                variants={SECTION_MEDIA_REVEAL}
                className={side === 'right' ? 'md:order-2' : 'md:order-1'}
              >
                {children}
              </motion.div>
            )}
          </div>
        )}
      </div>
    </motion.section>
  );
}
