'use client';

/**
 * Marketing nav: fortitudo's floating pill with mega-menu dropdowns, retooled
 * for Chippi's information architecture and made theme-aware (the original was
 * charcoal-only; this leans on the semantic card/border tokens so the pill is
 * a frosted white card in light mode and a frosted near-black in dark).
 *
 * Chippi routes only. Auth links go to Chippi's Clerk flows:
 *   Log in  → /login/realtor
 *   Start free → /login/realtor?intent=signup
 *
 * The mega-menu groups surface the real anchor sections on the Realtors and
 * Brokerages pages plus the flat routes (Integrations, Pricing, Company).
 */

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { BrandLogo } from '@/components/brand-logo';
import { FortitudoThemeToggle } from './theme-toggle';
import { AsciiField } from './ascii-field';
import {
  Menu,
  X,
  ChevronDown,
  ArrowRight,
  PenLine,
  Target,
  CalendarCheck,
  KanbanSquare,
  Users,
  Building2,
  GitBranch,
  BarChart3,
  Plug,
  CreditCard,
  Briefcase,
  Activity,
} from 'lucide-react';

interface MegaMenuItem {
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
}

const realtorItems: MegaMenuItem[] = [
  { label: 'Drafts in your voice', href: '/realtors#the-reply', icon: PenLine, description: 'Replies written before you open the thread' },
  { label: 'Know who to call first', href: '/realtors#first-call', icon: Target, description: 'Every lead scored against your deals' },
  { label: 'Book the tour', href: '/realtors#in-the-field', icon: CalendarCheck, description: 'Reply with a time; Chippi handles the rest' },
  { label: 'A pipeline that does not lie', href: '/realtors#one-workspace', icon: KanbanSquare, description: 'One workspace, not six tabs' },
];

const brokerageItems: MegaMenuItem[] = [
  { label: 'For brokerages', href: '/brokerages', icon: Building2, description: 'A teammate for every agent on the floor' },
  { label: 'Lead routing', href: '/brokerages', icon: GitBranch, description: 'The right lead to the right agent' },
  { label: 'The whole room', href: '/brokerages', icon: BarChart3, description: 'Performance and bottlenecks at a glance' },
  { label: 'Book a demo', href: '/demo', icon: Briefcase, description: 'See it on your own floor' },
];

const moreItems: MegaMenuItem[] = [
  { label: 'Integrations', href: '/integrations', icon: Plug, description: 'Connect the tools you already use' },
  { label: 'Pricing', href: '/pricing', icon: CreditCard, description: 'One plan, honest pricing' },
  { label: 'Company', href: '/company', icon: Users, description: 'Why we built Chippi' },
  { label: 'Status', href: '/status', icon: Activity, description: 'Live system status' },
];

const navGroups = [
  { label: 'Realtors', items: realtorItems },
  { label: 'Brokerages', items: brokerageItems },
  { label: 'More', items: moreItems },
];

const menuItemVariants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(6px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const },
  },
};

function MegaMenuDropdown({
  items,
  isOpen,
  onClose,
}: {
  items: MegaMenuItem[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      className="absolute left-1/2 top-full z-50 mt-3 w-[520px] -translate-x-1/2 rounded-marketing-3xl border border-border/70 bg-card/95 p-3 shadow-2xl shadow-black/10 ring-1 ring-inset ring-border/40 backdrop-blur-2xl animate-fade-up dark:shadow-black/50"
    >
      <div className="grid grid-cols-2 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              onClick={onClose}
              className="group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-foreground/[0.05]"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function FortitudoNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Floating pill header. */}
      <header className="fixed left-1/2 top-4 z-50 w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2">
        <div className="rounded-full border border-border/70 bg-card/80 shadow-xl shadow-black/5 ring-1 ring-inset ring-border/40 backdrop-blur-2xl dark:shadow-black/40">
          <div className="flex h-14 items-center justify-between pl-4 pr-3 sm:pl-5">
            {/* Logo. */}
            <Link href="/" className="flex items-center gap-2" aria-label="Chippi home">
              <BrandLogo className="h-5" alt="Chippi" />
            </Link>

            {/* Desktop mega-menu nav. */}
            <nav className="hidden items-center gap-0.5 lg:flex">
              {navGroups.map((group) => (
                <div key={group.label} className="relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === group.label ? null : group.label)}
                    className={cn(
                      'flex cursor-pointer items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors',
                      openMenu === group.label
                        ? 'bg-brand/5 text-brand'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {group.label}
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform',
                        openMenu === group.label && 'rotate-180',
                      )}
                    />
                  </button>
                  <MegaMenuDropdown
                    items={group.items}
                    isOpen={openMenu === group.label}
                    onClose={() => setOpenMenu(null)}
                  />
                </div>
              ))}
            </nav>

            {/* Right side. */}
            <div className="flex items-center gap-1.5">
              <div className="hidden items-center gap-2 lg:flex">
                <FortitudoThemeToggle />
                <Link
                  href="/login/realtor"
                  className="rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Log in
                </Link>
                <Link
                  href="/login/realtor?intent=signup"
                  className="rounded-full bg-brand px-5 py-2 text-sm font-semibold text-brand-foreground shadow-lg shadow-brand/25 transition-all hover:brightness-105 hover:shadow-brand/40"
                >
                  Start free trial
                </Link>
              </div>

              {/* Mobile menu button. */}
              <FortitudoThemeToggle className="lg:hidden" />
              <button
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-foreground transition-colors hover:bg-foreground/[0.06] lg:hidden"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
              >
                <Menu size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Full-screen ASCII mobile menu. */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="fixed inset-0 z-[100] lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="absolute inset-0 bg-background/95 backdrop-blur-xl" />
            <AsciiField className="pointer-events-none absolute inset-0 h-full w-full opacity-25" cell={14} />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,rgba(255,150,79,0.16),transparent_60%)]" />

            <motion.div
              className="relative flex h-full flex-col overflow-y-auto"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center justify-between px-5 pt-6">
                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileOpen(false)}>
                  <BrandLogo className="h-5" alt="Chippi" />
                </Link>
                <button
                  aria-label="Close menu"
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-border/70 bg-foreground/[0.04] text-foreground transition-colors hover:bg-foreground/[0.08]"
                  onClick={() => setMobileOpen(false)}
                >
                  <X size={20} />
                </button>
              </div>

              <motion.nav
                className="flex-1 space-y-9 px-5 py-10"
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.12 } } }}
                initial="hidden"
                animate="show"
              >
                {navGroups.map((group) => (
                  <div key={group.label}>
                    <motion.p
                      variants={menuItemVariants}
                      className="text-xs uppercase tracking-[0.3em] text-brand/80"
                    >
                      {group.label}
                    </motion.p>
                    <div className="mt-3 space-y-1.5">
                      {group.items.map((item) => (
                        <motion.div key={item.href + item.label} variants={menuItemVariants}>
                          <Link
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            className="block font-brand text-3xl leading-tight text-foreground/90 transition-colors hover:text-brand"
                          >
                            {item.label}
                          </Link>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.nav>

              <div className="space-y-3 border-t border-border/60 px-5 pb-8 pt-5">
                <Link
                  href="/login/realtor?intent=signup"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-12 w-full items-center justify-center gap-1.5 rounded-full bg-brand text-sm font-semibold text-brand-foreground transition-all hover:brightness-105"
                >
                  Start free trial
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/login/realtor"
                  onClick={() => setMobileOpen(false)}
                  className="flex h-12 w-full items-center justify-center rounded-full border border-border/70 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground"
                >
                  Log in
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
