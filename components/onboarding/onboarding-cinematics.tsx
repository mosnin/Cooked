'use client';

/**
 * Onboarding cinematics - the two bookend preloaders that wrap the
 * conversational onboarding.
 *
 *   OnboardingIntro  (Act I)  - the cold open. A title line blur-rises in,
 *                               holds, swaps to the Chippi mark, then the
 *                               whole overlay blurs out to reveal the chat.
 *   OnboardingReady  (Act III) - the build. A few working-words flash one at
 *                               a time, then "Your account is ready.", then it
 *                               dissolves into the dashboard.
 *
 * Both share the EXACT motion vocabulary of the dashboard splash
 * (`components/dashboard/chippi-splash.tsx`): `motion/react`, the Apple-ish
 * expo ease, the blur-rise transition, the serif title font, theme-aware
 * bg/fg, and `prefers-reduced-motion` → render instantly. They read as the
 * same product because they ARE the same vocabulary, not a lookalike.
 *
 * Each fires `onDone` exactly once, after its exit animation completes
 * (via AnimatePresence `onExitComplete`), with a safety timeout so a motion
 * failure can never trap onboarding.
 */

import { useEffect, useState } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react';
import { BrandLogo } from '@/components/brand-logo';

// Same expo ease as the splash - fast start, long gentle settle.
const EASE = [0.22, 1, 0.36, 1] as const;

// ── Act I: the cold open ────────────────────────────────────────────────────

const INTRO_LINE = 'Introducing the future of real estate software.';

// Timeline (ms). line → mark → blur out.
const INTRO_TO_MARK = 2100;
const INTRO_TO_GONE = 3700;
const INTRO_SAFETY = 6000;

export function OnboardingIntro({
  onDone,
  line = INTRO_LINE,
}: {
  onDone: () => void;
  /** The cold-open title line. Defaults to the realtor copy; the brokerage
   *  flow passes its own. */
  line?: string;
}) {
  const [stage, setStage] = useState<'line' | 'mark' | 'gone'>('line');
  const reduce = useReducedMotion();

  useEffect(() => {
    const toMark = setTimeout(() => setStage('mark'), reduce ? 700 : INTRO_TO_MARK);
    const toGone = setTimeout(() => setStage('gone'), reduce ? 1400 : INTRO_TO_GONE);
    const safety = setTimeout(() => setStage('gone'), INTRO_SAFETY);
    return () => {
      clearTimeout(toMark);
      clearTimeout(toGone);
      clearTimeout(safety);
    };
  }, [reduce]);

  // Lock scroll while the overlay is up.
  useEffect(() => {
    if (stage === 'gone') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [stage]);

  const rise = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 18, filter: 'blur(12px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, y: -18, filter: 'blur(12px)' },
      };

  return (
    <AnimatePresence onExitComplete={onDone}>
      {stage !== 'gone' && (
        <motion.div
          key="onboarding-intro"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-background px-6 text-foreground"
          initial={{ opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(14px)' }}
          transition={{ duration: 0.7, ease: EASE }}
          aria-hidden
        >
          <AnimatePresence mode="wait">
            {stage === 'line' ? (
              <motion.h1
                key="intro-line"
                className="max-w-2xl text-center text-3xl leading-tight tracking-tight sm:text-[2.75rem]"
                style={{ fontFamily: 'var(--font-title)' }}
                transition={{ duration: 0.8, ease: EASE }}
                {...rise}
              >
                {line}
              </motion.h1>
            ) : (
              <motion.div
                key="intro-mark"
                transition={{ duration: 0.7, ease: EASE }}
                {...rise}
              >
                <BrandLogo className="h-8 sm:h-9" alt="Chippi" />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Act III: the build ──────────────────────────────────────────────────────

const READY_WORDS = ['Tinkering.', 'Tuning.', 'Done.'] as const;
const READY_FINAL = 'Your account is ready.';

const WORD_MS = 760;       // per working-word, fade in + hold + fade out
const FINAL_HOLD_MS = 1500; // "Your account is ready." holds
const READY_SAFETY_MS = 8000;

/**
 * The closing preloader. Each working-word lives on its own "page" - fading
 * in and out one at a time - then the final line lands and the overlay
 * dissolves into whatever the parent renders next (the dashboard).
 */
export function OnboardingReady({
  onDone,
  words = READY_WORDS,
  finalLine = READY_FINAL,
}: {
  onDone: () => void;
  /** The working-words that flash one at a time. Defaults to the realtor set. */
  words?: readonly string[];
  /** The line that lands before the dissolve. Defaults to the realtor copy. */
  finalLine?: string;
}) {
  // -1 → not started; 0..n-1 → working words; n → final line; 'gone' handled
  // by `done`.
  const [index, setIndex] = useState(0);
  const [showFinal, setShowFinal] = useState(false);
  const [gone, setGone] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const wordMs = reduce ? 420 : WORD_MS;
    const timers: ReturnType<typeof setTimeout>[] = [];

    words.forEach((_, i) => {
      timers.push(setTimeout(() => setIndex(i), i * wordMs));
    });
    // After the last word, show the final line.
    timers.push(setTimeout(() => setShowFinal(true), words.length * wordMs));
    // Then dissolve.
    timers.push(
      setTimeout(
        () => setGone(true),
        words.length * wordMs + (reduce ? 700 : FINAL_HOLD_MS),
      ),
    );
    // Safety: never trap the redirect.
    timers.push(setTimeout(() => setGone(true), READY_SAFETY_MS));
    return () => timers.forEach(clearTimeout);
  }, [reduce, words]);

  useEffect(() => {
    if (gone) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [gone]);

  const rise = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, y: 14, filter: 'blur(10px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
        exit: { opacity: 0, y: -14, filter: 'blur(10px)' },
      };

  return (
    <AnimatePresence onExitComplete={onDone}>
      {!gone && (
        <motion.div
          key="onboarding-ready"
          className="fixed inset-0 z-[200] flex items-center justify-center bg-background px-6 text-foreground"
          initial={{ opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(14px)' }}
          transition={{ duration: 0.7, ease: EASE }}
          aria-hidden
        >
          <AnimatePresence mode="wait">
            {showFinal ? (
              <motion.div
                key="ready-final"
                className="flex flex-col items-center gap-7 text-center"
                transition={{ duration: 0.7, ease: EASE }}
                {...rise}
              >
                <p
                  className="text-3xl tracking-tight sm:text-[2.5rem]"
                  style={{ fontFamily: 'var(--font-title)' }}
                >
                  {finalLine}
                </p>
                <BrandLogo className="h-5 opacity-80" alt="Chippi" />
              </motion.div>
            ) : (
              <motion.p
                key={`ready-word-${index}`}
                className="text-2xl tracking-tight text-muted-foreground sm:text-3xl"
                style={{ fontFamily: 'var(--font-title)' }}
                transition={{ duration: 0.4, ease: EASE }}
                {...rise}
              >
                {words[index]}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
