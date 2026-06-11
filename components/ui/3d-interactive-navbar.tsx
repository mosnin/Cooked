'use client';

/**
 * Chippi marketing nav — a floating, Apple-grade PILL nav.
 *
 * A translucent, theme-aware pill, sticky at the top, centered. It adapts to
 * light and dark via semantic tokens. Left: the theme-aware Chippi logo.
 * Center: the marketing links, each (except Pricing) a dropdown that jumps to
 * real, anchored sections of its page. Right: Log in + a foreground-filled
 * Start free pill.
 *
 * Motion is built on the repo's Apple curve (EASE_APPLE) and durations from
 * lib/motion.ts:
 *   - a sliding highlight behind the hovered/active link via `layoutId`
 *     (the iOS segmented-control move),
 *   - dropdown reveal = soft fade + small scale/translate-y, items staggered in,
 *     exit handled by AnimatePresence,
 *   - a ~150ms grace timer so the cursor can travel from trigger to panel
 *     without it snapping shut,
 *   - prefers-reduced-motion drops every transform.
 *
 * No WebGL, no Three, no decrypt glitch. SSR-safe — imported normally by the
 * marketing layout wrapper.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from 'motion/react';
import { cn } from '@/lib/utils';
import { EASE_APPLE, DURATION_FAST } from '@/lib/motion';
import { BrandLogo } from '@/components/brand-logo';

// ----------------------------------------------------------------------------
// Nav model — links + the REAL page sections each dropdown jumps to.
// Each `to` is an id anchored on the target page (see page.tsx files).
// Copy voice: calm, lowercase-ish, no em dashes, apostrophes escaped.
// ----------------------------------------------------------------------------

interface NavSection {
  label: string;
  desc: string;
  to: string; // anchor id on the page
}

interface NavLink {
  label: string;
  href: string;
  sections?: NavSection[];
}

const NAV_LINKS: NavLink[] = [
  {
    label: 'Realtors',
    href: '/realtors',
    sections: [
      {
        label: 'In the field',
        desc: 'reachable on whatever screen is already in your hand.',
        to: 'in-the-field',
      },
      {
        label: 'The reply',
        desc: 'drafts in your voice, ready before you open the thread.',
        to: 'the-reply',
      },
      {
        label: 'First call',
        desc: 'every inquiry scored, so you know who to call first.',
        to: 'first-call',
      },
      {
        label: 'One workspace',
        desc: 'everything in one place instead of six tabs.',
        to: 'one-workspace',
      },
      {
        label: 'You stay in control',
        desc: 'nothing leaves without your name on it.',
        to: 'stay-in-control',
      },
    ],
  },
  {
    label: 'Brokerages',
    href: '/brokerages',
    sections: [
      {
        label: 'Empower the floor',
        desc: 'give every agent an extra teammate of their own.',
        to: 'empower-the-floor',
      },
      {
        label: 'Lead distribution',
        desc: 'every lead routed to the right realtor.',
        to: 'lead-distribution',
      },
      {
        label: 'Performance',
        desc: 'see what the floor is closing, live.',
        to: 'performance',
      },
      {
        label: 'Bottlenecks',
        desc: 'find where deals stall, then unblock them.',
        to: 'bottlenecks',
      },
      {
        label: 'Team chat',
        desc: 'talk shop on the same page, mention Chippi in channel.',
        to: 'team-chat',
      },
    ],
  },
  {
    label: 'Integrations',
    href: '/integrations',
    sections: [
      {
        label: 'How it works',
        desc: 'connect once, Chippi does the reaching.',
        to: 'how-it-works',
      },
      {
        label: 'The catalog',
        desc: 'every app Chippi can work inside.',
        to: 'the-catalog',
      },
      {
        label: 'Get connected',
        desc: 'bring the tools you already use.',
        to: 'get-connected',
      },
    ],
  },
  {
    label: 'Pricing',
    href: '/pricing',
  },
  {
    label: 'Company',
    href: '/company',
    sections: [
      {
        label: 'The gap',
        desc: 'the work moved on, the software didn’t.',
        to: 'the-gap',
      },
      {
        label: 'The founders',
        desc: 'built by people who know the work.',
        to: 'the-founders',
      },
      {
        label: 'What we believe',
        desc: 'a few things we won’t move on.',
        to: 'what-we-believe',
      },
    ],
  },
];

// ----------------------------------------------------------------------------
// Desktop dropdown panel
// ----------------------------------------------------------------------------

const panelVariants: Variants = {
  hidden: { opacity: 0, y: -6, scale: 0.985 },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.2, ease: EASE_APPLE, staggerChildren: 0.03 },
  },
  exit: {
    opacity: 0,
    y: -6,
    scale: 0.985,
    transition: { duration: DURATION_FAST, ease: EASE_APPLE },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: -4 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE_APPLE } },
  exit: { opacity: 0 },
};

const reducedPanelVariants: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: DURATION_FAST } },
  exit: { opacity: 0, transition: { duration: DURATION_FAST } },
};

function DropdownPanel({
  link,
  reduced,
  onNavigate,
  onMouseEnter,
  onMouseLeave,
}: {
  link: NavLink;
  reduced: boolean;
  onNavigate: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const sections = link.sections ?? [];
  return (
    <motion.div
      variants={reduced ? reducedPanelVariants : panelVariants}
      initial="hidden"
      animate="shown"
      exit="exit"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="absolute left-1/2 top-full z-50 mt-3 w-[340px] -translate-x-1/2"
    >
      {/* small hover bridge so the cursor can cross the gap without closing */}
      <div aria-hidden className="absolute -top-3 left-0 right-0 h-3" />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/95 p-1.5 shadow-2xl backdrop-blur-xl">
        <ul>
          {sections.map((s) => (
            <motion.li key={s.to} variants={reduced ? undefined : itemVariants}>
              <Link
                href={`${link.href}#${s.to}`}
                onClick={onNavigate}
                className="group flex flex-col gap-0.5 rounded-xl px-3.5 py-2.5 transition-colors hover:bg-foreground/[0.04]"
              >
                <span className="text-[13.5px] font-medium text-foreground">
                  {s.label}
                </span>
                <span className="text-[12.5px] leading-snug text-muted-foreground">
                  {s.desc}
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
        <Link
          href={link.href}
          onClick={onNavigate}
          className="group/all mt-0.5 flex items-center justify-between rounded-xl px-3.5 py-2.5 text-[12.5px] text-foreground/55 transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
        >
          all of {link.label.toLowerCase()}
          <span aria-hidden className="transition-transform group-hover/all:translate-x-0.5">
            &rarr;
          </span>
        </Link>
      </div>
    </motion.div>
  );
}

// ----------------------------------------------------------------------------
// Desktop nav cluster — links + sliding highlight (layoutId)
// ----------------------------------------------------------------------------

function DesktopNav({ reduced }: { reduced: boolean }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((i: number) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpenIdx(i);
  }, []);

  // ~150ms grace so the cursor can travel trigger → panel without snapping shut
  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpenIdx(null), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const active = (i: number) => hoverIdx === i || openIdx === i;

  return (
    <nav
      className="relative hidden items-center md:flex"
      onMouseLeave={() => setHoverIdx(null)}
    >
      {NAV_LINKS.map((link, i) => {
        const hasMenu = !!link.sections?.length;
        return (
          <div
            key={link.href}
            className="relative"
            onMouseEnter={() => {
              setHoverIdx(i);
              if (hasMenu) open(i);
            }}
            onMouseLeave={() => {
              if (hasMenu) scheduleClose();
            }}
          >
            <Link
              href={link.href}
              className="relative flex items-center gap-1 px-3.5 py-2 text-[13.5px] font-medium text-foreground/70 transition-colors hover:text-foreground"
            >
              {/* sliding highlight — the iOS segmented move */}
              {active(i) && (
                <motion.span
                  layoutId="nav-highlight"
                  className="absolute inset-0 -z-10 rounded-full bg-foreground/[0.06]"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: 'spring', stiffness: 520, damping: 42, mass: 0.7 }
                  }
                />
              )}
              <span className={cn(active(i) && 'text-foreground')}>{link.label}</span>
              {hasMenu && (
                <motion.span
                  aria-hidden
                  animate={{ rotate: openIdx === i ? 180 : 0 }}
                  transition={{ duration: 0.18, ease: EASE_APPLE }}
                  className="text-[9px] text-foreground/40"
                >
                  &#9662;
                </motion.span>
              )}
            </Link>

            {hasMenu && (
              <AnimatePresence>
                {openIdx === i && (
                  <DropdownPanel
                    link={link}
                    reduced={reduced}
                    onNavigate={() => setOpenIdx(null)}
                    onMouseEnter={() => open(i)}
                    onMouseLeave={scheduleClose}
                  />
                )}
              </AnimatePresence>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ----------------------------------------------------------------------------
// Mobile sheet — hamburger → overlay with collapsible link groups
// ----------------------------------------------------------------------------

function MobileGroup({
  link,
  onNavigate,
}: {
  link: NavLink;
  onNavigate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasMenu = !!link.sections?.length;

  if (!hasMenu) {
    return (
      <Link
        href={link.href}
        onClick={onNavigate}
        className="flex items-center justify-between rounded-xl px-3 py-3.5 text-[17px] font-medium text-foreground transition-colors active:bg-foreground/[0.04]"
      >
        {link.label}
      </Link>
    );
  }

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-left text-[17px] font-medium text-foreground transition-colors active:bg-foreground/[0.04]"
      >
        {link.label}
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18, ease: EASE_APPLE }}
          className="text-[11px] text-foreground/45"
        >
          &#9662;
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE_APPLE }}
            className="overflow-hidden"
          >
            <ul className="pb-2 pl-3">
              {link.sections!.map((s) => (
                <li key={s.to}>
                  <Link
                    href={`${link.href}#${s.to}`}
                    onClick={onNavigate}
                    className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 transition-colors active:bg-foreground/[0.04]"
                  >
                    <span className="text-[15px] font-medium text-foreground/90">
                      {s.label}
                    </span>
                    <span className="text-[13px] leading-snug text-muted-foreground">
                      {s.desc}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MobileSheet({
  open,
  onClose,
  reduced,
}: {
  open: boolean;
  onClose: () => void;
  reduced: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE_APPLE }}
          className="absolute inset-x-3 top-[72px] z-40 overflow-hidden rounded-3xl border border-border/70 bg-background/95 p-2 shadow-2xl backdrop-blur-xl md:hidden"
        >
          <div className="max-h-[calc(100vh-7rem)] overflow-y-auto">
            {NAV_LINKS.map((link) => (
              <MobileGroup key={link.href} link={link} onNavigate={onClose} />
            ))}
            <div className="mt-2 flex flex-col gap-2 border-t border-border/60 p-2 pt-3">
              <Link
                href="/login/realtor"
                onClick={onClose}
                className="flex h-11 items-center justify-center rounded-full text-[15px] font-medium text-foreground/80 ring-1 ring-border transition-colors active:bg-foreground/[0.04]"
              >
                Log in
              </Link>
              <Link
                href="/login/realtor?intent=signup"
                onClick={onClose}
                className="flex h-11 items-center justify-center rounded-full bg-foreground text-[15px] font-medium text-background transition-transform active:scale-[0.98]"
              >
                Start free
              </Link>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ----------------------------------------------------------------------------
// Navbar
// ----------------------------------------------------------------------------

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const reduced = useReducedMotion() ?? false;

  return (
    <header className="sticky top-0 z-50 w-full">
      <div className="mx-auto max-w-5xl px-3 pt-3 md:px-4">
        <div className="relative flex h-14 items-center justify-between rounded-full border border-border/70 bg-background/80 pl-5 pr-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.12)] backdrop-blur-xl">
          {/* Left: logo — theme-aware, flips with light/dark */}
          <Link href="/" aria-label="Chippi home" className="flex shrink-0 items-center">
            <BrandLogo className="h-5 w-auto" alt="Chippi" />
          </Link>

          {/* Center: nav links + dropdowns */}
          <div className="absolute left-1/2 -translate-x-1/2">
            <DesktopNav reduced={reduced} />
          </div>

          {/* Right: auth */}
          <div className="flex items-center gap-1">
            <Link
              href="/login/realtor"
              className="hidden h-9 items-center rounded-full px-3.5 text-[13.5px] font-medium text-foreground/70 transition-colors hover:text-foreground md:inline-flex"
            >
              Log in
            </Link>
            <Link
              href="/login/realtor?intent=signup"
              className="hidden h-9 items-center rounded-full bg-foreground px-4 text-[13.5px] font-medium text-background transition-transform duration-150 hover:opacity-90 active:scale-[0.98] md:inline-flex"
            >
              Start free
            </Link>

            {/* Mobile trigger */}
            <button
              type="button"
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center text-foreground md:hidden"
            >
              <span className="relative flex h-3.5 w-5 flex-col justify-between">
                <span
                  className={cn(
                    'h-0.5 w-full rounded-full bg-foreground transition-transform duration-200',
                    mobileOpen && 'translate-y-[6px] rotate-45',
                  )}
                />
                <span
                  className={cn(
                    'h-0.5 w-full rounded-full bg-foreground transition-opacity duration-200',
                    mobileOpen && 'opacity-0',
                  )}
                />
                <span
                  className={cn(
                    'h-0.5 w-full rounded-full bg-foreground transition-transform duration-200',
                    mobileOpen && '-translate-y-[6px] -rotate-45',
                  )}
                />
              </span>
            </button>
          </div>
        </div>
      </div>

      <MobileSheet
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        reduced={reduced}
      />
    </header>
  );
}

export default Navbar;
