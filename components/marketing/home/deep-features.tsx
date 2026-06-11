'use client';

/**
 * DeepFeatures — "the rest of the workspace", rebuilt to the two-column
 * accordion + visual layout (ref: Wrangle "Outbound Recruiting OS"). Left: a
 * label, headline, sub, CTA, and an accordion of the deeper surfaces — one
 * open at a time, its description easing in. Right: a single composed
 * abstraction (the agent at the center of every surface), sticky on desktop.
 */

import { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Aperture, FolderOpen, Users, ShieldCheck } from 'lucide-react';
import { Reveal, Eyebrow } from './home-kit';
import { MediaSlot } from './media-slot';

const EASE = [0.22, 1, 0.36, 1] as const;

const FEATURES = [
  {
    icon: Aperture,
    title: 'Studio writes the post.',
    body: 'Listing copy, the email blast, the social post, all generated from the property record and scheduled to your channels.',
  },
  {
    icon: FolderOpen,
    title: 'Files that belong to the deal.',
    body: 'Contracts, photos, signed PDFs, filed per deal, searchable, versioned. Chippi files them for you.',
  },
  {
    icon: Users,
    title: 'A team layer brokers actually open.',
    body: 'Route leads, share templates, see what the floor is closing, while every realtor keeps their own workspace.',
  },
  {
    icon: ShieldCheck,
    title: 'Approval-first, always.',
    body: 'Chippi never sends, books, or changes a record without your tap. Grant per-task autonomy when you trust it.',
  },
];

export function DeepFeatures() {
  const [open, setOpen] = useState(0);

  return (
    <section className="mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16 md:items-center">
        {/* Left — label, headline, CTA, accordion */}
        <Reveal>
          <Eyebrow>Features</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2rem,4.8vw,3.75rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            One agent. Every corner of the job.
          </h2>
          <p className="mt-4 max-w-md text-lg leading-relaxed text-foreground/55">
            The inbox is where it starts. Chippi reaches everywhere the work
            lives, so you never leave to get something done.
          </p>
          <Link
            href="/login/realtor?intent=signup"
            className="mt-7 inline-flex h-11 items-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-medium text-background transition-transform duration-150 active:scale-[0.98]"
          >
            Get started <ArrowRight size={16} />
          </Link>

          <div className="mt-10 border-t border-border/60">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              const isOpen = open === i;
              return (
                <div key={f.title} className="border-b border-border/60">
                  <button
                    type="button"
                    onClick={() => setOpen(i)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3 py-4 text-left"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ${
                        isOpen ? 'bg-brand/10 text-brand' : 'bg-foreground/[0.05] text-foreground/60'
                      }`}
                    >
                      <Icon size={17} strokeWidth={1.75} />
                    </span>
                    <span
                      className={`text-[17px] font-semibold tracking-tight transition-colors duration-200 ${
                        isOpen ? 'text-foreground' : 'text-foreground/55'
                      }`}
                    >
                      {f.title}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.32, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <p className="pb-5 pl-12 pr-4 text-[15px] leading-relaxed text-foreground/55">
                          {f.body}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </Reveal>

        {/* Right — the agent at the center of every surface */}
        <Reveal delay={0.1}>
          <div className="overflow-hidden rounded-[1.75rem] ring-1 ring-border/70">
            <MediaSlot className="aspect-[4/3] w-full" iconSize={34} />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
