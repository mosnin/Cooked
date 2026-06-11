'use client';

/**
 * `<MarketingStatRow>` — a row of figures for the about / teams pages.
 *
 * Apple-discipline:
 * - Numbers are serif Times, ~40–56px. Labels are quiet small-caps below.
 * - Hairline verticals between columns on desktop — same paper-flat
 *   vocabulary as the rest of the marketing site. No card chrome, no fills.
 * - Numbers arrive as STRINGS (e.g. "12k", "98%", "$2.4B") so the page
 *   author controls formatting. The component does not parse, format, or
 *   animate them. Number-counting tweens are the #1 vibe-coded tell — and
 *   they read as "I'm proving the number is impressive" instead of letting
 *   the number be impressive on its own.
 * - One scroll-reveal on mount. A 30ms stagger between columns so the eye
 *   reads left-to-right; anything longer becomes a performance.
 */

import { motion } from 'motion/react';
import type { Variants } from 'framer-motion';
import { cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';
import {
  MARKETING_STAGGER_ITEM,
  MARKETING_VIEWPORT,
} from '@/lib/marketing-motion';

/** Local 30ms stagger container — short enough to read as "arrival",
 *  not as "animation". Children still use the canonical
 *  MARKETING_STAGGER_ITEM variant for fade+translate. */
const STAT_ROW_CONTAINER: Variants = {
  initial: { opacity: 1 },
  enter: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.02 },
  },
};

export interface MarketingStatRowStat {
  /** Pre-formatted number string (e.g. "12k", "98%", "$2.4B"). */
  number: string;
  /** Quiet small-caps label below. */
  label: string;
}

export interface MarketingStatRowProps {
  /** 2–4 stats; the grid is 2 cols mobile, 4 cols desktop. */
  stats: MarketingStatRowStat[];
  /** Override outer container className. */
  className?: string;
}

export function MarketingStatRow({ stats, className }: MarketingStatRowProps) {
  return (
    <motion.section
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={STAT_ROW_CONTAINER}
      className={cn('relative py-16 md:py-20', className)}
    >
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <ul className="grid grid-cols-2 md:grid-cols-4 gap-12">
          {stats.map((s, idx) => {
            const isLast = idx === stats.length - 1;
            return (
              <motion.li
                key={`${s.label}-${idx}`}
                variants={MARKETING_STAGGER_ITEM}
                className={cn(
                  'text-center md:px-6',
                  !isLast && 'md:border-r md:border-border/60',
                )}
              >
                <p
                  style={TITLE_FONT}
                  className="text-[40px] md:text-[56px] leading-[1.05] tracking-tight text-foreground tabular-nums"
                >
                  {s.number}
                </p>
                <p className="mt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </p>
              </motion.li>
            );
          })}
        </ul>
      </div>
    </motion.section>
  );
}
