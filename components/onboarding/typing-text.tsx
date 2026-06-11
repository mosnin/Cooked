'use client';

/**
 * `TypingText` - types a string out character-by-character so a line
 * of copy reads as if it's being written live, right now, by Chippi.
 *
 * Built for the onboarding reveal (the first-touch draft Chippi
 * "writes" before the dashboard loads) and reused by the Phase 4
 * morning-story reveal. The whole emotional payload is the SENSE that
 * Chippi is working in front of you - so the animation is the point,
 * not decoration.
 *
 * Accessibility + restraint:
 *   - Honors `prefers-reduced-motion`: renders the full string
 *     instantly and fires `onDone` on the next tick. No motion, no
 *     dead air for someone who asked for stillness.
 *   - A blinking caret shows during typing, hides when done. Caret is
 *     foreground, not orange - the brand signature belongs to the
 *     content, not the cursor.
 *   - The full text is always in the DOM (visually truncated via
 *     slice) so screen readers and copy-paste get the whole message,
 *     not a half-typed fragment.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface TypingTextProps {
  /** The full string to type out. */
  text: string;
  /** Characters per second. Default 42 - fast enough to feel eager,
   *  slow enough to read along. */
  charsPerSecond?: number;
  /** Delay before typing begins, ms. Lets a container settle first. */
  startDelayMs?: number;
  /** Fired once the last character lands (or immediately under
   *  reduced-motion). */
  onDone?: () => void;
  className?: string;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TypingText({
  text,
  charsPerSecond = 42,
  startDelayMs = 250,
  onDone,
  className,
}: TypingTextProps) {
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  // Keep onDone in a ref so a changing callback identity doesn't
  // restart the typing effect mid-stream.
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    let cancelled = false;
    let startTimer: ReturnType<typeof setTimeout>;
    let tickTimer: ReturnType<typeof setInterval>;

    // Reduced motion → show everything at once, then signal done.
    if (prefersReducedMotion()) {
      setCount(text.length);
      setDone(true);
      const t = setTimeout(() => { if (!cancelled) onDoneRef.current?.(); }, 0);
      return () => { cancelled = true; clearTimeout(t); };
    }

    setCount(0);
    setDone(false);
    const intervalMs = Math.max(8, Math.round(1000 / charsPerSecond));

    startTimer = setTimeout(() => {
      tickTimer = setInterval(() => {
        if (cancelled) return;
        setCount((c) => {
          const next = c + 1;
          if (next >= text.length) {
            clearInterval(tickTimer);
            setDone(true);
            onDoneRef.current?.();
            return text.length;
          }
          return next;
        });
      }, intervalMs);
    }, startDelayMs);

    return () => {
      cancelled = true;
      clearTimeout(startTimer);
      clearInterval(tickTimer);
    };
  }, [text, charsPerSecond, startDelayMs]);

  const shown = text.slice(0, count);

  return (
    <span className={cn('whitespace-pre-line', className)} aria-label={text}>
      <span aria-hidden>{shown}</span>
      {!done && (
        <span
          aria-hidden
          className="inline-block w-[2px] h-[1.1em] -mb-[0.15em] ml-[1px] bg-foreground/70 animate-pulse"
        />
      )}
    </span>
  );
}
