'use client';

/**
 * AuthPageLayout: rebuilt on the fortitudo "studio ASCII" auth design.
 * a premium split screen with an ASCII brand panel on the left (drifting
 * orange field + a brand-display tagline) and the Clerk form on the right.
 * The Clerk components, redirect wiring, role switcher, and ToS copy are
 * unchanged. Only the chrome around them is restyled.
 *
 * Theme-aware: the ASCII field is orange-on-transparent so the panel reads on
 * both light and dark. On mobile the brand panel collapses to a slim signature
 * strip above the form (fortitudo's mobile treatment).
 */

import React from 'react';
import { motion } from 'framer-motion';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BODY_MUTED, CAPTION, H1 } from '@/lib/typography';
import { PAGE_VARIANTS } from '@/lib/motion';
import { AsciiField } from '@/components/marketing/fortitudo/ascii-field';

export interface AuthPageLayoutProps {
  children: React.ReactNode;
  heading: string;
  subheading?: string;
  variant?: 'realtor' | 'broker';
}

export function AuthPageLayout({ children, heading, subheading, variant: _variant }: AuthPageLayoutProps) {
  const pathname = usePathname();

  const isBrokerLogin = pathname.startsWith('/login/broker');
  const isRealtorLogin = pathname.startsWith('/login/realtor');
  const showRoleSwitcher = isBrokerLogin || isRealtorLogin;

  return (
    <main className="relative grid min-h-screen bg-background lg:grid-cols-2">
      {/* ── Left ASCII brand panel (desktop) ── */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border/70 p-12 lg:flex">
        <AsciiField className="absolute inset-0 h-full w-full opacity-40" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_30%_30%,rgba(255,150,79,0.18),transparent_60%)]" />

        <Link href="/" className="relative z-10 flex items-center gap-2" aria-label="Chippi home">
          <BrandLogo className="h-7" alt="Chippi" />
        </Link>

        <div className="relative z-10">
          <p className="font-brand text-xs uppercase tracking-[0.25em] text-brand">
            The agentic OS for real estate
          </p>
          <h2 className="font-brand mt-4 text-4xl leading-tight tracking-tight text-foreground">
            I keep your day moving, so you don&apos;t have to.
          </h2>
          <p className="mt-4 text-sm text-muted-foreground">
            Drafts · Scoring · Tours · Pipeline
          </p>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="relative flex w-full flex-col bg-background px-6 py-6 sm:px-10 sm:py-8 lg:py-10">
        {/* Mobile signature strip. */}
        <div className="absolute inset-x-0 top-0 h-24 overflow-hidden lg:hidden">
          <AsciiField className="h-full w-full opacity-30" cell={10} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-background" />
        </div>

        {/* Logo (mobile + as the panel's top mark). */}
        <div className="relative z-10 shrink-0 lg:hidden">
          <BrandLogo className="h-6 sm:h-7" alt="Chippi" />
        </div>

        {/* Form area. */}
        <div className="relative z-10 flex flex-1 flex-col justify-center py-6 sm:py-8 lg:py-0">
          <motion.div
            variants={PAGE_VARIANTS}
            initial="initial"
            animate="enter"
            className="mx-auto w-full max-w-[380px]"
          >
            {/* Role switcher: fully rounded, paper-flat. */}
            {showRoleSwitcher && (
              <div role="tablist" aria-label="Account type" className="mb-6 flex rounded-full bg-foreground/[0.04] p-1">
                <Link
                  href="/login/realtor"
                  role="tab"
                  aria-selected={isRealtorLogin}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium transition-all sm:py-2',
                    isRealtorLogin
                      ? 'border border-border/70 bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <User size={16} className="shrink-0 sm:size-[14px]" />
                  Realtor
                </Link>
                <Link
                  href="/login/broker"
                  role="tab"
                  aria-selected={isBrokerLogin}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2.5 text-sm font-medium transition-all sm:py-2',
                    isBrokerLogin
                      ? 'border border-border/70 bg-background text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Building2 size={16} className="shrink-0 sm:size-[14px]" />
                  Broker
                </Link>
              </div>
            )}

            {/* Heading: brand display face, the screen's headline. */}
            {heading && (
              <div className="mb-6 space-y-1.5">
                <h1 className={cn(H1, 'font-brand')}>{heading}</h1>
                {subheading && <p className={BODY_MUTED}>{subheading}</p>}
              </div>
            )}

            <div className="w-full">{children}</div>
          </motion.div>
        </div>

        {/* ToS / Privacy. */}
        <p className={cn(CAPTION, 'relative z-10 shrink-0 pt-4 text-center leading-relaxed sm:text-left')}>
          By continuing, you agree to our{' '}
          <Link href="/legal/terms" className="underline underline-offset-4 transition-colors hover:text-foreground">
            Terms of Service
          </Link>{' '}
          and{' '}
          <Link href="/legal/privacy" className="underline underline-offset-4 transition-colors hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
