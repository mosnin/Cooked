'use client';

/**
 * `<MarketingHeroHome>` — the opening hero for the logged-out homepage (`/`).
 *
 * Premium/luxury rebuild. The old hero was a full-bleed stock photo with a
 * dark overlay and an orange CTA pill — the real-estate-website cliché, and a
 * break of our own foreground-button rule. This replaces it with the move the
 * best software sites make: lead with the product.
 *
 * The composition:
 *   - Centered serif headline (--font-title) + one-sentence sub.
 *   - A FOREGROUND primary CTA (PRIMARY_PILL) — no orange, per the brand rule.
 *   - The live product surface floating below in an app-window frame: a real
 *     animated Chippi diagram inside a hairline-bordered window with a soft
 *     shadow and a gradient floor settling it into the page.
 *
 * No photo. No foreign theme tokens. Brand orange stays scarce — it appears
 * only where Chippi authors something inside the product surface, never on the
 * chrome. The backdrop is a single neutral radial so the product reads as lit,
 * not decorated.
 *
 * Entrance fades up on the Apple curve; the window lands a beat after the
 * words. Honors reduced-motion.
 */

import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { TITLE_FONT, PRIMARY_PILL, GHOST_PILL } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { ComposerDraftDiagram } from '@/components/marketing/diagrams';

export interface HeroCta {
  label: string;
  href: string;
}

export interface MarketingHeroHomeProps {
  eyebrow?: string;
  title: string;
  sub?: string;
  primaryCta: HeroCta;
  secondaryCta?: HeroCta;
}

const EASE = [0.22, 1, 0.36, 1] as const;

export function MarketingHeroHome({
  eyebrow,
  title,
  sub,
  primaryCta,
  secondaryCta,
}: MarketingHeroHomeProps) {
  const reduce = useReducedMotion();

  const rise: Variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 18 },
        show: { opacity: 1, y: 0 },
      };
  const container: Variants = {
    show: { transition: { staggerChildren: 0.08, delayChildren: 0.04 } },
  };
  const frameRise: Variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, y: 28 }, show: { opacity: 1, y: 0 } };

  return (
    <section className="relative overflow-hidden">
      {/* Backdrop — a single neutral radial spotlight so the product window
          reads as lit. No photo, no orange, no gradient parade. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 12%, rgba(120,120,128,0.10), transparent 70%)',
        }}
      />
      {/* Faint top hairline grid — the only structural flourish, barely there. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/50"
      />

      <div className="relative mx-auto max-w-6xl px-6 md:px-8 pt-24 pb-16 md:pt-32 md:pb-24">
        {/* Words */}
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="mx-auto max-w-3xl text-center"
        >
          {eyebrow && (
            <motion.p
              variants={rise}
              transition={{ duration: 0.5, ease: EASE }}
              className="mb-5 text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
            >
              {eyebrow}
            </motion.p>
          )}

          <motion.h1
            variants={rise}
            transition={{ duration: 0.6, ease: EASE }}
            style={TITLE_FONT}
            className="text-balance text-[44px] leading-[1.04] tracking-[-0.02em] text-foreground sm:text-6xl md:text-[72px]"
          >
            {title}
          </motion.h1>

          {sub && (
            <motion.p
              variants={rise}
              transition={{ duration: 0.6, ease: EASE }}
              className="mx-auto mt-6 max-w-2xl text-lg leading-snug text-muted-foreground md:text-xl"
            >
              {sub}
            </motion.p>
          )}

          <motion.div
            variants={rise}
            transition={{ duration: 0.6, ease: EASE }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link href={primaryCta.href} className={PRIMARY_PILL}>
              {primaryCta.label}
            </Link>
            {secondaryCta && (
              <Link href={secondaryCta.href} className={GHOST_PILL}>
                {secondaryCta.label} <span aria-hidden>→</span>
              </Link>
            )}
          </motion.div>
        </motion.div>

        {/* Product surface — the hero's real subject. A live Chippi diagram
            framed in an app window that floats above a gradient floor. */}
        <motion.div
          variants={frameRise}
          initial="hidden"
          animate="show"
          transition={{ duration: 0.7, ease: EASE, delay: reduce ? 0 : 0.22 }}
          className="relative mx-auto mt-16 max-w-4xl md:mt-20"
        >
          <ProductWindow>
            <ComposerDraftDiagram
              aspect="video"
              className="rounded-none border-0"
            />
          </ProductWindow>
          {/* Gradient floor — settles the window into the page so it doesn't
              read as a clipped rectangle. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -bottom-px h-24 bg-gradient-to-b from-transparent to-background"
          />
        </motion.div>
      </div>
    </section>
  );
}

/**
 * `<ProductWindow>` — the app-window frame the hero product surface lives in.
 * Hairline border, a slim top bar with the three traffic-light dots and a
 * faux address, and the one soft shadow the marketing layer is allowed (the
 * product chrome forbids shadows; this is marketing). The body is borderless
 * so the framed diagram doesn't double-border.
 */
function ProductWindow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border/70 bg-background',
        'shadow-2xl shadow-foreground/[0.08]',
      )}
    >
      <div className="flex h-9 items-center gap-2 border-b border-border/60 px-4">
        <span aria-hidden className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="mx-auto select-none rounded-md bg-foreground/[0.04] px-3 py-1 text-[11px] text-muted-foreground/80">
          app.chippi.ai
        </span>
        {/* Balances the traffic lights so the address sits dead-center. */}
        <span aria-hidden className="w-[42px]" />
      </div>
      {children}
    </div>
  );
}
