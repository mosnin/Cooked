'use client';

/**
 * BrokeragesContent — the body of `/brokerages`, composed entirely from the
 * rebuilt-homepage vocabulary (home-kit: Reveal / Stagger / Parallax / Eyebrow,
 * the AsciiBlob hero atmosphere, serif section headlines on a light canvas, and
 * the dark accent bands mirrored from stats-band / try-free-cta).
 *
 * The one idea: give every agent on your floor an extra teammate, and give
 * yourself the whole room on one surface — leads routed, deals tracked,
 * bottlenecks surfaced, everything in one place instead of six tools.
 *
 * Every capability shown is grounded in real code (no invented features):
 *   - empower the floor          → the realtor's own Chippi workspace (home)
 *   - lead routing / reassign    → lib/ai-tools/tools/assign-lead-to-realtor.ts
 *   - performance rollups        → lib/ai-tools/tools/summarize-realtor.ts
 *   - bottlenecks / stalled work → find-stuck-deals.ts, pipeline-summary.ts,
 *                                   find-overdue-followups.ts, find-quiet-hot-persons.ts
 *   - templates / compliance     → TemplateAdaptDiagram (shared template adapt)
 *   - team chat / @chippi        → TeamChatDiagram (per-deal channels, mention)
 *   - members / roles            → lib/permissions.ts (Owner/Admin/Member; canManageLeads)
 *   - deal review / sign-off     → lib/ai-tools/tools/request-deal-review.ts
 *
 * Brand-orange discipline: the AsciiBlob hero is the sanctioned orange moment;
 * the diagrams carry orange only on the Chippi authorship badge. Buttons, links,
 * and headlines stay foreground. CTAs match the home pills exactly.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import {
  Users,
  BarChart3,
  AlarmClockOff,
  ShieldCheck,
  TimerReset,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Reveal,
  Stagger,
  StaggerItem,
  Parallax,
  Eyebrow,
  ArrowChip,
} from '@/components/marketing/home/home-kit';
import { AsciiBlob } from '@/components/marketing/home/ascii-blob';
import {
  LeadRoutingDiagram,
  TeamLeaderboardDiagram,
  TemplateAdaptDiagram,
  TeamChatDiagram,
  TeamMembersDiagram,
} from '@/components/marketing/diagrams';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Locked home pills — kept byte-identical to home-hero so the page reads as
 *  one product. Primary → realtor signup; secondary → /demo (prominent here,
 *  because brokers want a walkthrough before they move a floor). */
function CtaRow({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 sm:flex-row',
        className,
      )}
    >
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
  );
}

/** One tick-tock feature section — copy on one side, a live product diagram on
 *  the other, alternating. Same rhythm as the home/realtors pages. */
function FeatureRow({
  eyebrow,
  title,
  sub,
  points,
  media,
  flip = false,
}: {
  eyebrow: string;
  title: ReactNode;
  sub: string;
  points: string[];
  media: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2 md:gap-16">
      <Reveal className={cn(flip && 'md:order-2')}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2rem,4.4vw,3.25rem)] font-normal leading-[1.04] tracking-[-0.025em] text-foreground">
          {title}
        </h2>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-foreground/55">
          {sub}
        </p>
        <ul className="mt-7 space-y-3">
          {points.map((p) => (
            <li
              key={p}
              className="flex items-start gap-3 text-[15px] text-foreground/70"
            >
              <span
                aria-hidden
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/25"
              />
              {p}
            </li>
          ))}
        </ul>
      </Reveal>

      <Reveal delay={0.1} className={cn(flip && 'md:order-1')}>
        <Parallax distance={36}>{media}</Parallax>
      </Reveal>
    </div>
  );
}

/* ── Sections ──────────────────────────────────────────────────────────── */

function Hero() {
  const reduce = useReducedMotion();

  const rise: Variants = reduce
    ? { hidden: { opacity: 0 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, y: 26, filter: 'blur(8px)' },
        show: { opacity: 1, y: 0, filter: 'blur(0px)' },
      };
  const container: Variants = {
    show: { transition: { staggerChildren: 0.12, delayChildren: 0.06 } },
  };

  return (
    <section className="relative overflow-hidden bg-background">
      <AsciiBlob />
      {/* center-protect radial — keeps the headline zone calm behind the field */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 32%, var(--background) 32%, transparent 78%)',
        }}
      />
      {/* settle into the page */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-muted"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-24 pb-14 md:px-8 md:pt-36 md:pb-24">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="mx-auto max-w-4xl text-center"
        >
          <motion.div variants={rise} transition={{ duration: 0.7, ease: EASE }}>
            <span className="inline-flex items-center gap-2 rounded-full bg-card/80 px-3.5 py-1.5 text-[12px] font-medium text-foreground/70 ring-1 ring-border/70 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              For brokerages and teams
            </span>
          </motion.div>

          <motion.h1
            variants={rise}
            transition={{ duration: 0.9, ease: EASE }}
            className="font-brand mt-7 text-[clamp(2.25rem,6vw,4.75rem)] leading-[1.05] tracking-tight text-foreground"
          >
            <span className="block">One agent for the</span>
            <span className="block">
              whole <em className="font-bold italic text-brand">floor.</em>
            </span>
          </motion.h1>

          <motion.p
            variants={rise}
            transition={{ duration: 0.9, ease: EASE }}
            className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-foreground/60 md:text-xl"
          >
            give every agent an extra teammate, and give yourself the whole room
            on one surface. Chippi routes the leads, tracks what the floor is
            closing, and surfaces where deals stall, so you can unblock them.
          </motion.p>

          <motion.div variants={rise} transition={{ duration: 0.9, ease: EASE }}>
            <CtaRow className="mt-9" />
          </motion.div>
        </motion.div>

        {/* the room, on one surface — the performance board, drifting on scroll */}
        <Parallax distance={48} className="relative mx-auto mt-16 max-w-5xl md:mt-24">
          <motion.div
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, y: 40, filter: 'blur(10px)' }
            }
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1, ease: EASE, delay: reduce ? 0 : 0.5 }}
          >
            <TeamLeaderboardDiagram aspect="video" />
          </motion.div>
        </Parallax>
      </div>
    </section>
  );
}

/** Empower your agents — the floor keeps their own workspace; the agent works
 *  inside it. Three calm cards in the paper-flat hairline-grid vocabulary. */
const EMPOWER = [
  {
    icon: Users,
    title: 'every agent, a teammate.',
    body: 'each realtor keeps their own Chippi workspace. it reads their inbox, drafts replies in their voice, and keeps every deal current. you add a team layer on top; you never take their workspace away.',
  },
  {
    icon: TimerReset,
    title: 'time, compressed.',
    body: 'first-touch, follow-ups, tour booking, deal updates. the repetitive work runs itself. the floor spends its hours on the conversations that close, not on the busywork around them.',
  },
  {
    icon: ShieldCheck,
    title: 'nothing leaves without a name on it.',
    body: 'Chippi drafts; the realtor approves. every send goes through the person whose name is on it. the agent does the work; the floor stays in the driver’s seat.',
  },
];

function Empower() {
  return (
    <section
      id="empower-the-floor"
      className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
    >
      <Reveal className="max-w-3xl">
        <Eyebrow>Empower the floor</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2rem,4.8vw,3.75rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
          give every agent an extra teammate.
        </h2>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-foreground/55">
          a brokerage doesn&apos;t fail on features. it fails when the realtors
          stop logging in. so Chippi makes the floor faster first, and gives you
          the room as a byproduct.
        </p>
      </Reveal>

      <Stagger className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/60 md:grid-cols-3">
        {EMPOWER.map((s) => {
          const Icon = s.icon;
          return (
            <StaggerItem key={s.title} className="bg-card">
              <div className="flex h-full flex-col gap-4 p-8">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-foreground/[0.05] text-foreground/70">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <h3 className="font-title text-[1.6rem] font-normal leading-[1.05] tracking-[-0.02em] text-foreground">
                  {s.title}
                </h3>
                <p className="text-[15px] leading-relaxed text-foreground/55">
                  {s.body}
                </p>
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}

/** Productivity & bottlenecks — the dark accent band, mirroring stats-band's
 *  black focal card. Grounded in the read-only aggregate tools the agent runs:
 *  find_stuck_deals, find_overdue_followups, find_quiet_hot_persons,
 *  pipeline_summary. No invented metrics — these are real verbs Chippi has. */
const SIGNALS = [
  { label: 'stalled', body: 'active deals nobody has touched in a week.' },
  { label: 'overdue', body: 'follow-ups the floor promised and missed.' },
  { label: 'going cold', body: 'hot leads with no recent contact.' },
];

function Bottlenecks() {
  return (
    <section
      id="bottlenecks"
      className="mx-auto max-w-7xl px-6 py-12 scroll-mt-28 md:px-8 md:py-16"
    >
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-[#171310] p-8 md:p-14">
          {/* warm wash bleeding up from the floor — the sanctioned dark-band feel */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(60% 80% at 50% 120%, rgba(255,150,79,0.22), transparent 70%)',
            }}
          />
          <div className="relative">
            <div className="max-w-2xl">
              <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-white/45">
                Productivity &amp; bottlenecks
              </p>
              <h2 className="mt-4 font-title text-[clamp(1.75rem,3.8vw,3rem)] font-normal leading-[1.05] tracking-[-0.018em] text-white">
                find where deals stall. then unblock them.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-white/55">
                ask Chippi how the floor is doing and it reads the real work,
                not a spreadsheet someone updated last week. stuck deals, missed
                follow-ups, hot leads gone quiet, the pipeline by stage. the
                bottleneck surfaces; you decide the move.
              </p>
            </div>

            <Stagger className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-white/[0.08] sm:grid-cols-3">
              {SIGNALS.map((s) => (
                <StaggerItem key={s.label} className="bg-[#171310]">
                  <div className="flex h-full flex-col gap-2 p-6">
                    <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-white/40">
                      {s.label}
                    </p>
                    <p className="text-[15px] leading-snug text-white/75">
                      {s.body}
                    </p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>

            <p className="mt-6 flex items-center gap-2 text-[13px] text-white/45">
              <AlarmClockOff size={14} className="shrink-0" />
              flag any deal for your sign-off. Chippi opens the review, you make
              the call.
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/** "One place, not six tools." — the consolidation payoff, mirroring the
 *  stats-band black card with the 6 → 1 figure. */
function OnePlace() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12 md:px-8 md:py-16">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-[#171310] p-8 md:p-14">
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-white/45">
                One place, not six tools
              </p>
              <h2 className="mt-4 font-title text-[clamp(1.75rem,3.5vw,2.75rem)] font-normal leading-[1.05] tracking-[-0.018em] text-white">
                all the data, one surface.
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-white/55">
                CRM, inbox, calendar, templates, files, team chat, and the floor
                dashboard. stop bouncing between softwares that don&apos;t talk
                to each other. one agent runs all of it, and they finally agree.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <ArrowChip dir="up-right" className="ml-auto text-white/40" />
              <div className="text-[clamp(3.5rem,9vw,6rem)] font-bold leading-none tracking-tight text-brand">
                6 &rarr; 1
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

/** Closing CTA — single dark panel, one bold line, the two pills. Mirrors
 *  try-free-cta but keeps the brokerage-flavored second option (Book a demo). */
function ClosingCta() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-12 md:px-8 md:py-16">
      <Reveal>
        <div className="relative overflow-hidden rounded-[2rem] bg-[#171310] px-8 py-16 text-center md:px-16 md:py-24">
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
              bring your floor to Chippi.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-white/55">
              the realtors keep what they already do. the brokerage sees what it
              never could. we&apos;ll help you move.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/login/realtor?intent=signup"
                className="inline-flex h-12 items-center justify-center rounded-full bg-brand px-8 text-[15px] font-semibold text-[#2a1402] transition-transform duration-150 active:scale-[0.98]"
              >
                Start free trial
              </Link>
              <Link
                href="/demo"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white/10 px-6 text-[15px] font-medium text-white ring-1 ring-white/20 backdrop-blur transition-colors hover:bg-white/15"
              >
                Book a demo <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export function BrokeragesContent() {
  return (
    <>
      <Hero />

      <Empower />

      {/* Lead distribution — auto-assign and hand-pick to the right realtor. */}
      <section
        id="lead-distribution"
        className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <FeatureRow
          eyebrow="Lead distribution"
          title={<>every lead, the right realtor.</>}
          sub="auto-assign by territory and load, or hand-pick the realtor and write the brief. Chippi can reassign a lead to anyone on the floor with a reason logged to the activity trail."
          points={[
            'auto-assignment, weighted by who has room.',
            'hand-pick and reassign, always your override.',
            'every assignment logged, with the reason, per realtor.',
          ]}
          media={<LeadRoutingDiagram aspect="wide" />}
        />
      </section>

      {/* Performance — track what the floor is closing. */}
      <section
        id="performance"
        className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <FeatureRow
          flip
          eyebrow="Performance"
          title={<>see what the floor is closing.</>}
          sub="ask Chippi to roll up any realtor's last week: deals active, won, and lost; new and hot leads; drafts pending and their approval rate. the numbers come from the work, not a status meeting."
          points={[
            'per-realtor rollups across deals, leads, and drafts.',
            'response time and pipeline value, live.',
            'sortable leaderboard the floor can see.',
          ]}
          media={<TeamLeaderboardDiagram aspect="square" />}
        />
        <Reveal className="mt-12 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[13px] text-foreground/55">
            <BarChart3 size={15} className="text-foreground/40" />
            grounded in the realtor&apos;s real activity, every figure.
          </span>
        </Reveal>
      </section>

      <Bottlenecks />

      {/* Templates & compliance — write the reply once, stay on-brand. */}
      <section className="relative mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
        <FeatureRow
          eyebrow="Templates & compliance"
          title={<>write the reply once.</>}
          sub="approved templates the whole floor reaches for. Chippi adapts each one to the lead and the realtor's voice, so a template never lands as a stamp, and the high-risk replies stay on-brand."
          points={[
            'a brokerage-wide library, written once.',
            'per-lead, per-voice adaptation on every send.',
            'consistent brand on the replies that matter.',
          ]}
          media={<TemplateAdaptDiagram aspect="square" />}
        />
      </section>

      {/* Team chat — talk shop on the same page, @chippi in channel. */}
      <section
        id="team-chat"
        className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <FeatureRow
          flip
          eyebrow="Team chat"
          title={<>talk shop, on the same page.</>}
          sub="channels that live with the deal, not next to it. @chippi in a channel and it answers in line: where the deal stands, a drafted reply, a number pulled from the record. no tab-switching."
          points={[
            'per-deal channels, archived on close.',
            'mention @chippi to pull it into the thread.',
            'general channels for the floor; Chippi stays out unless invited.',
          ]}
          media={<TeamChatDiagram aspect="wide" />}
        />
      </section>

      {/* Members & roles — who belongs, what they can see. */}
      <section className="relative mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
        <FeatureRow
          eyebrow="Members & roles"
          title={<>who belongs, and what they see.</>}
          sub="three roles, no permissions matrix. Owner runs the show, Admin manages the floor, Member is the realtor doing the work. admins see the rollup; private drafts and notes stay private."
          points={[
            'Owner, Admin, Member. three tiers, no more.',
            'invite by link with the role pre-set.',
            'aggregate metrics are team-visible; private surfaces stay private.',
          ]}
          media={<TeamMembersDiagram aspect="square" />}
        />
      </section>

      <OnePlace />

      <ClosingCta />
    </>
  );
}
