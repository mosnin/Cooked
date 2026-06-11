'use client';

/**
 * The two closing payoff sections for /realtors, kept together because they
 * answer the same buyer objection from two angles: "why move?" and "will it
 * fit how I work?"
 *
 *   1. OnePlace — the data-consolidation payoff. The realtor stops bouncing
 *      between six tabs; inbox, people, pipeline, calendar, properties, files,
 *      and studio are one workspace, and Chippi keeps them in sync. Rendered
 *      as the hairline-divider grid from the home vocabulary so it reads as
 *      "one surface, many rooms" rather than a feature checklist.
 *
 *   2. TailorIt — repetitive work handled, fit to the realtor's existing
 *      workflow. Grounded in real Chippi tools: drafting in your voice,
 *      follow-ups it sets, tours it books, the pipeline it keeps current —
 *      approval-first, with per-tool autonomy you grant when you trust it.
 *
 * Both compose the home kit (Reveal / Stagger / StaggerItem / Eyebrow) so the
 * entrance beats match every other section on the page.
 */

import {
  Mail,
  Users,
  KanbanSquare,
  CalendarCheck,
  Building2,
  FolderOpen,
  Aperture,
  PenLine,
  Bell,
  ShieldCheck,
} from 'lucide-react';
import { Reveal, Eyebrow, Stagger, StaggerItem } from '@/components/marketing/home/home-kit';

/** The rooms that used to be separate tabs — now one workspace. */
const ROOMS = [
  { icon: Mail, label: 'inbox', note: 'Gmail and Outlook, read and replied in here.' },
  { icon: Users, label: 'people', note: 'every contact, every touch, on one timeline.' },
  { icon: KanbanSquare, label: 'pipeline', note: 'the board that reflects reality, not last week.' },
  { icon: CalendarCheck, label: 'calendar', note: 'tours and follow-ups in the week you already keep.' },
  { icon: Building2, label: 'properties', note: 'listings as records: offers, specs, who saw what.' },
  { icon: FolderOpen, label: 'files', note: 'contracts and signed PDFs, filed per deal.' },
];

export function OnePlace() {
  return (
    <section className="relative mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <Reveal className="max-w-3xl">
        <Eyebrow>One place</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2.25rem,4.8vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
          one workspace,
          <span className="text-muted-foreground"> not six tabs.</span>
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-foreground/55">
          your inbox, your people, your pipeline, your calendar, your listings,
          your files. they stop living in separate apps. it&rsquo;s one workspace, and
          Chippi keeps every corner of it current.
        </p>
      </Reveal>

      <Stagger className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/60 sm:grid-cols-2 lg:grid-cols-3">
        {ROOMS.map((r) => {
          const Icon = r.icon;
          return (
            <StaggerItem key={r.label} className="bg-card">
              <div className="flex h-full flex-col gap-3 p-7">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/70">
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <h3 className="font-title text-[1.4rem] font-normal leading-[1.05] tracking-[-0.02em] text-foreground">
                  {r.label}.
                </h3>
                <p className="text-[14px] leading-relaxed text-foreground/55">
                  {r.note}
                </p>
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}

/** Repetitive work handled, fit to how the realtor already works. */
const TAILORED = [
  {
    icon: PenLine,
    title: 'drafts in your voice.',
    body: 'Chippi learns how you actually write and composes the reply you would have typed, then stops for your read.',
  },
  {
    icon: Bell,
    title: 'follow-ups it remembers.',
    body: 'the callback you would have forgotten gets set when the deal asks for it, and surfaced when it comes due.',
  },
  {
    icon: Aperture,
    title: 'content from the record.',
    body: 'listing copy, the email blast, the social post, all generated from the property record and scheduled to your channels.',
  },
  {
    icon: ShieldCheck,
    title: 'autonomy you grant.',
    body: 'approval-first on every send by default. trust a task, and hand Chippi that one, per tool, on your terms.',
  },
];

export function TailorIt() {
  return (
    <section className="relative mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <Reveal className="max-w-3xl">
        <Eyebrow>Your workflow</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2.25rem,4.8vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
          tailored to how
          <span className="text-muted-foreground"> you already work.</span>
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-foreground/55">
          the repetitive work, the reply, the follow-up, the post, the
          bookkeeping, runs in the background so the hours go to the deal. you
          decide how much Chippi handles, and you can change your mind anytime.
        </p>
      </Reveal>

      <Stagger className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/60 md:grid-cols-2">
        {TAILORED.map((t) => {
          const Icon = t.icon;
          return (
            <StaggerItem key={t.title} className="bg-card">
              <div className="flex h-full flex-col gap-4 p-8">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/70">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <h3 className="font-title text-[1.6rem] font-normal leading-[1.05] tracking-[-0.02em] text-foreground">
                  {t.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-foreground/55">
                  {t.body}
                </p>
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}
