'use client';

/**
 * ShimmerText — Chippi's first-person loading voice with the calm gradient
 * shimmer already used in the chat transcript ("Thinking…").
 *
 * Pass a single message for a static line, or an array to rotate every
 * `intervalMs` (default 2.5s) so the surface reads as alive — Chippi is
 * actually doing something, not just waiting. Reuses the existing
 * `.chippi-thinking-shimmer` keyframes in app/globals.css so the visual
 * vocabulary across loading surfaces stays one thing.
 *
 * Voice rules (Jobs):
 *   - First-person, present-tense.
 *   - One concrete verb. Period at the end.
 *   - No "Chippi is...". The product speaks; it doesn't narrate itself.
 *   - No corny adverbs ("just a sec…", "hold tight!"). Calm or silent.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface ShimmerTextProps {
  /** A single line, or an array of lines that rotate. */
  messages: string | readonly string[];
  /** Rotation cadence when `messages` is an array. Default 2500ms. */
  intervalMs?: number;
  className?: string;
}

export function ShimmerText({
  messages,
  intervalMs = 2500,
  className,
}: ShimmerTextProps) {
  const list = Array.isArray(messages) ? messages : [messages as string];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (list.length <= 1) return;
    const id = setInterval(
      () => setIdx((i) => (i + 1) % list.length),
      intervalMs,
    );
    return () => clearInterval(id);
  }, [list.length, intervalMs]);

  return (
    <span className={cn('chippi-thinking-shimmer', className)}>
      {list[idx]}
    </span>
  );
}
