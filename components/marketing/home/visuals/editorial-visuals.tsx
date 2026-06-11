/**
 * MonogramAvatar — a calm, paper-flat avatar placeholder for testimonials
 * until real headshots land. A neutral muted circle with a quiet user mark;
 * no generated doodle. Honest about being a placeholder, and finished-looking.
 */

import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MonogramAvatar({ className }: { seed?: string; className?: string }) {
  return (
    <div
      className={cn(
        'relative flex aspect-square w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted',
        className,
      )}
      aria-hidden
    >
      <User size={16} strokeWidth={1.75} className="text-foreground/25" />
    </div>
  );
}
