'use client';

/**
 * `<MarketingHero>` — the surface that opens every marketing page.
 *
 * Apple-discipline:
 * - ONE focal element: the headline. Eyebrow recedes, sub recedes further.
 * - Headline is serif Times via `var(--font-title)` — the loudest typography
 *   on the marketing site.
 * - Optional media slot sits BELOW the headline (centered + full-bleed in
 *   container width) so the eye lands on the words first, then the picture.
 *   When media is provided as a video, autoplay-mute-loop is the default —
 *   no controls, no thumbnail.
 * - Single primary CTA. A secondary ghost link is allowed but never two
 *   primaries.
 *
 * Headline + sub + CTA fade-up on mount (480ms, Apple curve). Media slot
 * fades in 120ms after, so the eye reads the words before the picture
 * announces itself.
 *
 * As the user scrolls past the hero, the media slot drifts upward at
 * roughly 0.92× the page rate — a calm parallax that adds depth without
 * theatre. Words DO NOT parallax; only the picture moves. The effect is
 * disabled entirely for prefers-reduced-motion.
 */

import { useRef } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
} from 'motion/react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { GHOST_PILL } from '@/lib/typography';
import { MARKETING_HERO_REVEAL } from '@/lib/marketing-motion';
import { AsciiField } from '@/components/marketing/fortitudo/ascii-field';

export interface MarketingHeroProps {
  /** Small all-caps label above the headline (e.g. "FOR REALTORS"). Optional. */
  eyebrow?: string;
  /** The page's one focal sentence. Serif Times, ~64–80px on desktop. */
  title: string;
  /** Short subtitle — one sentence. ~18–22px, muted. */
  sub?: string;
  /** Primary CTA — single button, lands first. */
  primaryCta?: { label: string; href: string };
  /** Secondary CTA — ghost link, optional. */
  secondaryCta?: { label: string; href: string };
  /** Optional media slot rendered below the words. */
  children?: React.ReactNode;
  /** Override container width. */
  className?: string;
}

export function MarketingHero({
  eyebrow,
  title,
  sub,
  primaryCta,
  secondaryCta,
  children,
  className,
}: MarketingHeroProps) {
  const heroRef = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  // Media drifts upward 40px as the user scrolls past the hero — a ~0.92
  // ratio against the rest of the page. Hooks must run unconditionally, so
  // we always create the transform and zero it out when reduced motion is
  // requested at the consumer site.
  const yRaw = useTransform(scrollYProgress, [0, 1], [0, -40]);
  const y = reduced ? 0 : yRaw;

  return (
    <section
      ref={heroRef}
      className={cn('relative overflow-hidden pt-32 md:pt-40 pb-12 md:pb-16', className)}
    >
      {/* fortitudo ASCII atmosphere behind the headline, with a center-protect
          radial so the words stay legible on both light and dark. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <AsciiField className="absolute inset-0 h-full w-full opacity-25" cell={14} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,150,79,0.12),transparent_55%)]" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 60% at 50% 40%, var(--background) 32%, transparent 80%)',
          }}
        />
      </div>
      <div className="relative z-10 mx-auto max-w-6xl px-6 md:px-8">
        <div className="text-center max-w-3xl mx-auto">
          {eyebrow && (
            <motion.p
              initial="initial"
              animate="enter"
              variants={MARKETING_HERO_REVEAL}
              className="font-brand text-xs font-medium uppercase tracking-[0.25em] text-brand"
            >
              {eyebrow}
            </motion.p>
          )}
          <motion.h1
            initial="initial"
            animate="enter"
            variants={MARKETING_HERO_REVEAL}
            transition={{ delay: 0.05 }}
            className="font-brand mt-5 text-[40px] sm:text-[56px] md:text-[72px] leading-[1.05] tracking-tight text-foreground"
          >
            {title}
          </motion.h1>
          {sub && (
            <motion.p
              initial="initial"
              animate="enter"
              variants={MARKETING_HERO_REVEAL}
              transition={{ delay: 0.12 }}
              className="mt-6 text-lg md:text-xl text-muted-foreground leading-snug"
            >
              {sub}
            </motion.p>
          )}
          {(primaryCta || secondaryCta) && (
            <motion.div
              initial="initial"
              animate="enter"
              variants={MARKETING_HERO_REVEAL}
              transition={{ delay: 0.18 }}
              className="mt-10 flex items-center justify-center gap-3 flex-wrap"
            >
              {primaryCta && (
                <Link
                  href={primaryCta.href}
                  className="inline-flex h-11 items-center justify-center rounded-full bg-brand px-7 text-sm font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-brand/40"
                >
                  {primaryCta.label}
                </Link>
              )}
              {secondaryCta && (
                <Link href={secondaryCta.href} className={GHOST_PILL}>
                  {secondaryCta.label} <span aria-hidden>→</span>
                </Link>
              )}
            </motion.div>
          )}
        </div>
        {children && (
          <motion.div
            initial="initial"
            animate="enter"
            variants={MARKETING_HERO_REVEAL}
            transition={{ delay: 0.24 }}
            style={{ y }}
            className="mt-16 md:mt-20 will-change-transform"
          >
            {children}
          </motion.div>
        )}
      </div>
    </section>
  );
}
