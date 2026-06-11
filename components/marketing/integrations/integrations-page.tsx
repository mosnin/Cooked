'use client';

/**
 * IntegrationsPage — the client body for /integrations.
 *
 * Tells one idea: connect your tools once, and Chippi works inside them.
 * Hero replicates the home-hero atmosphere (AsciiBlob + center-protect
 * radial); a three-step "how it works" explains the Composio connect-then-act
 * model; the catalog renders straight from `lib/integrations/catalog.ts`
 * (the source of truth — no invented entries or blurbs), grouped by category
 * with a monogram per app and a "soon" pill for coming-soon entries.
 *
 * Same family as the homepage: serif section headlines, light canvas,
 * hairline structure, Reveal/Stagger motion. Brand orange stays on the
 * AsciiBlob signature only.
 */

import Link from 'next/link';
import { Reveal, Stagger, StaggerItem, Eyebrow } from '@/components/marketing/home/home-kit';
import { AsciiBlob } from '@/components/marketing/home/ascii-blob';
import {
  INTEGRATIONS,
  type IntegrationApp,
  type IntegrationCategory,
} from '@/lib/integrations/catalog';

// Category display labels + the order they read on the page. We control the
// sequence here (catalog order is per-app within a category); this is the
// scan order a realtor would expect — comms first, then where work lands.
const CATEGORY_ORDER: { key: IntegrationCategory; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'social', label: 'Social' },
  { key: 'ads', label: 'Ads' },
  { key: 'payments', label: 'Payments' },
  { key: 'docs', label: 'Docs & sheets' },
  { key: 'storage', label: 'Storage' },
  { key: 'crm', label: 'CRM' },
  { key: 'real-estate', label: 'Real estate' },
  { key: 'docs-sign', label: 'Signing' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'forms', label: 'Forms' },
  { key: 'video', label: 'Video & meetings' },
];

function grouped(): { key: IntegrationCategory; label: string; apps: IntegrationApp[] }[] {
  return CATEGORY_ORDER.map(({ key, label }) => ({
    key,
    label,
    apps: INTEGRATIONS.filter((a) => a.category === key),
  })).filter((g) => g.apps.length > 0);
}

const TOTAL = INTEGRATIONS.length;

export function IntegrationsPage() {
  const groups = grouped();

  return (
    <div className="bg-muted text-foreground">
      <Hero />
      <HowItWorks />

      {/* The catalog — grouped, scannable. */}
      <section
        id="the-catalog"
        className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
      >
        <Reveal className="max-w-3xl">
          <Eyebrow>The catalog</Eyebrow>
          <h2 className="mt-5 font-title text-[clamp(2.25rem,5vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
            {TOTAL} apps Chippi can work inside.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Connected through Composio. Each one becomes a tool Chippi can call
            mid-task, reading what it needs, writing back where the work lives.
          </p>
        </Reveal>

        <div className="mt-16 space-y-16">
          {groups.map((group) => (
            <CategoryBlock key={group.key} label={group.label} apps={group.apps} />
          ))}
        </div>
      </section>

      <ClosingCTA />
    </div>
  );
}

/* ── Hero ──────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-background">
      <AsciiBlob />
      {/* Center-protect radial — keep the headline zone calm behind the field. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 38%, var(--background) 32%, transparent 78%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-muted"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-28 pb-20 text-center md:px-8 md:pt-40 md:pb-28">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-full bg-card/80 px-3.5 py-1.5 text-[12px] font-medium text-foreground/70 ring-1 ring-border/70 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand" />
            {TOTAL} integrations, one agent
          </span>
        </Reveal>

        <Reveal delay={0.06}>
          <h1 className="font-brand mx-auto mt-7 max-w-4xl text-[clamp(2.5rem,6.4vw,5rem)] leading-[1.02] tracking-tight text-foreground">
            Your whole stack, wired into one agent.
          </h1>
        </Reveal>

        <Reveal delay={0.12}>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-foreground/60 md:text-xl">
            Connect the tools you already pay for. Chippi connects through
            Composio, then calls each one as a tool while it works, pulling
            data out of your workflows and writing it back where it belongs.
          </p>
        </Reveal>

        <Reveal delay={0.18}>
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
        </Reveal>
      </div>
    </section>
  );
}

/* ── How it works ──────────────────────────────────────────────────────── */

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: '01',
    title: 'connect your tools',
    body: 'Pick the apps you already work in and authorize them once. Chippi connects through Composio over OAuth. no keys to copy, no scripts to wire.',
  },
  {
    n: '02',
    title: 'Chippi uses them as tools',
    body: 'Once connected, each app becomes a tool Chippi can call mid-task. Ask it to chase a lead or book a tour and it reaches for the right one on its own.',
  },
  {
    n: '03',
    title: 'data flows both ways',
    body: 'Chippi pulls what it needs out of your tools and writes results back in. Anything that posts or sends waits for your approval first.',
  },
];

function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="relative mx-auto max-w-7xl px-6 py-24 scroll-mt-28 md:px-8 md:py-32"
    >
      <Reveal className="max-w-3xl">
        <Eyebrow>How it works</Eyebrow>
        <h2 className="mt-5 font-title text-[clamp(2.25rem,5vw,4rem)] font-normal leading-[1.02] tracking-[-0.025em] text-foreground">
          Connect once. Chippi does the reaching.
        </h2>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          You don&apos;t move data between tabs anymore. You connect a tool, and
          from then on Chippi works inside it the way you would.
        </p>
      </Reveal>

      <Stagger className="mt-16 grid grid-cols-1 gap-px overflow-hidden rounded-3xl border border-border/60 bg-border/60 md:grid-cols-3">
        {STEPS.map((step) => (
          <StaggerItem key={step.n} className="flex flex-col bg-background px-8 py-10">
            <span className="font-title text-[2rem] leading-none tracking-[-0.02em] text-muted-foreground/50">
              {step.n}
            </span>
            <h3 className="mt-8 text-lg font-semibold text-foreground">{step.title}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

/* ── Catalog ───────────────────────────────────────────────────────────── */

function CategoryBlock({ label, apps }: { label: string; apps: IntegrationApp[] }) {
  return (
    <Reveal>
      <div className="flex items-baseline justify-between border-b border-border/60 pb-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </h3>
        <span className="text-[11px] tabular-nums text-muted-foreground/70">
          {apps.length}
        </span>
      </div>

      <Stagger
        amount={0.05}
        className="mt-6 grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {apps.map((app) => (
          <StaggerItem key={app.toolkit}>
            <IntegrationRow app={app} />
          </StaggerItem>
        ))}
      </Stagger>
    </Reveal>
  );
}

function IntegrationRow({ app }: { app: IntegrationApp }) {
  return (
    <div className="flex items-start gap-4">
      <Monogram name={app.name} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-[15px] font-semibold text-foreground">{app.name}</h4>
          {app.comingSoon && (
            <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              soon
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{app.blurb}</p>
      </div>
    </div>
  );
}

/**
 * Monogram — a paper-flat letter chip. We ship no logo image assets, so each
 * app reads as its first initial in a hairline-ringed square. Consistent,
 * neutral, no fabricated brand marks.
 */
function Monogram({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background text-[15px] font-semibold text-foreground/65">
      {initial}
    </div>
  );
}

/* ── Closing CTA ───────────────────────────────────────────────────────── */

function ClosingCTA() {
  return (
    <section
      id="get-connected"
      className="mx-auto max-w-7xl px-6 py-12 scroll-mt-28 md:px-8 md:py-24"
    >
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
              Connect your stack. Let Chippi work inside it.
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg text-white/55">
              Seven days free, cancel anytime. Bring the tools you already use.
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
                className="inline-flex h-12 items-center justify-center rounded-full bg-white/10 px-6 text-[15px] font-medium text-white ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15"
              >
                Book a demo
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
