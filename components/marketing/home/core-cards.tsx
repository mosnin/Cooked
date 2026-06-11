'use client';

/**
 * CoreCards — the five things Chippi does, as a Chippi-skinned MagicUI bento.
 * The top of each card is a calm media frame (MediaSlot) awaiting a real
 * product capture; the icon + title + description sit clean on the card below.
 * No fake line-art — the frame is honest about what's coming.
 */

import { Mail, PenLine, Target, CalendarCheck, KanbanSquare } from 'lucide-react';
import { BentoGrid, BentoCard } from '@/components/ui/bento-grid';
import { Reveal } from './home-kit';
import { MediaSlot } from './media-slot';

/** A media frame pinned to the top of a bento card; the text zone below stays
 *  on the clean card surface. Real screenshots drop straight in here. */
function CardMedia() {
  return (
    <div className="absolute inset-x-0 top-0 h-[46%]">
      <MediaSlot className="h-full w-full border-b border-border/60" />
    </div>
  );
}

export function CoreCards() {
  return (
    <section className="relative mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <Reveal className="max-w-3xl">
        <h2 className="font-title text-[clamp(2.25rem,4.8vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
          The work that used to eat your day,
          <span className="text-muted-foreground"> handled before you ask.</span>
        </h2>
      </Reveal>

      <BentoGrid className="mt-12">
        <BentoCard
          name="Reads your inbox, surfaces what matters"
          description="Gmail and Outlook plug in. Chippi reads every inbound, weighs it against your live deals, and quietly lifts the one to look at first."
          Icon={Mail}
          href="/realtors"
          cta="See the inbox"
          className="col-span-3 md:col-span-2"
          background={<CardMedia />}
        />

        <BentoCard
          name="Drafts in your voice"
          description="Every reply written before you open the thread. Read it, edit it, send it. or don't."
          Icon={PenLine}
          href="/realtors"
          cta="Meet Chippi"
          className="col-span-3 md:col-span-1"
          background={<CardMedia />}
        />

        <BentoCard
          name="Knows who to call first"
          description="Every lead scored against your deals, the hottest one rising out of the noise, so your morning starts with the right call."
          Icon={Target}
          href="/realtors"
          cta="See people"
          className="col-span-3 md:col-span-1"
          background={<CardMedia />}
        />

        <BentoCard
          name="Books the tour"
          description="Reply with a time; Chippi puts it on every calendar and writes it back to the deal."
          Icon={CalendarCheck}
          href="/realtors"
          cta="See the calendar"
          className="col-span-3 md:col-span-1"
          background={<CardMedia />}
        />

        <BentoCard
          name="Keeps the pipeline honest"
          description="Move a card; the value, the dates, the counterparty all stay in sync. The board reflects reality, not last week."
          Icon={KanbanSquare}
          href="/realtors"
          cta="See the pipeline"
          className="col-span-3 md:col-span-1"
          background={<CardMedia />}
        />
      </BentoGrid>
    </section>
  );
}
