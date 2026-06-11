/**
 * MediaSlot — the one placeholder primitive for the homepage.
 *
 * We have no real product captures yet. Rather than fake substance with
 * line-art doodles (which read as unfinished), every visual hole on the page
 * uses this: a calm, paper-flat muted panel with a single quiet mark. It looks
 * deliberate and finished — a frame waiting for a real screenshot or video,
 * not a broken image. Drop the real asset in later; the frame stays.
 */

import { ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MediaSlot({
  className,
  iconSize = 24,
}: {
  className?: string;
  iconSize?: number;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-muted',
        className,
      )}
    >
      <ImageIcon
        size={iconSize}
        strokeWidth={1.5}
        className="text-foreground/[0.14]"
      />
    </div>
  );
}
