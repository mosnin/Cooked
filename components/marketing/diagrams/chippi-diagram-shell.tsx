'use client';

/**
 * `<ChippiDiagramShell>` — the paper-flat container every animated UI
 * diagram lives inside on the marketing site. Same aspect props as the
 * `<MarketingMediaSlot>` it replaces so swapping in a diagram doesn't
 * disturb the page layout.
 *
 * Apple-discipline contract enforced by the shell:
 *   - Hairline border only (`border-border/60`). No shadow. No gradient.
 *   - `bg-background` so the content reads as a cropped view of the real
 *     product, not a tinted "promotional surface".
 *   - `overflow-hidden` + `rounded-2xl` — the only place 2xl earns its
 *     place in our system, sanctioned by the stylesheet's marketing carve-out.
 *   - Honors `prefers-reduced-motion` via a tiny context the children read.
 *     When reduced, the diagram is expected to render in its END state and
 *     skip the internal loop entirely.
 *
 * The shell does NOT animate the container itself — the diagram inside is
 * what carries the motion. The shell is the page-folded paper card the
 * diagram lives on.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { brandOrange } from '@/lib/colors';

type Aspect = 'video' | 'square' | 'wide' | 'tall';

const ASPECT_CLASSES: Record<Aspect, string> = {
  video: 'aspect-video',
  square: 'aspect-square',
  wide: 'aspect-[21/9]',
  tall: 'aspect-[3/4]',
};

/**
 * Minimum height floor per aspect. `aspect-ratio` alone derives height from
 * the rendered WIDTH — and in a two-column marketing grid the media column
 * is only ~520px wide, so `aspect-video` collapses to ~290px and
 * `aspect-[21/9]` to ~220px. That's shorter than the diagrams' content, so
 * `overflow-hidden` was clipping every one of them.
 *
 * The floor lets the short, wide aspects grow tall enough to hold the
 * diagram. `min-height` wins over the aspect-ratio-computed height, so the
 * box becomes a touch taller than 16:9 at narrow widths and snaps back to
 * the true ratio once the column is wide enough for the ratio to exceed the
 * floor. Square/tall don't need a floor — they're already tall for a given
 * width.
 */
const ASPECT_MIN_H: Record<Aspect, string> = {
  video: 'min-h-[320px] md:min-h-[360px]',
  wide: 'min-h-[300px] md:min-h-[340px]',
  square: '',
  tall: '',
};

interface ChippiDiagramMotionContextValue {
  /** True when `prefers-reduced-motion: reduce` is set. Children should
   *  render in their end state and skip internal timers when true. */
  reduced: boolean;
}

const ChippiDiagramMotionContext = createContext<ChippiDiagramMotionContextValue>({
  reduced: false,
});

/**
 * Read by every diagram primitive to decide whether to run its internal
 * loop or land in the end state immediately. Components that don't use
 * the loop (static rows, single fades on mount) can ignore this.
 */
export function useDiagramMotion(): ChippiDiagramMotionContextValue {
  return useContext(ChippiDiagramMotionContext);
}

export interface ChippiDiagramShellProps {
  aspect?: Aspect;
  /** Padding density. `8` is the default; tight surfaces (kanban, calendar)
   *  use `6`. Smaller than 6 isn't sanctioned — the diagrams need breath. */
  pad?: 6 | 8;
  /** Optional one-line caption below a hairline-separated footer. Keep the
   *  copy lowercase, one sentence, ending in a period. */
  caption?: string;
  className?: string;
  children: ReactNode;
}

export function ChippiDiagramShell({
  aspect = 'video',
  pad = 8,
  caption,
  className,
  children,
}: ChippiDiagramShellProps) {
  const reduced = useReducedMotion() ?? false;
  const padClass = pad === 6 ? 'p-6' : 'p-8';

  return (
    <ChippiDiagramMotionContext.Provider value={{ reduced }}>
      <div
        data-chippi-diagram
        className={cn(
          'relative w-full overflow-hidden rounded-2xl',
          'border border-border/60 bg-background',
          'flex flex-col',
          ASPECT_CLASSES[aspect],
          ASPECT_MIN_H[aspect],
          className,
        )}
      >
        <div className={cn('relative flex-1 min-h-0 flex', padClass)}>
          {children}
        </div>
        {caption && (
          <div className="border-t border-border/60 px-6 py-2.5">
            <p className="text-[11px] text-muted-foreground leading-snug">{caption}</p>
          </div>
        )}
      </div>
    </ChippiDiagramMotionContext.Provider>
  );
}

/**
 * The Chippi authorship badge as it lives inside diagrams — same
 * vocabulary as `AgentGeneratedBadge` in product, repeated here so the
 * marketing diagrams import locally rather than reaching into the product
 * tree. Brand orange is sanctioned in exactly the contexts the stylesheet
 * names; this is one of them (AGENT_BADGE / CHIPPI_AVATAR).
 */
export function DiagramChippiBadge({
  label = 'Chippi',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={brandOrange(
        'AGENT_BADGE',
        cn(
          'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5',
          'text-[10px] font-medium leading-none',
          'text-orange-600 dark:text-orange-400',
          'bg-orange-500/[0.08] dark:bg-orange-500/[0.12]',
          className,
        ),
      )}
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500 dark:bg-orange-400"
      />
      {label}
    </span>
  );
}

