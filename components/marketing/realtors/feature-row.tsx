'use client';

/**
 * FeatureRow — one tick-tock feature section for /realtors. Mirrors the home
 * page's two-column rhythm (copy + composed media), alternating sides, with a
 * Parallax drift on the media and a Reveal entrance on the copy. The media is
 * a live product diagram passed in by the page.
 *
 * Layout vocabulary is lifted straight from deep-features.tsx so the page reads
 * as part of the same family: Eyebrow → serif headline → muted sub → bullet
 * list with a hairline-leading marker.
 */

import type { ReactNode } from 'react';
import { Reveal, Eyebrow, Parallax } from '@/components/marketing/home/home-kit';
import { cn } from '@/lib/utils';

export function FeatureRow({
  eyebrow,
  title,
  sub,
  points,
  media,
  flip = false,
}: {
  eyebrow: string;
  title: ReactNode;
  sub: string;
  points: string[];
  media: ReactNode;
  /** When true, media sits on the left, copy on the right. */
  flip?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-16">
      {/* Copy */}
      <Reveal className={cn(flip && 'md:order-2')}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2rem,4.4vw,3.25rem)] font-normal leading-[1.04] tracking-[-0.025em] text-foreground">
          {title}
        </h2>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-foreground/55">
          {sub}
        </p>
        <ul className="mt-7 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] text-foreground/70">
              <span
                aria-hidden
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/25"
              />
              {p}
            </li>
          ))}
        </ul>
      </Reveal>

      {/* Media */}
      <Reveal delay={0.1} className={cn(flip && 'md:order-1')}>
        <Parallax distance={36}>{media}</Parallax>
      </Reveal>
    </div>
  );
}
