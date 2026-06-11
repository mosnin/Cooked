'use client';

/**
 * SpotlightCard: a subtle card where a soft brand-orange glow tracks the
 * cursor on hover, with a gentle lift and a top hairline. Ported from
 * fortitudo and made theme-aware: it leans on the semantic card/border tokens
 * so it reads on both light and dark (fortitudo's original was dark-only).
 * Brand orange (#ff964f) is the glow, reserved as the studio signature.
 */

import type { ReactNode } from 'react';
import { useRef } from 'react';
import { cn } from '@/lib/utils';

export function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--y', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMouseMove}
      className={cn(
        'group relative overflow-hidden rounded-marketing-3xl border border-border/70 bg-card transition-all duration-300 hover:-translate-y-1 hover:border-brand/40',
        className,
      )}
    >
      {/* Cursor-tracking brand glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(360px circle at var(--x) var(--y), rgba(255,150,79,0.12), transparent 60%)',
        }}
      />
      {/* Top hairline. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
      />
      <div className="relative h-full">{children}</div>
    </div>
  );
}
