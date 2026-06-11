'use client';

/**
 * ClosingCTA — the final ask on /realtors. Same full-bleed dark panel and warm
 * floor-wash as the homepage's TryFreeCTA, so the page lands in the same family.
 * The realtor has seen the whole story by now; this is the one place two CTAs
 * sit side by side — start free, or book a demo if they'd rather be walked
 * through it. Brand orange stays in the wash, never on the buttons.
 */

import Link from 'next/link';
import { Reveal } from '@/components/marketing/home/home-kit';

export function ClosingCTA() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12 md:px-8 md:py-16">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-[#171310] px-8 py-16 text-center md:px-16 md:py-24">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(60% 80% at 50% 120%, rgba(255,150,79,0.30), transparent 70%)',
            }}
          />
          <div className="relative">
            <h2 className="mx-auto max-w-3xl font-title text-[clamp(2rem,5vw,3.75rem)] font-normal leading-[1.04] tracking-[-0.018em] text-white">
              the teammate who works the field with you.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-white/55">
              seven days free. no credit card. bring your inbox and let Chippi do
              the rest.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login/realtor?intent=signup"
                className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-[15px] font-medium text-[#171310] transition-transform duration-150 active:scale-[0.98]"
              >
                Start free
              </Link>
              <Link
                href="/demo"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white/10 px-6 text-[15px] font-medium text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15"
              >
                Book a demo
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
