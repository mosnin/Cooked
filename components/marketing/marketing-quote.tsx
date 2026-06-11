'use client';

/**
 * `<MarketingQuote>` — large typographic pull-quote.
 *
 * Apple-discipline:
 * - This is a typographic MOMENT, not a testimonial card. No border, no
 *   background fill, no avatar circle, no quote-mark glyph in a roundel.
 *   Just serif Times at 28–40px sitting in air.
 * - The caller passes the quote in with their own curly quotes (" "); we
 *   render it verbatim. Don't auto-insert glyphs — that's how you get
 *   straight-quote-inside-curly-quote bugs.
 * - Attribution is muted small body, 6 lines below. Optional.
 * - Single reveal on scroll. No per-word stagger. The pause IS the design.
 *
 * If you find yourself reaching for this to render a row of testimonials,
 * you want a different primitive. This one is a singular note.
 */

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';
import { MARKETING_REVEAL, MARKETING_VIEWPORT } from '@/lib/marketing-motion';

export interface MarketingQuoteProps {
  /** The quote. Include your own curly quotes — we render exactly what you pass. */
  quote: string;
  /** Optional attribution line (e.g. "Maria Lopez, Compass"). */
  attribution?: string;
  /** Override outer container className. */
  className?: string;
}

export function MarketingQuote({
  quote,
  attribution,
  className,
}: MarketingQuoteProps) {
  return (
    <motion.section
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={MARKETING_REVEAL}
      className={cn('relative py-24 md:py-32', className)}
    >
      <div className="mx-auto max-w-3xl px-6 md:px-8 text-center">
        <blockquote>
          <p
            style={TITLE_FONT}
            className={cn(
              'text-[28px] md:text-[40px] leading-[1.2] tracking-[-0.01em]',
              'text-foreground',
            )}
          >
            {quote}
          </p>
          {attribution && (
            <footer className="mt-6 text-sm text-muted-foreground">
              <cite className="not-italic">{attribution}</cite>
            </footer>
          )}
        </blockquote>
      </div>
    </motion.section>
  );
}
