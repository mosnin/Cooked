'use client';

/**
 * IntegrationsBeam — the payoff, rebuilt with MagicUI's AnimatedBeam.
 *
 * The realtor's whole world — inbox, calendar, and the surfaces they hand to
 * clients (intake link, tours page, public page) — beams into one agent at
 * the center. Brand-orange beams flow along each path; the hub wears the real
 * Chippi mark. On a clean Chippi canvas (not a foreign dark slab), so it sits
 * inside the brand instead of next to it.
 */

import { forwardRef, useRef } from 'react';
import { Mail, Inbox, CalendarDays, ClipboardList, Route, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedBeam } from '@/components/ui/animated-beam';
import { BrandLogo } from '@/components/brand-logo';
import { Reveal, Eyebrow } from './home-kit';

const Node = forwardRef<
  HTMLDivElement,
  { className?: string; icon: React.ElementType; label: string }
>(({ className, icon: Icon, label }, ref) => (
  <div
    ref={ref}
    className={cn(
      'z-10 flex items-center gap-2.5 rounded-full bg-card px-4 py-2.5 ring-1 ring-border/70',
      'shadow-[0_2px_10px_-4px_rgba(0,0,0,0.12)]',
      className,
    )}
  >
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70">
      <Icon size={17} strokeWidth={1.75} />
    </span>
    <span className="text-[14px] font-medium text-foreground">{label}</span>
  </div>
));
Node.displayName = 'Node';

export function IntegrationsBeam() {
  const containerRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const inboxRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const intakeRef = useRef<HTMLDivElement>(null);
  const toursRef = useRef<HTMLDivElement>(null);
  const publicRef = useRef<HTMLDivElement>(null);

  const BEAM = {
    duration: 4,
    pathColor: 'var(--border)',
    pathWidth: 2,
    pathOpacity: 0.4,
    gradientStartColor: '#ff964f',
    gradientStopColor: '#ffc56b',
  } as const;

  return (
    <section className="relative mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <Reveal className="mx-auto max-w-3xl text-center">
        <Eyebrow tone="brand">One agent, everything connected</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2.25rem,5vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
          Your whole world, wired into one agent.
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Your inbox and calendar feed Chippi. Your intake link, tours page, and
          public page route straight back to it. Every lead, every reply, every
          booking. one current, flowing through the center.
        </p>
      </Reveal>

      <div
        ref={containerRef}
        className="relative mx-auto mt-16 flex h-[420px] w-full max-w-4xl items-stretch justify-between px-2 md:px-10"
      >
        {/* left column — the systems Chippi reads */}
        <div className="flex flex-col justify-center gap-8">
          <Node ref={inboxRef} icon={Inbox} label="Inbox" />
          <Node ref={emailRef} icon={Mail} label="Email" />
          <Node ref={calendarRef} icon={CalendarDays} label="Calendar" />
        </div>

        {/* hub */}
        <div className="flex flex-col justify-center">
          <div
            ref={hubRef}
            className="relative z-10 flex h-24 w-24 items-center justify-center rounded-full bg-card ring-1 ring-border/70 shadow-[0_8px_40px_-8px_rgba(255,150,79,0.45)]"
          >
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-brand/5 ring-1 ring-brand/20"
            />
            <BrandLogo className="relative h-7" alt="Chippi" />
          </div>
        </div>

        {/* right column — the surfaces the realtor hands to clients */}
        <div className="flex flex-col justify-center gap-8">
          <Node ref={intakeRef} icon={ClipboardList} label="Intake link" />
          <Node ref={toursRef} icon={Route} label="Tours page" />
          <Node ref={publicRef} icon={Globe} label="Public page" />
        </div>

        {/* beams — left flows in, right flows in (reversed) */}
        <AnimatedBeam containerRef={containerRef} fromRef={inboxRef} toRef={hubRef} {...BEAM} delay={0.2} />
        <AnimatedBeam containerRef={containerRef} fromRef={emailRef} toRef={hubRef} {...BEAM} delay={0.45} />
        <AnimatedBeam containerRef={containerRef} fromRef={calendarRef} toRef={hubRef} {...BEAM} delay={0.7} />
        <AnimatedBeam containerRef={containerRef} fromRef={intakeRef} toRef={hubRef} {...BEAM} delay={0.4} reverse />
        <AnimatedBeam containerRef={containerRef} fromRef={toursRef} toRef={hubRef} {...BEAM} delay={0.9} reverse />
        <AnimatedBeam containerRef={containerRef} fromRef={publicRef} toRef={hubRef} {...BEAM} delay={1.3} reverse />
      </div>
    </section>
  );
}
