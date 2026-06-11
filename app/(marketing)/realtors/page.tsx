/**
 * `/realtors` — Chippi for the solo realtor who's boots-on-the-ground.
 *
 * The story: a realtor flying solo spends the day in the field — at the
 * showing, in the car, between doors. Chippi is the extra teammate who works
 * alongside them, reachable on the phone, the installed web app, or the office
 * desktop. It reads the inbox, drafts in their voice, books the tour, scores
 * the lead, and keeps every deal current — saving time on the repetitive work
 * so the hours go to closing. Everything lands in one workspace instead of six
 * tabs, and the realtor stays in the driver's seat on every send.
 *
 * This page absorbs the content of the now-retired /features/* pages, told in
 * the homepage's rebuilt vocabulary: AsciiBlob hero atmosphere, serif headlines,
 * Reveal/Stagger motion, live product diagrams, and the home kit throughout.
 *
 * Auth-aware like the homepage: signed-in realtors bounce to their workspace.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

import { Reveal, Eyebrow } from '@/components/marketing/home/home-kit';
import { RealtorsHero } from '@/components/marketing/realtors/realtors-hero';
import { FieldSurfaces } from '@/components/marketing/realtors/field-surfaces';
import { FeatureRow } from '@/components/marketing/realtors/feature-row';
import {
  OnePlace,
  TailorIt,
} from '@/components/marketing/realtors/consolidation-tailor';
import { ClosingCTA } from '@/components/marketing/realtors/closing-cta';
import {
  ComposerDraftDiagram,
  LeadScoreDiagram,
  CalendarBookingDiagram,
  KanbanDragDiagram,
  InboxDiagram,
  TimelineDiagram,
} from '@/components/marketing/diagrams';

export const metadata = {
  title: 'For solo realtors · Chippi',
  description:
    'Chippi is the extra teammate in the field, reachable on your phone, the web app, or the office desktop. It drafts in your voice, scores the lead, books the tour, and keeps every deal current.',
};

export default async function RealtorsPage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/auth/redirect?intent=realtor');
  }

  return (
    <div className="bg-muted text-foreground">
      {/* Hero — extra teammate in the field. */}
      <RealtorsHero />

      {/* In the field — phone / web app / office. */}
      <section
        id="in-the-field"
        className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <Reveal className="max-w-3xl">
          <Eyebrow>In the field</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2.25rem,4.8vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            reachable wherever
            <span className="text-muted-foreground"> the work is.</span>
          </h2>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-foreground/55">
            you&rsquo;re rarely at a desk. Chippi is a tap away on whatever screen is
            already in your hand, and the same workspace opens wide when you&rsquo;re
            back at the office.
          </p>
        </Reveal>
        <FieldSurfaces />
      </section>

      {/* The feature sequence — tick-tock, grounded in real capabilities. */}
      <div className="relative mx-auto max-w-7xl space-y-24 px-6 py-12 md:space-y-32 md:px-8 md:py-16">
        <div id="the-reply" className="scroll-mt-28">
        <FeatureRow
          eyebrow="The reply"
          title={
            <>
              drafts you&rsquo;d have written.
              <span className="text-muted-foreground"> in your voice.</span>
            </>
          }
          sub="Chippi reads the thread, writes the reply the way you actually write, and stops. you read it, you press send. or you don't."
          points={[
            'trained on how you actually write.',
            'never sends without your tap.',
            'ready in your inbox before you open the thread.',
          ]}
          media={<ComposerDraftDiagram aspect="video" />}
        />
        </div>

        <div id="first-call" className="scroll-mt-28">
        <FeatureRow
          flip
          eyebrow="First call"
          title={
            <>
              know who to call
              <span className="text-muted-foreground"> first.</span>
            </>
          }
          sub="every new inquiry comes in scored against your active deals. hot, warm, cold, at a glance, with the reason attached in plain language."
          points={[
            'multi-signal scoring on each lead.',
            'the quiet hot ones surfaced before they go cold.',
            'priority order updates as deals move.',
          ]}
          media={<LeadScoreDiagram aspect="square" />}
        />
        </div>

        <FeatureRow
          eyebrow="Tours"
          title={
            <>
              book the tour
              <span className="text-muted-foreground"> from the thread.</span>
            </>
          }
          sub="reply with a time. Chippi checks your availability, puts it on the calendar, sends the confirmation, and writes it back to the deal. no tab-switching."
          points={[
            'proposes times against your open hours.',
            'two-way Google and Outlook sync.',
            'confirmation goes back in the thread.',
          ]}
          media={<CalendarBookingDiagram aspect="wide" />}
        />

        <FeatureRow
          flip
          eyebrow="The pipeline"
          title={
            <>
              a pipeline that
              <span className="text-muted-foreground"> doesn&rsquo;t lie.</span>
            </>
          }
          sub="drag a card to the next stage; Chippi keeps the value, the dates, and the counterparty in sync. the board reflects reality, not yesterday."
          points={[
            'auto-updating fields as cards move.',
            'won and lost reasons logged in plain language.',
            'every change written to the deal timeline.',
          ]}
          media={<KanbanDragDiagram aspect="video" />}
        />

        <FeatureRow
          eyebrow="The inbox"
          title={
            <>
              your inbox,
              <span className="text-muted-foreground"> read and triaged.</span>
            </>
          }
          sub="Gmail and Outlook plug in. Chippi reads every inbound, weighs it against your live deals, and quietly lifts the one to look at first. it stays quiet when nothing's worth surfacing."
          points={[
            'threads, not loose messages.',
            'scored against your active deals.',
            'reply, draft, and send from the address your contacts know.',
          ]}
          media={<InboxDiagram aspect="square" />}
        />

        <FeatureRow
          flip
          eyebrow="The relationship"
          title={
            <>
              every touch,
              <span className="text-muted-foreground"> in order.</span>
            </>
          }
          sub="emails, tours, notes, drafts, replies, assembled chronologically per contact. you scroll the relationship; you don't reconstruct it from memory."
          points={[
            'tours and meetings logged as they happen.',
            'Chippi-authored actions tagged on the timeline.',
            'ask Chippi to recall the history and it does.',
          ]}
          media={<TimelineDiagram aspect="wide" />}
        />
      </div>

      {/* One workspace, not six tabs — the consolidation payoff. */}
      <div id="one-workspace" className="scroll-mt-28">
        <OnePlace />
      </div>

      {/* Tailored to how you already work — repetitive work handled. */}
      <TailorIt />

      {/* The one promise — you stay in the driver's seat. */}
      <section
        id="stay-in-control"
        className="relative mx-auto max-w-4xl px-6 py-24 text-center scroll-mt-28 md:px-8 md:py-32"
      >
        <Reveal>
          <Eyebrow>One promise</Eyebrow>
          <h2 className="mx-auto mt-5 max-w-3xl font-title text-[clamp(2.25rem,4.8vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            you stay in the driver&rsquo;s seat.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-foreground/55">
            Chippi does the work; you make the call. approval-first by default,
            and nothing leaves without your name on it.
          </p>
        </Reveal>
      </section>

      {/* Closing CTA. */}
      <ClosingCTA />
    </div>
  );
}
