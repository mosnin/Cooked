'use client';

/**
 * `<MarketingCTA>` — bottom-of-page call to action. Single primary, single
 * secondary at most. Lives inside its own padded section with generous
 * vertical breath so the CTA reads as an arrival, not an interruption.
 *
 * The primary pill performs a SINGLE scale pulse the first time it enters
 * the viewport — 1 → 1.02 → 1 over 240ms. One beat, then still. The
 * secondary CTA stays calm; only the primary earns the pulse, because
 * only the primary is the one decision the page is asking for. Reduced
 * motion: no pulse at all.
 */

import { motion } from 'motion/react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { MARKETING_REVEAL, MARKETING_VIEWPORT } from '@/lib/marketing-motion';
import { AsciiField } from '@/components/marketing/fortitudo/ascii-field';

export interface MarketingCTAProps {
  title: string;
  sub?: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  className?: string;
}

export function MarketingCTA({
  title,
  sub,
  primaryCta,
  secondaryCta,
  className,
}: MarketingCTAProps) {
  return (
    <motion.section
      initial="initial"
      whileInView="enter"
      viewport={MARKETING_VIEWPORT}
      variants={MARKETING_REVEAL}
      className={cn('relative bg-background px-4 py-24 md:py-32', className)}
    >
      {/* fortitudo ASCII closing card: dark base reads on light + dark. */}
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-marketing-3xl border border-white/10 bg-[#111113] px-6 py-20 text-center sm:py-24">
        <AsciiField className="absolute inset-0 h-full w-full opacity-50" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,150,79,0.2),transparent_60%)]" />
        <div className="relative z-10">
          <h2 className="font-brand text-3xl text-white sm:text-4xl lg:text-5xl">
            {title}
          </h2>
          {sub && (
            <p className="mx-auto mt-5 max-w-xl text-lg leading-snug text-white/65">
              {sub}
            </p>
          )}
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={primaryCta.href}
              className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3.5 text-base font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-brand/40"
            >
              {primaryCta.label}
            </Link>
            {secondaryCta && (
              <Link
                href={secondaryCta.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-8 py-3.5 text-base font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white"
              >
                {secondaryCta.label} <span aria-hidden>→</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
