'use client';

/**
 * Home hero: fortitudo's centered ASCII hero with the rotating headline word
 * and the dot-flow status chip, carrying Chippi's copy. The ASCII drifts up on
 * scroll; the content lifts + fades. Theme-aware: the hero sits on the page
 * background (white in light, near-black in dark) with the orange ASCII field
 * over it, so it reads on both modes.
 */

import { useRef } from 'react';
import Link from 'next/link';
import { motion, useScroll, useTransform } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { AsciiField } from '../ascii-field';
import { RotatingWord } from '../rotating-word';
import { DotFlow, type DotFlowProps } from '../dot-flow';

// Compact dot-grid loops for the hero chip: the studio's signature motif.
const drafting = [
  [24],
  [17, 23, 25, 31],
  [10, 16, 18, 30, 32, 38],
  [9, 11, 37, 39, 3, 45],
  [10, 16, 18, 30, 32, 38],
  [17, 23, 25, 31],
];
const scoring = [
  [],
  [3],
  [10, 2, 4],
  [17, 9, 11, 5],
  [24, 16, 18, 12],
  [31, 23, 25, 19],
  [38, 30, 32, 26],
  [45, 37, 39, 33],
];
const booking = [
  [14, 15, 16, 17, 18, 19, 20],
  [21, 22, 23, 24, 25, 26, 27],
  [28, 29, 30, 31, 32, 33, 34],
  [21, 22, 23, 24, 25, 26, 27],
];

const heroItems: DotFlowProps['items'] = [
  { title: 'Drafting', frames: drafting, repeatCount: 2, duration: 160 },
  { title: 'Scoring', frames: scoring, repeatCount: 2, duration: 130 },
  { title: 'Booking', frames: booking, repeatCount: 2, duration: 150 },
];

const easeOut = [0.16, 1, 0.3, 1] as const;
const container = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } } };
const item = {
  hidden: { opacity: 0, y: 18, filter: 'blur(6px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: easeOut } },
};

export function HomeHero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const asciiY = useTransform(scrollYProgress, [0, 1], [0, 140]);
  const contentY = useTransform(scrollYProgress, [0, 1], [0, 70]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.85], [1, 0]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background pt-24"
    >
      <motion.div style={{ y: asciiY }} className="absolute inset-0">
        <AsciiField className="absolute inset-0 h-full w-full opacity-30" cell={14} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,150,79,0.16),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(255,150,79,0.08),transparent_50%)]" />
        {/* Center-protect: keep the headline zone calm/legible. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 42%, var(--background) 30%, transparent 78%)',
          }}
        />
      </motion.div>

      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="relative z-10 mx-auto max-w-5xl px-4 text-center sm:px-6 lg:px-8"
      >
        <motion.div variants={container} initial="hidden" animate="show" className="flex flex-col items-center gap-7">
          <motion.p variants={item} className="font-brand text-xs uppercase tracking-[0.3em] text-brand">
            Chippi // the agentic OS for real estate
          </motion.p>

          <motion.h1
            variants={item}
            className="font-brand text-4xl leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl"
          >
            <span className="block">You close the deals.</span>
            <span className="block">Chippi does the</span>
            <span className="block">
              <RotatingWord
                words={['drafting', 'scoring', 'booking', 'chasing', 'rest']}
                className="text-gradient-brand"
              />
            </span>
          </motion.h1>

          <motion.p variants={item} className="max-w-2xl text-lg text-foreground/60 sm:text-xl">
            Chippi reads your inbox, drafts replies in your voice, books the tours, and keeps
            every deal current. The busywork runs itself, and nothing leaves without your name
            on it.
          </motion.p>

          <motion.div variants={item} className="mt-1 flex flex-col items-center gap-4 sm:flex-row">
            <Link
              href="/login/realtor?intent=signup"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-8 py-3.5 text-base font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-brand/40"
            >
              Start free trial
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-full border border-border/70 px-8 py-3.5 text-base font-medium text-foreground/80 transition-colors hover:border-border hover:text-foreground"
            >
              Watch demo
            </Link>
          </motion.div>

          <motion.div variants={item} className="mt-4">
            <DotFlow items={heroItems} className="border border-border/60 backdrop-blur-md" />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
