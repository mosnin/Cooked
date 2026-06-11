/**
 * `/company` — Chippi's founding story. Replaces the old `/about`.
 *
 * One idea: the world moved to AI; real estate didn't — so two people who'd
 * lived the gap built Chippi to close it. The page leads with the mission,
 * makes the problem feel inevitable, lets the founders stand as proof it's
 * built by people who know the work, folds the brand beliefs in as conviction,
 * and closes calmly.
 *
 * Matches the rebuilt homepage aesthetic: AsciiBlob hero atmosphere with a
 * center-protect radial, serif section headlines on the home clamp, the home
 * kit's Reveal / Stagger / Eyebrow motion, light canvas. Brand orange stays a
 * signature (the blob, the serif "Chippi") — never on a button or link.
 *
 * Auth users bounce to their workspace, mirroring the homepage.
 */

import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AsciiBlob } from '@/components/marketing/home/ascii-blob';
import { Reveal, Eyebrow } from '@/components/marketing/home/home-kit';
import { Founders } from '@/components/marketing/company/founders';

export const metadata = { title: 'Company · Chippi' };

export default async function CompanyPage() {
  const { userId } = await auth();
  if (userId) {
    redirect('/auth/redirect?intent=realtor');
  }

  return (
    <div className="bg-muted text-foreground">
      {/* 1. Hero — the mission in one line, over the orange ASCII field. */}
      <section className="relative overflow-hidden bg-background">
        <AsciiBlob />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 50% 36%, var(--background) 32%, transparent 78%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-muted"
        />

        <div className="relative z-10 mx-auto max-w-7xl px-6 pt-28 pb-20 text-center md:px-8 md:pt-40 md:pb-28">
          <Reveal>
            <Eyebrow>Our story</Eyebrow>
          </Reveal>
          <Reveal delay={0.06}>
            <h1 className="font-brand mx-auto mt-7 max-w-4xl text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.05] tracking-tight text-foreground">
              Real estate deserves to work the way the rest of the world already does.
            </h1>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-foreground/60 md:text-xl">
              We built Chippi because the tools agents and brokerages live in
              were drawn for a slower era. The work shouldn’t be the chrome.
              The work should be the deals.
            </p>
          </Reveal>
        </div>
      </section>

      {/* 2. The problem they saw — one reading column. */}
      <section
        id="the-gap"
        className="relative mx-auto max-w-3xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <Reveal>
          <Eyebrow>The gap</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2rem,4.8vw,3.75rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            The work moved on. The software didn’t.
          </h2>
          <div className="mt-6 space-y-5 text-lg leading-relaxed text-foreground/55">
            <p>
              An agent’s day is mostly attention management. Email, calendar,
              replies, follow-ups, pipeline updates. The actual selling,
              the listening and judging and knowing, happens in maybe ten
              percent of it.
            </p>
            <p>
              Everywhere else, that other ninety percent has started to run
              itself. In real estate it still doesn’t. The tools are stuck a
              generation behind what’s now possible. Agents and brokerages are
              nowhere near the productivity the moment allows. That distance,
              between what could happen and what actually does, is the whole
              reason Chippi exists.
            </p>
          </div>
        </Reveal>
      </section>

      {/* 3. The founders — two people who lived the gap. */}
      <section
        id="the-founders"
        className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <Reveal className="mx-auto max-w-3xl text-center">
          <Eyebrow>The founders</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2rem,4.8vw,3.75rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            Built by people who know the work.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-foreground/55">
            Orlando and Preston teamed up to solve the problem from both ends:
            the agent’s day and the brokerage’s floor.
          </p>
        </Reveal>
        <div className="mt-16">
          <Founders />
        </div>
      </section>

      {/* 4. What Chippi believes — the conviction, carried from /about. */}
      <section
        id="what-we-believe"
        className="relative mx-auto max-w-3xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <Reveal>
          <Eyebrow>What we believe</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2rem,4.8vw,3.75rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            A few things we won’t move on.
          </h2>
        </Reveal>

        <div className="mt-12 divide-y divide-border/60 border-t border-border/60">
          {BELIEFS.map((b, i) => (
            <Reveal key={b.title} delay={i * 0.04}>
              <div className="py-8">
                <h3 className="text-[19px] font-semibold tracking-tight text-foreground">
                  {b.title}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-foreground/55">
                  {b.body}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* 5. Closing — calm, single ask plus a softer second door. */}
      <section className="relative mx-auto max-w-7xl px-6 pb-28 pt-4 md:px-8">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="font-title text-[clamp(2rem,4.8vw,3.5rem)] font-normal leading-[1.04] tracking-[-0.02em] text-foreground">
              Come see what your day looks like with Chippi.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-foreground/55">
              Seven days free, cancel anytime. Bring your inbox and let Chippi
              do the rest.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login/realtor?intent=signup"
                className="inline-flex h-12 items-center justify-center rounded-full bg-brand px-7 text-[15px] font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
              >
                Start free trial
              </Link>
              <Link
                href="/demo"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-card/80 px-6 text-[15px] font-medium text-foreground ring-1 ring-border/70 backdrop-blur transition-colors hover:bg-card"
              >
                Book a demo
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

const BELIEFS = [
  {
    title: 'Configuration is failure to decide.',
    body: 'Settings, toggles, customization layers. They’re admissions the team couldn’t pick. Picking is the work. We won’t make your day harder so our spec was easier.',
  },
  {
    title: 'Nothing leaves without your name on it.',
    body: 'Chippi drafts, books, and updates, but by default every move is yours to approve. You can grant per-task autonomy when you trust it. The default is you in the loop, and that’s where the trust lives.',
  },
  {
    title: 'Chippi has one voice.',
    body: 'Wherever Chippi shows up, on a draft card, a toast, an activity row, the same signature carries through. Nothing else does. It’s how you learn to trust the agent across every surface.',
  },
  {
    title: 'No numbers we can’t defend.',
    body: 'No 10× headline. No minutes-saved-per-day claim. The day we can prove a number against your own data, we’ll quote it, and footnote it. Until then, the agent does the talking.',
  },
];
