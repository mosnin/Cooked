'use client';

/**
 * TestimonialMarquee — a slow-scrolling wall of voices. Two rows drifting in
 * opposite directions for depth (ref: testimonial walls). Placeholder copy
 * until real quotes land; avatars are placeholders. Reduced-motion freezes.
 */

import { motion, useReducedMotion } from 'motion/react';
import { Reveal, Eyebrow } from './home-kit';
import { MonogramAvatar } from './visuals/editorial-visuals';
import { cn } from '@/lib/utils';

const QUOTES = [
  { name: 'Realtor name', role: 'Agent · City', body: 'Chippi drafts the reply I was about to type, then waits for my tap. It feels like having an assistant who already knows my book.' },
  { name: 'Realtor name', role: 'Agent · City', body: 'I stopped losing leads in my inbox. Every morning the day is already triaged for me.' },
  { name: 'Broker name', role: 'Broker · Team of 12', body: 'For the first time I can see what the whole floor is closing without nagging anyone for updates.' },
  { name: 'Realtor name', role: 'Agent · City', body: 'Booked three tours from my phone between showings. Chippi handled the calendar and the confirmations.' },
  { name: 'Realtor name', role: 'Agent · City', body: 'The pipeline is finally honest. I move a card and everything else just updates.' },
  { name: 'Broker name', role: 'Broker · Team of 30', body: 'Onboarding a new agent used to take a week. Now they walk in and the workspace is already running.' },
];

function Row({ items, reverse }: { items: typeof QUOTES; reverse?: boolean }) {
  const reduce = useReducedMotion();
  const track = [...items, ...items];
  return (
    <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <motion.div
        className="flex w-max gap-4"
        animate={reduce ? undefined : { x: reverse ? ['-50%', '0%'] : ['0%', '-50%'] }}
        transition={{ duration: 50, ease: 'linear', repeat: Infinity }}
      >
        {track.map((q, i) => (
          <figure
            key={i}
            className={cn(
              'flex w-[340px] shrink-0 flex-col justify-between rounded-3xl bg-card p-6 ring-1 ring-border/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.10)]',
            )}
          >
            <blockquote className="text-[15px] leading-relaxed text-foreground/80">
              “{q.body}”
            </blockquote>
            <figcaption className="mt-5 flex items-center gap-3">
              <MonogramAvatar seed={`${q.name}-${q.role}`} className="h-9 w-9" />
              <span className="leading-tight">
                <span className="block text-[13px] font-semibold text-foreground">{q.name}</span>
                <span className="block text-[12px] text-foreground/45">{q.role}</span>
              </span>
            </figcaption>
          </figure>
        ))}
      </motion.div>
    </div>
  );
}

export function TestimonialMarquee() {
  return (
    <section className="py-24 md:py-32">
      <Reveal className="mx-auto mb-12 max-w-3xl px-6 text-center md:px-8">
        <Eyebrow>From the field</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2rem,4.5vw,3.5rem)] font-normal leading-[1.04] tracking-[-0.018em] text-foreground">
          Loved by the people who carry the deals.
        </h2>
      </Reveal>

      <div className="flex flex-col gap-4">
        <Row items={QUOTES} />
        <Row items={[...QUOTES].reverse()} reverse />
      </div>
    </section>
  );
}
