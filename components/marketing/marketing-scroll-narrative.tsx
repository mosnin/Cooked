'use client';

/**
 * `<MarketingScrollNarrative>` — sequenced "what your week with Chippi looks
 * like" story used on the homepage and feature pages.
 *
 * Apple-discipline:
 * - The narrative is implied by SEQUENCE, not by scroll-scrubbed pinning.
 *   Pinning is the #1 vibe-coded tell (always janks on iOS, always fights
 *   intersection observers, always breaks on resize). The eye reads "STEP
 *   01 → STEP 02 → STEP 03" and supplies the throughline itself.
 * - Each step is a tick-tock layout — text one side, media the other,
 *   alternating side per step. Same vocabulary as `<MarketingSection>` so
 *   the page reads as one document.
 * - Hairline between steps. No card chrome. No background fill.
 * - Reveal each step on scroll-into-view, once. NO per-step staggered
 *   scroll-scrubbing. The reveal IS the narrative beat.
 *
 * If you need genuine scrollytelling (canvas-scrubbed video, etc.), build
 * a different primitive — don't bend this one.
 */

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';
import {
  MARKETING_REVEAL,
  MARKETING_STAGGER_CONTAINER,
  MARKETING_STAGGER_ITEM,
  MARKETING_VIEWPORT,
} from '@/lib/marketing-motion';
import { MarketingMediaSlot } from './marketing-media-slot';

export interface MarketingScrollNarrativeStep {
  /** Tiny eyebrow above the step number (e.g. "MONDAY MORNING"). Optional. */
  eyebrow?: string;
  /** Step headline — serif Times, the focal element of the step. */
  title: string;
  /** Optional one-sentence subtitle. */
  sub?: string;
  /** Real media for the step — an animated diagram. Preferred. */
  media?: React.ReactNode;
  /** Fallback plain-language description, rendered as a placeholder slot
   *  only when `media` is absent. A finished step ships `media`. */
  mediaDescription?: string;
}

export interface MarketingScrollNarrativeProps {
  /** Steps in order. The first step does NOT show a top hairline. */
  steps: MarketingScrollNarrativeStep[];
  /** Override outer container className. */
  className?: string;
}

/** Render "STEP 01", "STEP 02" — zero-padded so the eye reads them as a series. */
function stepLabel(index: number) {
  return `STEP ${String(index + 1).padStart(2, '0')}`;
}

export function MarketingScrollNarrative({
  steps,
  className,
}: MarketingScrollNarrativeProps) {
  return (
    <div className={cn('relative', className)}>
      {steps.map((step, idx) => {
        const side = idx % 2 === 0 ? 'right' : 'left';
        const isFirst = idx === 0;
        return (
          <motion.section
            key={`${step.title}-${idx}`}
            initial="initial"
            whileInView="enter"
            viewport={MARKETING_VIEWPORT}
            variants={MARKETING_STAGGER_CONTAINER}
            className={cn(
              'relative flex items-center min-h-[80vh] py-24 md:py-32',
              !isFirst && 'border-t border-border/60',
            )}
          >
            <div className="mx-auto w-full max-w-6xl px-6 md:px-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-center">
                <motion.div
                  variants={MARKETING_REVEAL}
                  className={cn(side === 'right' ? 'md:order-1' : 'md:order-2')}
                >
                  <div className="max-w-xl">
                    <motion.p
                      variants={MARKETING_STAGGER_ITEM}
                      className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
                    >
                      {stepLabel(idx)}
                    </motion.p>
                    {step.eyebrow && (
                      <motion.p
                        variants={MARKETING_STAGGER_ITEM}
                        className="mt-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground/80"
                      >
                        {step.eyebrow}
                      </motion.p>
                    )}
                    <motion.h2
                      variants={MARKETING_STAGGER_ITEM}
                      style={TITLE_FONT}
                      className="mt-4 text-[34px] sm:text-[44px] md:text-[56px] leading-[1.05] tracking-[-0.02em] text-foreground"
                    >
                      {step.title}
                    </motion.h2>
                    {step.sub && (
                      <motion.p
                        variants={MARKETING_STAGGER_ITEM}
                        className="mt-5 text-base md:text-lg text-muted-foreground leading-snug"
                      >
                        {step.sub}
                      </motion.p>
                    )}
                  </div>
                </motion.div>
                <motion.div
                  variants={MARKETING_REVEAL}
                  className={cn(side === 'right' ? 'md:order-2' : 'md:order-1')}
                >
                  {step.media ?? (
                    <MarketingMediaSlot
                      aspect="video"
                      description={step.mediaDescription ?? ''}
                    />
                  )}
                </motion.div>
              </div>
            </div>
          </motion.section>
        );
      })}
    </div>
  );
}
