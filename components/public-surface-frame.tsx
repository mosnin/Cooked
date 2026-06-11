'use client';

/**
 * PublicSurfaceFrame — the shared desktop chrome for every applicant-facing
 * surface: /p/[slug] (profile), /apply/[slug] (intake), /book/[slug] (tour
 * booking), /tour/[token] (tour manage).
 *
 * All four surfaces are the realtor's storefront for a stranger. On
 * desktop they should feel like one product family: a centred card
 * floating over a heavy-blurred image fill (the realtor's cover photo or
 * face when neither is set, a neutral gradient). On mobile the card
 * expands to the full viewport — the blur is invisible underneath a
 * full-width card and would only spend bandwidth.
 *
 * The card vocabulary is identical to /p/[slug] but the max width is a
 * prop so the intake (which carries a chat) can be a little wider than
 * the profile's link-in-bio scale without forking the chrome.
 */

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PublicSurfaceFrameProps {
  /** Image that fills the desktop blur canvas. Usually the realtor's
   *  cover photo; falls back to their face; null = neutral gradient. */
  blurSource?: string | null;
  /** Card max-width on sm+. Defaults to 480px (the /p/[slug] scale).
   *  /apply uses 540, /book uses 520. Mobile ignores. */
  maxWidthClass?: string;
  /** Forces dark mode within the frame regardless of the parent
   *  document state — applicants see whatever the realtor branded for. */
  darkMode?: boolean;
  /** When true the card on sm+ uses overflow-hidden, clipping the cover
   *  photo into the rounded corners. Set this when the first child is a
   *  hero image. Off when the card scrolls vertically (intake chat). */
  clipContent?: boolean;
  /** Extra outer classes (e.g. font-family). */
  className?: string;
  children: ReactNode;
}

export function PublicSurfaceFrame({
  blurSource,
  maxWidthClass = 'max-w-[480px]',
  darkMode = false,
  clipContent = true,
  className,
  children,
}: PublicSurfaceFrameProps) {
  return (
    <div
      className={cn(
        // Mobile uses the card's background so any iOS safe-area strip
        // behind the notch reads as flush with the card.
        'relative min-h-screen bg-background sm:bg-muted/40',
        darkMode && 'dark',
        className,
      )}
    >
      {/* Desktop blur canvas — only sm+. A 48px blur on a phone is
          expensive and the card already fills the viewport on mobile. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 hidden sm:block"
      >
        {blurSource ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blurSource}
              alt=""
              loading="eager"
              decoding="async"
              className="h-full w-full scale-110 object-cover blur-[48px]"
            />
            {/* Darkening overlay so the card stays legible against any
                image. 45% is a compromise between "still visibly the
                photo" and "card text stays calm." */}
            <div className="absolute inset-0 bg-black/45" />
          </>
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-muted/60 via-muted/40 to-muted/60" />
        )}
      </div>

      {/* The card. On mobile this fills the viewport edge-to-edge. On sm+
          it floats — rounded, hairline-bordered, optionally clipping its
          first child into the corners. */}
      <div
        className={cn(
          'relative mx-auto w-full bg-background sm:my-8',
          'sm:rounded-[28px] sm:border sm:border-border/60',
          clipContent && 'sm:overflow-hidden',
          maxWidthClass,
        )}
      >
        {children}
      </div>
    </div>
  );
}
