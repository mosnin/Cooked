'use client';

/**
 * RotatingWord: a single word that morphs to the next on an interval (blur +
 * vertical slide), so it reads as a soft morph rather than a hard cut. Used in
 * the marketing hero headline. Ported from fortitudo. Honors reduced-motion.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';

const easeOut = [0.16, 1, 0.3, 1] as const;

export function RotatingWord({
  words,
  className,
  interval = 2200,
}: {
  words: string[];
  className?: string;
  interval?: number;
}) {
  const [i, setI] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || words.length <= 1) return;
    const id = setInterval(() => setI((p) => (p + 1) % words.length), interval);
    return () => clearInterval(id);
  }, [words.length, interval, reduce]);

  return (
    <span className="relative inline-flex justify-center">
      {/* Invisible sizer keeps the line from collapsing during the swap. */}
      <span className="invisible" aria-hidden="true">
        {words.reduce((a, b) => (a.length >= b.length ? a : b), '')}
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={words[i]}
            initial={{ y: '0.45em', opacity: 0, filter: 'blur(10px)' }}
            animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
            exit={{ y: '-0.45em', opacity: 0, filter: 'blur(10px)' }}
            transition={{ duration: 0.5, ease: easeOut }}
            className={cn('whitespace-nowrap', className)}
          >
            {words[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
