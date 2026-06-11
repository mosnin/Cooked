'use client';

/**
 * `<MarketingIntegrations>` — the integrations grid that lives on
 * /features/communication and /features/calendar (and any other page that
 * wants to enumerate Chippi's third-party connections).
 *
 * Structure mirrors Apple's product-page "compatible with" grids: a left-
 * weighted heading block, optional media slot on the right, then a multi-
 * column grid of small tiles. Each tile is icon + name + one-line
 * description — calm, dense, scannable.
 *
 * Apple-discipline holds throughout:
 * - Headline is serif Times via TITLE_FONT. No squiggle underline trope.
 * - Hairline-only borders on the icon containers (no shadows, no glow).
 * - Motion uses MARKETING_STAGGER_CONTAINER/ITEM — no spring, no rotate.
 * - lucide-react icons only (no hotlinked SVG URLs, no royalty-free media).
 * - Brand orange does NOT appear here.
 */

import { motion } from 'motion/react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TITLE_FONT, GHOST_PILL } from '@/lib/typography';
import {
  MARKETING_REVEAL,
  MARKETING_STAGGER_CONTAINER,
  MARKETING_STAGGER_ITEM,
  MARKETING_VIEWPORT,
} from '@/lib/marketing-motion';
import { MarketingMediaSlot } from './marketing-media-slot';

export interface MarketingIntegration {
  /** The integration's display name (e.g. "Gmail"). */
  name: string;
  /** One-sentence description. Lowercase verbs, ends with a period. */
  description: string;
  /** Lucide icon shown in the hairline-bordered square. */
  icon: LucideIcon;
  /** Optional deep-link to a per-integration page (none today; future-proof). */
  href?: string;
  /** Renders a small "Soon" pill in the tile when true. */
  comingSoon?: boolean;
}

export interface MarketingIntegrationsProps {
  /** Small all-caps eyebrow above the title. */
  eyebrow?: string;
  /** Section headline. Serif Times via TITLE_FONT. */
  title: string;
  /** One-sentence subtitle. */
  sub?: string;
  /** When provided, renders a MarketingMediaSlot on the right (desktop) /
   *  above the grid (mobile). The user supplies real media later. */
  mediaDescription?: string;
  integrations: MarketingIntegration[];
  /** Optional inline "Learn more" link below the grid. */
  learnMore?: { label: string; href: string };
  /** Override section spacing/width. */
  className?: string;
}

export function MarketingIntegrations({
  eyebrow,
  title,
  sub,
  mediaDescription,
  integrations,
  learnMore,
  className,
}: MarketingIntegrationsProps) {
  const hasMedia = Boolean(mediaDescription);

  return (
    <motion.section
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={MARKETING_STAGGER_CONTAINER}
      className={cn('relative py-24 md:py-32', className)}
    >
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        {/* Header — two-column when media present, single-column otherwise. */}
        <div
          className={cn(
            'grid grid-cols-1 items-start gap-x-12 gap-y-10',
            hasMedia && 'lg:grid-cols-2',
          )}
        >
          <motion.div variants={MARKETING_REVEAL} className="max-w-xl">
            {eyebrow && (
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {eyebrow}
              </p>
            )}
            <h2
              style={TITLE_FONT}
              className="mt-4 text-[34px] sm:text-[44px] md:text-[56px] leading-[1.05] tracking-[-0.02em] text-foreground"
            >
              {title}
            </h2>
            {sub && (
              <p className="mt-5 text-base md:text-lg text-muted-foreground leading-snug">
                {sub}
              </p>
            )}
          </motion.div>
          {hasMedia && (
            <motion.div variants={MARKETING_REVEAL}>
              <MarketingMediaSlot
                aspect="square"
                description={mediaDescription!}
              />
            </motion.div>
          )}
        </div>

        {/* Grid */}
        <motion.ul
          variants={MARKETING_STAGGER_CONTAINER}
          className="mt-16 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-10"
        >
          {integrations.map((it) => (
            <motion.li
              key={it.name}
              variants={MARKETING_STAGGER_ITEM}
              className="flex items-start gap-4"
            >
              {it.href ? (
                <Link
                  href={it.href}
                  className="group flex items-start gap-4 -m-2 p-2 rounded-lg transition-colors duration-150 hover:bg-foreground/[0.025]"
                >
                  <IntegrationIcon icon={it.icon} />
                  <IntegrationCopy
                    name={it.name}
                    description={it.description}
                    comingSoon={it.comingSoon}
                  />
                </Link>
              ) : (
                <>
                  <IntegrationIcon icon={it.icon} />
                  <IntegrationCopy
                    name={it.name}
                    description={it.description}
                    comingSoon={it.comingSoon}
                  />
                </>
              )}
            </motion.li>
          ))}
        </motion.ul>

        {learnMore && (
          <motion.div variants={MARKETING_REVEAL} className="mt-12 flex justify-start">
            <Link href={learnMore.href} className={GHOST_PILL}>
              {learnMore.label} <span aria-hidden>→</span>
            </Link>
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}

function IntegrationIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="flex-shrink-0 w-11 h-11 rounded-xl border border-border/70 flex items-center justify-center bg-background transition-colors duration-150 group-hover:border-border">
      <Icon
        size={20}
        strokeWidth={1.75}
        className="text-foreground/65 transition-colors duration-150 group-hover:text-foreground/85"
      />
    </div>
  );
}

function IntegrationCopy({
  name,
  description,
  comingSoon,
}: {
  name: string;
  description: string;
  comingSoon?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground truncate">
          {name}
        </h3>
        {comingSoon && (
          <span className="inline-flex items-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-border/70 rounded-full px-1.5 py-0.5">
            Soon
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground leading-snug">
        {description}
      </p>
    </div>
  );
}
