'use client';

/**
 * Marketing nav — mobile full-screen drawer.
 *
 * Opens as a left-side Sheet that covers the full viewport. Inside, the nav
 * rows stack vertically as plain links — the site consolidated to a handful
 * of pages, so the old Features/Teams inline expansion was retired.
 *
 * The drawer's top edge carries the same warm wash gradient as the dashboard
 * mobile drawer. It's the one sanctioned brand-orange surface on marketing —
 * the realtor opening the nav from a phone touches the same vocabulary they'd
 * touch inside the product. Sanctioned in STYLESHEET.md §Color via the LOGO
 * context (onboarding/brand-wash surface family).
 */

import { useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { BrandLogo } from '@/components/brand-logo';
import { PRIMARY_PILL, GHOST_PILL } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { TOP_LEVEL_NAV } from './marketing-nav-links';

/** Plain top-level row — a straight link. The h-14 height gives a generous
 *  tap target. */
function MobileTopRow({
  href,
  label,
  onNavigate,
}: {
  href: string;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center h-14 px-5 text-base font-medium text-foreground',
        'hover:bg-foreground/[0.04] active:bg-foreground/[0.06]',
        'transition-colors duration-150',
      )}
    >
      {label}
    </Link>
  );
}

export function MarketingNavMobile() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className={cn(
            'md:hidden inline-flex items-center justify-center w-11 h-11 -mr-2',
            'rounded-md text-foreground/70 hover:text-foreground',
            'hover:bg-foreground/[0.04] transition-colors duration-150',
            'active:scale-[0.98]',
          )}
        >
          <MenuToggleIcon open={open} className="size-5" duration={400} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className={cn(
          'w-screen max-w-none sm:max-w-none',
          'p-0 border-0 bg-background flex flex-col overflow-hidden',
        )}
      >
        {/* Brand wash — same recipe as the dashboard mobile drawer. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32 z-0 bg-gradient-to-b from-orange-50/60 via-orange-50/20 to-transparent dark:from-orange-500/[0.04] dark:via-transparent"
        />
        <div className="relative z-10 flex flex-col h-full">
          {/* Header row: brand mark left, close right */}
          <div className="flex items-center justify-between h-16 px-5 border-b border-border/60">
            <SheetTitle asChild>
              <Link
                href="/"
                onClick={close}
                aria-label="Chippi home"
                className="flex items-center"
              >
                <BrandLogo className="h-5" alt="Chippi" />
              </Link>
            </SheetTitle>
            <SheetClose asChild>
              <button
                type="button"
                aria-label="Close menu"
                className={cn(
                  'inline-flex items-center justify-center w-11 h-11 -mr-2',
                  'rounded-md text-foreground/70 hover:text-foreground',
                  'hover:bg-foreground/[0.04] transition-colors duration-150',
                  'active:scale-[0.98]',
                )}
              >
                <X size={20} strokeWidth={1.75} />
              </button>
            </SheetClose>
          </div>

          {/* Primary nav — vertical stack of tall rows */}
          <nav className="flex-1 overflow-y-auto py-2">
            {TOP_LEVEL_NAV.map((item) => (
              <MobileTopRow
                key={item.href}
                href={item.href}
                label={item.label}
                onNavigate={close}
              />
            ))}
            <MobileTopRow href="/demo" label="Book a demo" onNavigate={close} />
          </nav>

          {/* Bottom CTAs — full-width pair separated by a hairline */}
          <div className="border-t border-border/60 px-5 py-4 space-y-2.5">
            <Link
              href="/login/realtor"
              onClick={close}
              className={cn(
                GHOST_PILL,
                'w-full justify-center h-11',
                'text-foreground border border-border/70',
              )}
            >
              Log in
            </Link>
            <Link
              href="/login/realtor?intent=signup"
              onClick={close}
              className={cn(PRIMARY_PILL, 'w-full justify-center h-11')}
            >
              Start free trial
            </Link>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
