'use client';

/**
 * `<MarketingMediaSlot>` — explicit placeholder for media the realtor will
 * supply. We never ship royalty-free stock — the brand promise is "calm,
 * paper-flat, and quietly confident", and a stock photo of someone in a
 * suit pointing at a laptop breaks that promise on first impression.
 *
 * Instead, every image/video/diagram on the marketing site renders as a
 * dotted-bordered slot that announces what belongs there. The user pastes
 * the asset into the slot's `description`, and we swap the component for
 * the real media before the surface ships to prod.
 *
 * The slot itself is intentionally not designed to look "good empty" —
 * it's an editor affordance, not a placeholder pattern. If a screen ships
 * with `<MarketingMediaSlot>` visible, the screen is not done.
 */

import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MarketingMediaSlotProps {
  /** What media goes here — described in plain language for the supplier. */
  description: string;
  /** Aspect ratio of the eventual media (`video`, `square`, `wide`, `tall`). */
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  /** Override className for layout. */
  className?: string;
}

const ASPECT_CLASSES: Record<NonNullable<MarketingMediaSlotProps['aspect']>, string> = {
  video: 'aspect-video',
  square: 'aspect-square',
  wide: 'aspect-[21/9]',
  tall: 'aspect-[3/4]',
};

export function MarketingMediaSlot({
  description,
  aspect = 'video',
  className,
}: MarketingMediaSlotProps) {
  return (
    <div
      role="img"
      aria-label={`Media slot: ${description}`}
      data-marketing-media-slot
      className={cn(
        'relative w-full overflow-hidden rounded-2xl',
        'border border-dashed border-border/70 bg-muted/30',
        'flex items-center justify-center p-6',
        ASPECT_CLASSES[aspect],
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <ImageIcon
          size={20}
          strokeWidth={1.5}
          className="text-muted-foreground/70"
        />
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Media slot
        </p>
        <p className="text-sm text-muted-foreground/90 leading-snug">
          {description}
        </p>
      </div>
    </div>
  );
}
