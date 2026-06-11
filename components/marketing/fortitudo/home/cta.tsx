'use client';

/** CTA: fortitudo's ASCII-fielded closing card, dark base (reads on both light
 *  and dark). Chippi's locked primary action → start free trial. */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AsciiField } from '../ascii-field';

export function HomeCTA() {
  return (
    <section className="bg-background px-4 pb-24 sm:pb-32">
      <div className="relative mx-auto max-w-5xl overflow-hidden rounded-marketing-3xl border border-white/10 bg-[#111113] px-6 py-20 text-center sm:py-24">
        <AsciiField className="absolute inset-0 h-full w-full opacity-50" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(255,150,79,0.2),transparent_60%)]" />
        <div className="relative z-10">
          <h2 className="font-brand text-3xl text-white sm:text-4xl lg:text-5xl">
            Bring your inbox. <span className="text-gradient-brand">Chippi does the rest.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/65">
            Seven days free, then your plan price. Connect your email and watch the busywork
            start running itself.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/login/realtor?intent=signup"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-8 py-3.5 text-base font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:brightness-105 hover:shadow-brand/40"
            >
              Start free trial
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 rounded-full border border-white/15 px-8 py-3.5 text-base font-medium text-white/80 transition-colors hover:border-white/30 hover:text-white"
            >
              Book a demo
            </Link>
          </div>
          <p className="mt-4 text-xs text-white/40">Seven-day free trial. Cancel anytime.</p>
        </div>
      </div>
    </section>
  );
}
