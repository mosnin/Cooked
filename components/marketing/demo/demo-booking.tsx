'use client';

/**
 * DemoBooking — the /demo page body. One focal element: the scheduler.
 *
 * Compact hero (subtle AsciiBlob atmosphere, eyebrow, serif headline, one
 * line of who-it's-for) → the scheduler in the home's window-frame language →
 * a quiet "start now" reassurance line. Matches the rebuilt homepage family
 * (Reveal/Eyebrow/AsciiBlob, light canvas, single reading column).
 *
 * ── Swapping in the real Calendly ──────────────────────────────────────────
 * Paste your Calendly inline-embed URL into CALENDLY_URL below. That's it.
 * Empty → the calm placeholder renders. Set → a responsive iframe renders.
 * A plain iframe to the Calendly URL is the whole integration; we deliberately
 * do NOT load Calendly's external <script>/widget.js — no new dependency, and
 * the swap stays a one-liner.
 */

import Link from 'next/link';
import { AsciiBlob } from '@/components/marketing/home/ascii-blob';
import { Reveal, Eyebrow } from '@/components/marketing/home/home-kit';

// TODO: paste the Calendly inline-embed URL here
// e.g. 'https://calendly.com/your-org/chippi-walkthrough'
const CALENDLY_URL = '';

export function DemoBooking() {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle Chippi-orange atmosphere, kept quiet behind the reading zone. */}
      <AsciiBlob className="opacity-50" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(65% 55% at 50% 30%, var(--background) 38%, transparent 82%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-24 md:px-8 md:py-32">
        {/* Compact hero — one idea: see Chippi run, then book a time. */}
        <Reveal className="text-center">
          <Eyebrow>Book a demo</Eyebrow>
          <h1
            style={{ fontFamily: 'var(--font-title)' }}
            className="mx-auto mt-6 max-w-2xl text-[clamp(2.25rem,5.5vw,3.75rem)] font-normal leading-[1.04] tracking-[-0.018em] text-foreground"
          >
            See Chippi run your floor.
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-foreground/60">
            For brokerages and teams sizing up Chippi. Pick a time and
            we&rsquo;ll walk your floor through it live: the inbox, the drafts,
            the deals it keeps current. then we answer how it fits your book.
          </p>
        </Reveal>

        {/* The scheduler — the page's one focal element, in the home's
            window-frame vocabulary. */}
        <Reveal delay={0.08} className="mt-14 md:mt-16">
          <div className="overflow-hidden rounded-[1.75rem] bg-card ring-1 ring-border/70 shadow-[0_40px_120px_-32px_rgba(0,0,0,0.28)]">
            <div className="flex h-9 items-center gap-1.5 border-b border-border/60 px-4">
              <span className="h-2.5 w-2.5 rounded-full bg-foreground/12" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-foreground/12" aria-hidden />
              <span className="h-2.5 w-2.5 rounded-full bg-foreground/12" aria-hidden />
              <span className="mx-auto select-none rounded-md bg-foreground/[0.04] px-3 py-1 text-[11px] text-muted-foreground/80">
                book a time
              </span>
              <span aria-hidden className="w-[42px]" />
            </div>

            {CALENDLY_URL ? (
              // Real scheduler: a plain responsive iframe to the Calendly URL.
              <iframe
                src={CALENDLY_URL}
                title="Book a demo with Chippi"
                className="min-h-[680px] w-full border-0 bg-card"
                loading="lazy"
              />
            ) : (
              // Calm placeholder until the URL is set. Reads as "scheduler
              // goes here", deliberately — not an error, not dashed clutter.
              <div className="flex min-h-[680px] w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-black/[0.03] to-black/[0.06] p-8 text-center">
                <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-black/35">
                  Calendly embed
                </span>
                <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                  paste your scheduling URL in{' '}
                  <code className="rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-foreground/70">
                    CALENDLY_URL
                  </code>{' '}
                  to go live.
                </p>
              </div>
            )}
          </div>
        </Reveal>

        {/* Quiet reassurance / secondary CTA — no second ask competing. */}
        <Reveal delay={0.12} className="mt-10 text-center">
          <p className="text-sm text-muted-foreground">
            prefer to start now?{' '}
            <Link
              href="/login/realtor?intent=signup"
              className="font-medium text-foreground underline-offset-4 transition-colors hover:underline"
            >
              start free
            </Link>
            .
          </p>
        </Reveal>
      </div>
    </section>
  );
}
