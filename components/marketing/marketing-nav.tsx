'use client';

/**
 * Marketing nav — the sticky top bar.
 *
 * Apple-flat by design: hairline bottom border, backdrop-blurred background,
 * a row of plain-text nav links, ghost + primary pills on the right.
 *
 * The site consolidated to a handful of pages (Realtors, Brokerages,
 * Integrations, Pricing, Company), so the old Features/Teams hover mega-menu
 * was retired. The nav is now a flat link row — no panels, no grace timers,
 * no state machine. The best part is no part.
 */

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { cn } from '@/lib/utils';
import { PRIMARY_PILL, GHOST_PILL } from '@/lib/typography';
import { MarketingNavMobile } from './marketing-nav-mobile';
import { MarketingThemeToggle } from './marketing-theme-toggle';
import { TOP_LEVEL_NAV } from './marketing-nav-links';

export function MarketingNav() {
  return (
    <header
      className={cn(
        'sticky top-0 z-50 w-full',
        'bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70',
        'border-b border-border/60',
      )}
    >
      <nav className="mx-auto max-w-7xl px-6 md:px-8 h-16 flex items-center justify-between">
        {/* Brand mark */}
        <Link href="/" aria-label="Chippi home" className="flex items-center">
          <BrandLogo className="h-5" alt="Chippi" />
        </Link>

        {/* Desktop nav row */}
        <ul className="hidden md:flex items-center gap-1">
          {TOP_LEVEL_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  'inline-flex items-center h-9 px-3 rounded-md text-sm font-medium',
                  'text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04]',
                  'transition-colors duration-150',
                )}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Right cluster — theme toggle + pills + mobile trigger */}
        <div className="flex items-center gap-2">
          <MarketingThemeToggle />
          <Link href="/login/realtor" className={cn(GHOST_PILL, 'hidden sm:inline-flex')}>
            Log in
          </Link>
          <Link href="/demo" className={cn(GHOST_PILL, 'hidden lg:inline-flex')}>
            Book a demo
          </Link>
          <Link
            href="/login/realtor?intent=signup"
            className={cn(PRIMARY_PILL, 'hidden md:inline-flex')}
          >
            Start free trial
          </Link>
          {/* Mobile menu trigger drives its own Sheet */}
          <MarketingNavMobile />
        </div>
      </nav>
    </header>
  );
}
