'use client';

/**
 * StatsBand — the editorial numbers moment. Oversized bold figures on the
 * light canvas, plus one black focal card (ref: Soviet-TV "3 кг" black card).
 * Honest, product-truth framing — no invented adoption metrics.
 */

import { Reveal, Stagger, StaggerItem, ArrowChip } from './home-kit';

const STATS = [
  { value: '24/7', label: 'Chippi works the inbox while you sleep.' },
  { value: '0', label: 'leads left to go cold in a forgotten thread.' },
  { value: '< 1 min', label: 'median first-touch on a new inquiry.' },
];

export function StatsBand() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <Stagger className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5">
        {STATS.map((s) => (
          <StaggerItem key={s.value}>
            <div className="flex h-full flex-col justify-between rounded-3xl bg-card p-8 ring-1 ring-border/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.10)]">
              <div className="text-[clamp(3rem,6vw,4.5rem)] font-bold leading-none tracking-tight text-foreground">
                {s.value}
              </div>
              <p className="mt-6 text-[15px] font-medium leading-snug text-foreground/55">
                {s.label}
              </p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal className="mt-5">
        <div className="relative overflow-hidden rounded-[2rem] bg-[#171310] p-8 md:p-14">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <p className="text-[15px] font-medium uppercase tracking-[0.18em] text-white/45">
                The whole job, one surface
              </p>
              <h2 className="mt-4 font-title text-[clamp(1.75rem,3.5vw,2.75rem)] font-normal leading-[1.05] tracking-[-0.018em] text-white">
                Stop paying for six tools that don&apos;t talk to each other.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-white/55">
                CRM, inbox, calendar, content studio, files, and the team
                dashboard. one agent runs all of it, and they finally agree.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <ArrowChip dir="up-right" className="ml-auto text-white/40" />
              <div className="text-[clamp(3.5rem,9vw,6rem)] font-bold leading-none tracking-tight text-brand">
                6 → 1
              </div>
              <p className="mt-2 text-[13px] font-medium text-white/45">
                tools, replaced by one workspace.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
