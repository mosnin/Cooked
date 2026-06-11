'use client';

/**
 * LogoMarquee — a quiet, infinite-scrolling proof strip under the hero.
 *
 * Real brokerage marks, rendered as uniform monochrome silhouettes (black on
 * light, white on dark). Several of the source logos ship in different colors
 * (and a few are white-on-transparent), so forcing one calm tone is what makes
 * them read as a single proof strip instead of a clashing color jumble.
 *
 * Each logo sits in a fixed, equal-width cell and is height- AND width-capped
 * with object-contain, so wide wordmarks (Compass, RE/MAX) and tall marks read
 * at one consistent scale, stay centered, and never stretch or clip at the loop
 * seam. Two duplicated tracks animate x: 0 -> -50% on a linear loop (the
 * standard seamless marquee). Pauses for reduced-motion.
 */

import { motion, useReducedMotion } from 'motion/react';

type Logo = { src: string; alt: string };

const LOGOS: Logo[] = [
  { src: '/marketing/logos/lpt.png', alt: 'Luxe Properties' },
  { src: '/marketing/logos/compass.png', alt: 'Compass' },
  { src: '/marketing/logos/exit.svg', alt: 'EXIT Realty' },
  { src: '/marketing/logos/remax.png', alt: 'RE/MAX' },
  { src: '/marketing/logos/source.png', alt: 'The Source Realty' },
  { src: '/marketing/logos/brokerage4.png', alt: 'Zander Realty Group' },
];

export function LogoMarquee() {
  const reduce = useReducedMotion();
  const track = [...LOGOS, ...LOGOS];

  return (
    <section className="relative py-10 md:py-14">
      <p className="mb-8 text-center text-[12px] font-medium uppercase tracking-[0.2em] text-foreground/40">
        Trusted by professionals at
      </p>

      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
        <motion.div
          className="flex w-max items-center"
          animate={reduce ? undefined : { x: ['0%', '-50%'] }}
          transition={{ duration: 32, ease: 'linear', repeat: Infinity }}
        >
          {track.map((logo, i) => (
            <div
              key={`${logo.alt}-${i}`}
              className="flex h-11 w-28 shrink-0 items-center justify-center px-3 md:w-40"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logo.src}
                alt={logo.alt}
                loading="lazy"
                decoding="async"
                draggable={false}
                className="max-h-5 w-auto max-w-[64px] select-none object-contain opacity-50 brightness-0 md:max-h-6 md:max-w-[84px] dark:opacity-60 dark:invert"
              />
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
