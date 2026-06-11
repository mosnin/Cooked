'use client';

/**
 * DotFlow: the hero status chip: a dot-grid animation that loops through
 * named states (drafting → booking → scoring) with the label morphing in.
 * Ported from fortitudo. GSAP drives the width + label swap; the dot grid is
 * DotLoader. Themed via the className hooks (defaults preserve the dark pill).
 */

import { useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { cn } from '@/lib/utils';
import { DotLoader } from './dot-loader';

export type DotFlowProps = {
  items: {
    title: string;
    frames: number[][];
    duration?: number;
    repeatCount?: number;
  }[];
  className?: string;
  dotClassName?: string;
  textClassName?: string;
};

export const DotFlow = ({ items, className, dotClassName, textClassName }: DotFlowProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [textIndex, setTextIndex] = useState(0);

  const { contextSafe } = useGSAP();

  useEffect(() => {
    if (!containerRef.current || !textRef.current) return;
    const newWidth = textRef.current.offsetWidth + 1;
    gsap.to(containerRef.current, { width: newWidth, duration: 0.5, ease: 'power2.out' });
  }, [textIndex]);

  const next = contextSafe(() => {
    const el = containerRef.current;
    if (!el) return;
    gsap.to(el, {
      y: 20,
      opacity: 0,
      filter: 'blur(8px)',
      duration: 0.5,
      ease: 'power2.in',
      onComplete: () => {
        setTextIndex((prev) => (prev + 1) % items.length);
        gsap.fromTo(
          el,
          { y: -20, opacity: 0, filter: 'blur(4px)' },
          { y: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'power2.out' },
        );
      },
    });
    setIndex((prev) => (prev + 1) % items.length);
  });

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-full bg-foreground/[0.04] px-4 py-3',
        className,
      )}
    >
      <DotLoader
        frames={items[index].frames}
        onComplete={next}
        className="gap-px"
        repeatCount={items[index].repeatCount ?? 1}
        duration={items[index].duration ?? 150}
        dotClassName={cn('bg-foreground/15 [&.active]:bg-brand size-1', dotClassName)}
      />
      <div ref={containerRef} className="relative">
        <div
          ref={textRef}
          className={cn(
            'inline-block whitespace-nowrap text-sm font-medium text-foreground',
            textClassName,
          )}
        >
          {items[textIndex].title}
        </div>
      </div>
    </div>
  );
};
