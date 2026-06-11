'use client';

/**
 * Chat primitives for the conversational onboarding.
 *
 * Deliberately mirror the live intake chat (`components/intake-chat`) so
 * onboarding reads as the SAME conversation surface the realtor's own leads
 * will experience - just from the other side of the glass:
 *
 *   - The ACTIVE Chippi question is a focal serif line that types in.
 *   - PAST Chippi questions recede to small muted text.
 *   - The realtor's answers are right-aligned, softly-tinted bubbles.
 *
 * Nothing here talks to the network or owns onboarding state - it's pure
 * presentation. The orchestration (steps, persistence, validation) lives in
 * `onboarding-realtor-v2.tsx`.
 */

import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';
import { TypingText } from './typing-text';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** Soft fade + rise used for every turn as it enters the thread. */
const turnRise = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, ease: EASE_OUT },
};

/**
 * A Chippi message.
 *  - `active`  → focal serif line. Types in when `typing` is set, then fires
 *               `onTyped`. The one the realtor is answering right now.
 *  - past      → small muted text. What Chippi already said.
 */
export function ChippiSays({
  text,
  active = false,
  typing = false,
  onTyped,
}: {
  text: string;
  active?: boolean;
  typing?: boolean;
  onTyped?: () => void;
}) {
  if (!active) {
    return (
      <motion.p {...turnRise} className="text-[15px] leading-snug text-muted-foreground">
        {text}
      </motion.p>
    );
  }
  return (
    <motion.div
      {...turnRise}
      className="text-xl leading-snug tracking-tight text-foreground sm:text-2xl"
      style={TITLE_FONT}
    >
      {typing ? (
        <TypingText text={text} charsPerSecond={46} startDelayMs={180} onDone={onTyped} />
      ) : (
        text
      )}
    </motion.div>
  );
}

/** The realtor's answer - right-aligned, softly tinted bubble. Matches the
 *  intake chat's `UserTurn` vocabulary (foreground tint here, since onboarding
 *  has no per-space accent color yet). */
export function UserSays({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...turnRise} className="flex justify-end">
      <div
        className={cn(
          'ml-auto max-w-[85%] rounded-2xl rounded-br-md border border-border/70',
          'bg-foreground/[0.04] px-4 py-2.5 text-[15px] leading-relaxed text-foreground',
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}

/**
 * The inline answer affordance under the active question (input, pickers,
 * cards). Fades in a beat after the question finishes typing so the realtor
 * reads the question first, then sees how to answer.
 */
export function AnswerAffordance({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className={cn(!show && 'pointer-events-none')}
      aria-hidden={!show}
    >
      {children}
    </motion.div>
  );
}

/**
 * Scroll container that keeps the newest turn in view as the thread grows.
 * Key the content so a new turn smoothly settles at the bottom.
 */
export function Thread({
  children,
  signal,
}: {
  children: React.ReactNode;
  /** Changes only at the moments worth scrolling for - a new question
   *  arriving or the answer affordance revealing. Keyed on this so typing
   *  into an input never yanks the view. */
  signal?: string | number;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [signal]);
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-5 pb-40 pt-24 sm:pt-28">
      {children}
      <div ref={endRef} />
    </div>
  );
}
