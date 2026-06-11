'use client';

/**
 * `<MarketingFeatureGrid>` — paper-flat grid used on the features index and
 * for "what's in here" lists on landing pages. Each card is a hairline-only
 * tile with an icon, a serif title, and a one-line description.
 *
 * Apple-discipline:
 * - No shadows. No background fills. Hairline borders only.
 * - Title is serif Times; description is a single muted sentence.
 * - Icon size 16, stroke 1.75 — quiet, not the focal element.
 * - Reveal-on-scroll with stagger; once per page.
 */

import { motion } from 'motion/react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';
import {
  MARKETING_STAGGER_CONTAINER,
  MARKETING_STAGGER_ITEM,
  MARKETING_VIEWPORT,
} from '@/lib/marketing-motion';

export interface MarketingFeatureItem {
  title: string;
  description: string;
  href: string;
  icon?: LucideIcon;
}

export interface MarketingFeatureGridProps {
  items: MarketingFeatureItem[];
  /** Columns at md breakpoint. 2 reads denser, 3 reads as a survey grid. */
  columns?: 2 | 3;
  className?: string;
}

export function MarketingFeatureGrid({
  items,
  columns = 3,
  className,
}: MarketingFeatureGridProps) {
  return (
    <motion.ul
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={MARKETING_STAGGER_CONTAINER}
      className={cn(
        'grid grid-cols-1 sm:grid-cols-2 gap-px bg-border/60 rounded-2xl overflow-hidden border border-border/60',
        columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2',
        className,
      )}
    >
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <motion.li
            key={it.href}
            variants={MARKETING_STAGGER_ITEM}
            className="bg-background"
          >
            <Link
              href={it.href}
              className={cn(
                'group block h-full p-6 md:p-8',
                'transition-colors duration-200 hover:bg-foreground/[0.02]',
              )}
            >
              {Icon && (
                <Icon
                  size={18}
                  strokeWidth={1.75}
                  className="text-foreground/70 mb-5"
                />
              )}
              <h3
                style={TITLE_FONT}
                className="text-[22px] md:text-[24px] leading-tight tracking-tight text-foreground"
              >
                {it.title}
              </h3>
              <p className="mt-2.5 text-sm md:text-[15px] text-muted-foreground leading-snug">
                {it.description}
              </p>
              <span
                aria-hidden
                className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-foreground/85 group-hover:text-foreground transition-colors"
              >
                Learn more <span>→</span>
              </span>
            </Link>
          </motion.li>
        );
      })}
    </motion.ul>
  );
}
