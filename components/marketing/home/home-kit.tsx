'use client';

/**
 * Home v2 kit — the shared vocabulary for the rebuilt homepage. Editorial,
 * bold-sans, light-canvas aesthetic (ref: Soviet-TV / KAIRO / Stripe boards).
 *
 * Everything here is motion-aware (motion/react) and honors reduced-motion.
 * The homepage composes these; nothing here leaks into the product app.
 */

import { useRef } from 'react';
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type Variants,
} from 'motion/react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';

export const HOME_EASE = EASE_APPLE;

/**
 * Scroll-into-view reveal — the homepage's signature entrance. Opacity +
 * travel + a brief blur-in on the Apple curve. The blur is what makes it read
 * as "focusing into place" rather than just sliding. Reduced-motion shows
 * instantly.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
  once = true,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y, filter: 'blur(8px)' }}
      whileInView={reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once, amount: 0.25 }}
      transition={{ duration: 0.85, ease: HOME_EASE, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger container + item — same focus-into-place beat, sequenced. */
export const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.11, delayChildren: 0.06 } },
};
export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.8, ease: HOME_EASE },
  },
};

export function Stagger({
  children,
  className,
  amount = 0.2,
}: {
  children: React.ReactNode;
  className?: string;
  amount?: number;
}) {
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={className} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

/**
 * Parallax — scroll-linked vertical drift for layered depth (the hero
 * product, section media). Content moves slower than the page as it passes
 * through the viewport. Disabled for reduced-motion.
 */
export function Parallax({
  children,
  className,
  distance = 60,
}: {
  children: React.ReactNode;
  className?: string;
  distance?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [distance, -distance]);
  return (
    <motion.div ref={ref} style={reduce ? undefined : { y }} className={className}>
      {children}
    </motion.div>
  );
}

/**
 * Studio eyebrow: fortitudo's brand-orange small-caps label in the brand
 * display face. The `tone` prop is retained for call-site compatibility (some
 * pages pass `onDark`/`brand`), but the brand-orange treatment now reads on
 * both light and dark so every tone resolves to the same accent.
 */
export function Eyebrow({
  children,
  tone: _tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'onDark' | 'brand';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'font-brand inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.25em] text-brand',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Image placeholder — a clean, intentional empty slot the owner swaps for
 * real media. Soft neutral fill, hairline ring, centered label + ratio.
 * Not dashed/ugly — it should read as "media goes here", deliberately.
 */
export function Placeholder({
  label,
  className,
  aspect = 'aspect-[4/3]',
  tone = 'light',
}: {
  label?: string;
  className?: string;
  aspect?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div
      role="img"
      aria-label={label ? `Placeholder: ${label}` : 'Image placeholder'}
      className={cn(
        'relative w-full overflow-hidden rounded-3xl ring-1',
        aspect,
        tone === 'light'
          ? 'bg-gradient-to-br from-black/[0.04] to-black/[0.07] ring-black/[0.06]'
          : 'bg-white/[0.04] ring-white/[0.08]',
        className,
      )}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center">
        <span
          className={cn(
            'text-[11px] font-medium uppercase tracking-[0.18em]',
            tone === 'light' ? 'text-black/35' : 'text-white/40',
          )}
        >
          {label ?? 'Image'}
        </span>
      </div>
    </div>
  );
}

/** Decorative ↗ / ↙ arrow chip (ref: Soviet-TV red card corners). */
export function ArrowChip({
  dir = 'up-right',
  className,
}: {
  dir?: 'up-right' | 'down-left';
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-9 w-9 items-center justify-center', className)}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="stroke-current">
        {dir === 'up-right' ? (
          <path d="M7 17 17 7M17 7H8M17 7v9" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M17 7 7 17M7 17h9M7 17V8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}
