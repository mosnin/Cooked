'use client';

/**
 * `<MarketingLogoStrip>` — the quiet "trusted by" row.
 *
 * Apple-discipline:
 * - Static row, evenly spaced. NO marquee scroll, NO infinite loop — that's
 *   a Shopify-template tell. Logos that earn the spot don't need to keep
 *   moving for the eye to find them.
 * - Greyscale media slots (the slot itself reads as a placeholder; the
 *   real logos arrive in PR follow-on and ship as greyscale SVG).
 * - Stagger reveal on scroll-into-view, once.
 * - Optional eyebrow above ("USED BY REAL ESTATE PROS") and optional muted
 *   subhead below ("12,000+ real estate professionals.") — both recede
 *   so the logo row is the focal element.
 *
 * Logos are passed in as `{ name }` only. The component picks the visual
 * (a `<MarketingMediaSlot>` until real assets land), so we never accept
 * raw `src` URLs and never accidentally ship a stock image.
 */

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import {
  MARKETING_STAGGER_CONTAINER,
  MARKETING_STAGGER_ITEM,
  MARKETING_VIEWPORT,
} from '@/lib/marketing-motion';
import { MarketingMediaSlot } from './marketing-media-slot';

export interface MarketingLogoStripItem {
  /** Customer / brand name — used as the slot description. */
  name: string;
}

export interface MarketingLogoStripProps {
  /** Logos to display, in order, left to right. */
  items: MarketingLogoStripItem[];
  /** Small all-caps label above the row. Defaults to "USED BY REAL ESTATE PROS". */
  eyebrow?: string;
  /** Optional muted line below the row (e.g. "12,000+ real estate professionals."). */
  subhead?: string;
  /** Override the per-logo slot className (e.g. to shrink or widen). */
  logoClassName?: string;
  /** Override outer container className. */
  className?: string;
}

export function MarketingLogoStrip({
  items,
  eyebrow = 'USED BY REAL ESTATE PROS',
  subhead,
  logoClassName,
  className,
}: MarketingLogoStripProps) {
  return (
    <motion.section
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={MARKETING_STAGGER_CONTAINER}
      className={cn('relative py-12', className)}
    >
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        {eyebrow && (
          <motion.p
            variants={MARKETING_STAGGER_ITEM}
            className="text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            {eyebrow}
          </motion.p>
        )}
        <motion.ul
          variants={MARKETING_STAGGER_CONTAINER}
          className={cn(
            'mt-8 flex flex-wrap items-center justify-center',
            'gap-x-10 gap-y-6 md:gap-x-14',
          )}
        >
          {items.map((it) => (
            <motion.li
              key={it.name}
              variants={MARKETING_STAGGER_ITEM}
              className="flex items-center"
            >
              <MarketingMediaSlot
                aspect="square"
                description={`Customer logo: ${it.name} (greyscale).`}
                className={cn('h-10 w-10 rounded-md p-2', logoClassName)}
              />
            </motion.li>
          ))}
        </motion.ul>
        {subhead && (
          <motion.p
            variants={MARKETING_STAGGER_ITEM}
            className="mt-6 text-center text-sm text-muted-foreground"
          >
            {subhead}
          </motion.p>
        )}
      </div>
    </motion.section>
  );
}
