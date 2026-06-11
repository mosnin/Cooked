'use client';

/**
 * RealtorsHero — the /realtors opener. Same atmosphere as the homepage hero:
 * the Chippi-orange ASCII blob drifting behind, a center-protect radial keeping
 * the headline zone calm, a settle-into-page gradient at the floor. The promise
 * here is narrower than home's: Chippi is the teammate who works the field with
 * you — reachable on whatever screen is already in your hand.
 *
 * The composed media is the live composer-draft diagram framed in the same
 * app-window language as the homepage, drifting on scroll.
 */

import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { Parallax } from '@/components/marketing/home/home-kit';
import { AsciiBlob } from '@/components/marketing/home/ascii-blob';
import { ComposerDraftDiagram } from '@/components/marketing/diagrams';

const EASE = [0.22, 1, 0.36, 1] as const;

export function RealtorsHero() {
  const reduce = useReducedMotion();

  const rise: Variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 26, filter: 'blur(8px)' },
        show: { opacity: 1, y: 0, filter: 'blur(0px)' },
      };
  const container: Variants = {
    show: { transition: { staggerChildren: 0.12, delayChildren: 0.06 } },
  };

  return (
    <section className="relative overflow-hidden bg-background">
      <AsciiBlob />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 32%, var(--background) 32%, transparent 78%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-muted"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-24 pb-14 md:px-8 md:pt-36 md:pb-24">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="mx-auto max-w-4xl text-center"
        >
          <motion.div variants={rise} transition={{ duration: 0.7, ease: EASE }}>
            <span className="inline-flex items-center gap-2 rounded-full bg-card/80 px-3.5 py-1.5 text-[12px] font-medium text-foreground/70 ring-1 ring-border/70 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              For the solo realtor
            </span>
          </motion.div>

          <motion.h1
            variants={rise}
            transition={{ duration: 0.9, ease: EASE }}
            className="font-brand mt-7 text-[clamp(2.25rem,6vw,4.75rem)] leading-[1.05] tracking-tight text-foreground"
          >
            <span className="block">An extra teammate</span>
            <span className="block">
              in the <em className="font-bold italic text-brand">field.</em>
            </span>
          </motion.h1>

          <motion.p
            variants={rise}
            transition={{ duration: 0.9, ease: EASE }}
            className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-foreground/60 md:text-xl"
          >
            you&rsquo;re out getting deals done: at the showing, in the car, between
            doors. Chippi reads the inbox, drafts the reply, books the tour, and
            keeps every deal current while you work. nothing leaves without your
            tap.
          </motion.p>

          <motion.div
            variants={rise}
            transition={{ duration: 0.9, ease: EASE }}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              href="/login/realtor?intent=signup"
              className="inline-flex h-12 items-center justify-center rounded-full bg-brand px-7 text-[15px] font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
            >
              Start free
            </Link>
            <Link
              href="/demo"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-card/80 px-6 text-[15px] font-medium text-foreground ring-1 ring-border/70 backdrop-blur transition-colors hover:bg-card"
            >
              Book a demo
            </Link>
          </motion.div>
        </motion.div>

        <Parallax distance={48} className="relative mx-auto mt-16 max-w-4xl md:mt-24">
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1, ease: EASE, delay: reduce ? 0 : 0.5 }}
          >
            <ComposerDraftDiagram aspect="video" />
          </motion.div>
        </Parallax>
      </div>
    </section>
  );
}
