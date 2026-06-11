'use client';

/**
 * HomeFooter — the arrival. A last quiet CTA, the full link map, and an
 * oversized Chippi wordmark that anchors the page. Light canvas, editorial.
 * Used on the rebuilt homepage in place of the shared MarketingFooter.
 */

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { Reveal } from './home-kit';

const COLUMNS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'For realtors', href: '/realtors' },
      { label: 'For brokerages', href: '/brokerages' },
      { label: 'Integrations', href: '/integrations' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Company', href: '/company' },
      { label: 'Book a demo', href: '/demo' },
      { label: 'Status', href: '/status' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: '/legal/privacy' },
      { label: 'Terms', href: '/legal/terms' },
    ],
  },
];

export function HomeFooter() {
  return (
    <footer className="relative bg-card border-t border-border/60">
      <div className="mx-auto max-w-7xl px-6 pt-20 md:px-8 md:pt-28">
        {/* last CTA */}
        <Reveal className="flex flex-col items-start justify-between gap-8 border-b border-black/[0.08] pb-16 md:flex-row md:items-end">
          <h2 className="max-w-2xl font-title text-[clamp(2rem,4.5vw,3.5rem)] font-normal leading-[1.04] tracking-[-0.02em] text-foreground">
            Ready to let the busywork run itself?
          </h2>
          <div className="flex gap-3">
            <Link
              href="/login/realtor?intent=signup"
              className="inline-flex h-12 items-center justify-center rounded-full bg-brand px-7 text-[15px] font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all duration-150 hover:brightness-105 active:scale-[0.98]"
            >
              Start free
            </Link>
            <Link
              href="/demo"
              className="inline-flex h-12 items-center justify-center rounded-full bg-black/[0.04] px-6 text-[15px] font-medium text-foreground transition-colors hover:bg-black/[0.07]"
            >
              Book a demo
            </Link>
          </div>
        </Reveal>

        {/* link map */}
        <div className="grid grid-cols-2 gap-8 py-16 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" aria-label="Chippi home" className="inline-flex items-center">
              <BrandLogo className="h-6" alt="Chippi" />
            </Link>
            <p className="mt-4 max-w-[16rem] text-[14px] leading-relaxed text-foreground/50">
              The agentic OS for real estate. You close; Chippi does the rest.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground/40">
                {col.title}
              </p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="text-[14px] text-foreground/65 transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      {/* oversized wordmark */}
      <div aria-hidden className="overflow-hidden px-6 md:px-8">
        <div
          style={{ fontFamily: 'var(--font-title)' }}
          className="select-none text-[clamp(4rem,20vw,16rem)] leading-[0.8] tracking-[-0.03em] text-foreground/[0.06]"
        >
          Chippi
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 py-8 text-[13px] text-foreground/45 md:flex-row md:px-8">
        <span>© {new Date().getFullYear()} Chippi. All rights reserved.</span>
        <span className="inline-flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          All systems operational
        </span>
      </div>
    </footer>
  );
}
