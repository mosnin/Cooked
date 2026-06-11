'use client';

/**
 * TryFreeCTA — the first ask, placed once the value has landed. A single
 * full-bleed dark panel: one bold line, one button. Calm confidence, no
 * second option competing.
 */

import Link from 'next/link';
import { Reveal } from './home-kit';

export function TryFreeCTA() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12 md:px-8 md:py-16">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-[#171310] px-8 py-16 text-center md:px-16 md:py-24">
          {/* warm wash bleeding up from the floor */}
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
              Bring your inbox. Chippi takes it from there.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-white/55">
              Seven days free. No credit card. Set up in minutes.
            </p>
            <Link
              href="/login/realtor?intent=signup"
              className="mt-9 inline-flex h-12 items-center justify-center rounded-full bg-brand px-8 text-[15px] font-semibold text-[#2a1402] transition-transform duration-150 active:scale-[0.98]"
            >
              Start free
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
