/**
 * `/pricing` — Chippi V2 three-layer pricing.
 *
 * Layer 1: platform tiers for individuals (Free / Solo / Pro Performer) and
 * teams (Team / Team Plus). Layer 2: brokerage expansion (auto-expanding
 * per-agent pricing). Premium AI workflows draw from a monthly credit balance.
 *
 * Numbers come from `lib/plans` so the marketing page can't drift from the
 * product's source of truth. Marketing visual system (studio): serif Times for
 * prices, orange accents allowed.
 */

import Link from 'next/link';
import { MarketingHero } from '@/components/marketing/marketing-hero';
import { MarketingCTA } from '@/components/marketing/marketing-cta';
import { TITLE_FONT, PRIMARY_PILL } from '@/lib/typography';
import { PLANS, WORKFLOW_CREDIT_COST, TOPUPS } from '@/lib/plans';

export const metadata = { title: 'Pricing · Chippi' };

const SIGNUP = '/login/realtor?intent=signup';

type Card = {
  id: keyof typeof PLANS;
  blurb: string;
  cta: { label: string; href: string };
  featured?: boolean;
};

// Every offered plan is paid — there is no free tier on this page. Self-serve
// plans start with a 7-day Stripe trial (card collected at checkout, charged
// when the trial ends). PLANS.free remains an internal fallback state only.
const INDIVIDUAL: Card[] = [
  { id: 'solo', blurb: 'Organize your pipeline and start using AI workflows.', cta: { label: 'Start Solo', href: SIGNUP } },
  { id: 'pro', blurb: 'Full daily AI workflow for serious lead volume.', cta: { label: 'Start Pro', href: SIGNUP }, featured: true },
];

const TEAM: Card[] = [
  { id: 'team', blurb: 'Shared command center for scoring, routing, accountability.', cta: { label: 'Start a team', href: '/demo' } },
  { id: 'team_plus', blurb: 'Brokerage-level workflow without enterprise complexity.', cta: { label: 'Talk to sales', href: '/demo' } },
];

const EXPANSION: { range: string; mo: number; yr: number }[] = [
  { range: '10–24 agents', mo: 69, yr: 56 },
  { range: '25–49 agents', mo: 59, yr: 48 },
  { range: '50–99 agents', mo: 49, yr: 40 },
  { range: '100–199 agents', mo: 39, yr: 32 },
];

// Premium workflows shown on the pricing table. `chat_turn` is intentionally
// omitted — the per-turn chat meter is an internal cost ceiling, not one of the
// advertised "premium workflows" (the copy positions routine chat as ~free).
const WORKFLOW_LABELS: Partial<Record<keyof typeof WORKFLOW_CREDIT_COST, string>> = {
  pipeline_audit: 'Full pipeline audit',
  followup_sequence: 'Follow-up sequence',
  lead_qualification: 'Lead qualification run',
  tour_booking: 'Tour booking workflow',
  daily_briefing: 'Daily AI briefing',
  call_prep: 'Call prep',
  lead_score: 'Lead score update',
};

const FAQ: { q: string; a: string }[] = [
  {
    q: 'What are credits?',
    a: 'High-value agentic actions draw from a monthly credit balance — a full pipeline audit, a follow-up sequence, a lead qualification run. Routine actions cost little or nothing. Unused credits roll over for 30 days.',
  },
  {
    q: 'What happens when I run out of credits?',
    a: 'Buy a one-time top-up anytime, or upgrade your plan for a larger monthly allocation and a better rate. Your workspace never locks — only the premium AI workflows pause.',
  },
  {
    q: 'How does brokerage pricing work?',
    a: 'Add an agent and billing updates automatically — the per-agent price drops as the team grows. No tier jumping, no calls to sales until you want them.',
  },
];

function PlanCard({ card }: { card: Card }) {
  const p = PLANS[card.id];
  return (
    <div
      className={`flex flex-col rounded-2xl border p-8 ${
        card.featured ? 'border-brand/60' : 'border-border/70'
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {p.label}
      </p>
      <p style={TITLE_FONT} className="mt-4 text-[44px] leading-none tracking-[-0.02em] text-foreground">
        {p.priceMonthly === 0 ? '$0' : `$${p.priceMonthly}`}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {p.priceMonthly === 0 ? 'free forever' : 'per month'}
        {p.includedUsers > 1 ? ` · ${p.includedUsers} users` : ''}
      </p>
      <p className="mt-5 text-sm text-foreground/85">{card.blurb}</p>
      <p className="mt-5 text-sm text-foreground">
        <span style={TITLE_FONT} className="text-xl">
          {(p.monthlyCredits || p.oneTimeCredits || 0).toLocaleString()}
        </span>{' '}
        <span className="text-muted-foreground">
          credits{p.monthlyCredits ? ' / month' : ' to start'}
        </span>
      </p>
      {p.addUser && (
        <p className="mt-1 text-xs text-muted-foreground">
          +${p.addUser.priceMonthly}/user · +{p.addUser.credits.toLocaleString()} credits
        </p>
      )}
      <Link href={card.cta.href} className={`${PRIMARY_PILL} mt-8 w-full justify-center`}>
        {card.cta.label}
      </Link>
    </div>
  );
}

export default function PricingPage() {
  return (
    <>
      <MarketingHero
        eyebrow="PRICING"
        title="Pricing that scales with your team."
        sub="Every plan starts with a 7-day free trial — card collected at checkout. Premium AI workflows draw from a monthly credit balance, and brokerage pricing expands automatically as you add agents."
        primaryCta={{ label: 'Start free trial', href: SIGNUP }}
        secondaryCta={{ label: 'Talk to sales for teams', href: '/demo' }}
      />

      {/* Individual plans */}
      <section className="relative pb-16 md:pb-24">
        <div className="mx-auto max-w-4xl px-6 md:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            For individual agents
          </p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {INDIVIDUAL.map((c) => (
              <PlanCard key={c.id} card={c} />
            ))}
          </div>
        </div>
      </section>

      {/* Team plans */}
      <section className="relative pb-16 md:pb-24">
        <div className="mx-auto max-w-4xl px-6 md:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            For teams
          </p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {TEAM.map((c) => (
              <PlanCard key={c.id} card={c} />
            ))}
          </div>
        </div>
      </section>

      {/* Brokerage expansion */}
      <section className="relative pb-16 md:pb-24">
        <div className="mx-auto max-w-3xl px-6 md:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Brokerage expansion
          </p>
          <h2 style={TITLE_FONT} className="mt-3 text-[28px] md:text-[36px] tracking-[-0.02em] text-foreground">
            Add an agent. Billing updates automatically.
          </h2>
          <div className="mt-8 overflow-hidden rounded-2xl border border-border/70">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Agents</th>
                  <th className="px-5 py-3 font-medium tabular-nums">Monthly / agent</th>
                  <th className="px-5 py-3 font-medium tabular-nums">Annual / agent</th>
                </tr>
              </thead>
              <tbody>
                {EXPANSION.map((row) => (
                  <tr key={row.range} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-3 text-foreground">{row.range}</td>
                    <td className="px-5 py-3 tabular-nums text-foreground">${row.mo}</td>
                    <td className="px-5 py-3 tabular-nums text-foreground">${row.yr}</td>
                  </tr>
                ))}
                <tr>
                  <td className="px-5 py-3 text-foreground">200+ agents</td>
                  <td className="px-5 py-3 text-muted-foreground" colSpan={2}>
                    Custom — performance pricing available.{' '}
                    <Link href="/demo" className="text-brand hover:underline">Talk to sales</Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Credits explainer */}
      <section className="relative pb-16 md:pb-24">
        <div className="mx-auto max-w-3xl px-6 md:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Premium AI workflows
          </p>
          <h2 style={TITLE_FONT} className="mt-3 text-[28px] md:text-[36px] tracking-[-0.02em] text-foreground">
            Credits are spent when Chippi does real work.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Every paid plan includes a monthly credit balance. High-value actions cost more; routine ones cost little. Unused credits roll over for 30 days.
          </p>
          <ul className="mt-8 divide-y divide-border/60 border-t border-b border-border/60">
            {(Object.keys(WORKFLOW_CREDIT_COST) as (keyof typeof WORKFLOW_CREDIT_COST)[])
              .filter((k) => k in WORKFLOW_LABELS)
              .map((k) => (
              <li key={k} className="flex items-center justify-between py-3">
                <span className="text-sm text-foreground">{WORKFLOW_LABELS[k]}</span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {WORKFLOW_CREDIT_COST[k]} {WORKFLOW_CREDIT_COST[k] === 1 ? 'credit' : 'credits'}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Need more? One-time top-ups
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {Object.values(TOPUPS).map((t) => (
              <div key={t.id} className="rounded-2xl border border-border/70 p-5">
                <p className="text-sm font-medium text-foreground">{t.label}</p>
                <p style={TITLE_FONT} className="mt-2 text-2xl tabular-nums text-foreground">
                  {t.credits.toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">credits · ${t.price} one-time</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="relative py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-6 md:px-8">
          <div className="text-center">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Questions
            </p>
            <h2
              style={TITLE_FONT}
              className="mt-4 text-[34px] sm:text-[44px] tracking-[-0.02em] text-foreground"
            >
              What people ask first.
            </h2>
          </div>
          <ul className="mt-14 divide-y divide-border/60 border-t border-b border-border/60">
            {FAQ.map((item) => (
              <li key={item.q} className="py-8">
                <p className="text-base md:text-lg font-medium text-foreground">{item.q}</p>
                <p className="mt-3 text-sm md:text-base text-muted-foreground leading-relaxed">{item.a}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <MarketingCTA
        title="Start your free trial. Grow when you’re ready."
        sub="Seven days free, cancel anytime. Bring your inbox and let Chippi do the work."
        primaryCta={{ label: 'Start free trial', href: SIGNUP }}
        secondaryCta={{ label: 'Talk to sales', href: '/demo' }}
      />
    </>
  );
}
