'use client';

/**
 * Account-switch transition — the Chippi-logo swipe shown when a user moves
 * between their realtor workspace and their brokerage.
 *
 * Why a sessionStorage flag instead of an in-place overlay: switching crosses
 * a layout boundary (`/s/[slug]/*` ↔ `/broker/*`), so any overlay rendered by
 * the trigger would unmount the instant navigation starts. Instead the trigger
 * sets a one-shot flag and the DESTINATION layout plays the swipe on arrival —
 * it survives the route change because it mounts fresh on the other side.
 *
 *   triggerAccountSwitch()  — call onClick, just before navigating.
 *   peekSwitchFlag()        — read without clearing (lets ChippiSplash yield
 *                             to the swipe without a clear-order race).
 *   <AccountSwitchSwipe />  — mount once per dashboard layout; plays + clears.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BrandLogo } from '@/components/brand-logo';

const SWITCH_FLAG = 'chippi:account-switch';
const EASE = [0.22, 1, 0.36, 1] as const;

/** Mark that the next navigation is an account switch. Call before pushing. */
export function triggerAccountSwitch(): void {
  try {
    sessionStorage.setItem(SWITCH_FLAG, '1');
  } catch {
    /* sessionStorage unavailable (private mode / SSR) — degrade silently */
  }
}

/** Read the flag WITHOUT clearing it. ChippiSplash uses this (in a render-time
 *  initializer) to step aside when a switch is in progress, so the two never
 *  stack. AccountSwitchSwipe is the one that clears it. */
export function peekSwitchFlag(): boolean {
  try {
    return sessionStorage.getItem(SWITCH_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * The swipe itself. A full-bleed panel carries the Chippi mark in from the
 * right, holds a beat, then carries out to the left — a clean directional
 * swipe. Reduced motion → a brief fade. Self-clears the flag and unmounts.
 */
export function AccountSwitchSwipe() {
  // Read the flag synchronously on first render so the swipe is decided before
  // any effect runs (keeps it in lockstep with ChippiSplash's render-time read).
  const [armed] = useState(() => peekSwitchFlag());
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false);
  const reduce = useReducedMotion();

  // Clear the flag once, on mount, so a later normal open doesn't replay it.
  useEffect(() => {
    if (!armed) return;
    try { sessionStorage.removeItem(SWITCH_FLAG); } catch { /* noop */ }
    const hold = setTimeout(() => setLeaving(true), reduce ? 220 : 620);
    const safety = setTimeout(() => { setLeaving(true); setDone(true); }, 3000);
    return () => { clearTimeout(hold); clearTimeout(safety); };
  }, [armed, reduce]);

  // Lock scroll while it's up.
  useEffect(() => {
    if (!armed || done) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [armed, done]);

  if (!armed || done) return null;

  return (
    <AnimatePresence onExitComplete={() => setDone(true)}>
      {!leaving && (
        <motion.div
          key="account-switch-swipe"
          className="fixed inset-0 z-[210] flex items-center justify-center bg-background"
          initial={reduce ? { opacity: 0 } : { x: '100%' }}
          animate={reduce ? { opacity: 1 } : { x: '0%' }}
          exit={reduce ? { opacity: 0 } : { x: '-100%' }}
          transition={{ duration: reduce ? 0.2 : 0.5, ease: EASE }}
          aria-hidden
        >
          <BrandLogo className="h-7" alt="Chippi" />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
