'use client';

import { UserButton, useUser } from '@clerk/nextjs';
import { Sun, Moon, X } from 'lucide-react';
import { MenuToggleIcon } from '@/components/ui/menu-toggle-icon';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet';
import { useTheme } from '@/components/theme-provider';
import { AnimatePresence, motion } from 'framer-motion';
import { BrandLogo } from '@/components/brand-logo';
import { secondaryNavItems, realtorNavItems } from '@/lib/nav-items';
import type { NavChild, NavItem } from '@/lib/nav-items';
import { SECTION_LABEL } from '@/lib/typography';
import { SidebarConversations } from '@/components/dashboard/sidebar-conversations';
import { SidebarNavItem } from '@/components/dashboard/sidebar-nav-item';
import {
  SearchPill,
  WorkspaceSwitcher,
  brokerAdminNavSections,
  brokerMemberNavSections,
} from '@/components/dashboard/sidebar';
import { triggerAccountSwitch } from '@/components/dashboard/account-switch';
import { SidebarWhatsNew } from '@/components/dashboard/sidebar-whats-new';
import { SidebarUserMenu } from '@/components/dashboard/sidebar-user-menu';
import { Building2, ArrowLeftRight, Briefcase, ChevronDown, ArrowLeft, Bell, CreditCard, Settings, Check, Calendar, BarChart2, ClipboardList, Wallet, FolderOpen, Shield, PanelLeft, PanelLeftClose } from 'lucide-react';
import { useSidebarCollapsed } from '@/components/dashboard/sidebar-collapse';
import { NotificationCenter } from './notification-center';
import { NotificationBell } from '@/components/broker/notification-bell';
import { ShareLinksMenu } from './share-links-menu';
import { ChippiPowerToggle } from '@/components/chippi/chippi-power-toggle';
import { getBreadcrumbLabel } from '@/lib/breadcrumb-routes';

// Broker mobile nav is sourced from the SINGLE source of truth shared with the
// desktop sidebar — `brokerAdminNavSections` / `brokerMemberNavSections` from
// components/dashboard/sidebar.tsx — and rendered through the same
// `SidebarNavItem` accordion. No separate flat copy here (that drifted: it lost
// the Chippi chip + Brief/Inbox/History dropdown and used different icons).

interface HeaderProps {
  slug: string;
  /** Owning Space.id — threaded through to NotificationCenter so its
   *  Realtime subscriptions can filter by spaceId. Without this, a
   *  permissive RLS regression would deliver cross-tenant rows. */
  spaceId?: string;
  spaceName: string;
  title: string;
  isBroker?: boolean;
  isBrokerOnly?: boolean;
  brokerageName?: string | null;
  brokerageRole?: string | null;
  isPlatformAdmin?: boolean;
}

/** Returns true if the pathname belongs to this item or any of its children.
 *  Mirrors the desktop sidebar's helper so accordion auto-expansion is
 *  computed the same way on both viewports. */
function doesItemOwnPath(item: NavItem, pathname: string, base: string): boolean {
  if (item.children?.length) {
    const childOwns = item.children.some((child) => {
      const childPath = child.href.split('?')[0];
      const fullChildPath = `${base}${childPath}`;
      return child.exact
        ? pathname === fullChildPath
        : pathname.startsWith(fullChildPath);
    });
    if (childOwns) return true;
  }
  return pathname.startsWith(`${base}${item.href}`);
}

/** Lightweight child-active match for the mobile drawer. Realtor children
 *  today don't carry query params, so the desktop's query-string branch
 *  isn't needed here. If that changes, swap this for the shared helper. */
function isMobileChildActive(child: NavChild, pathname: string, base: string): boolean {
  const fullHref = `${base}${child.href.split('?')[0]}`;
  if (child.exact) return pathname === fullHref;
  return pathname === fullHref || pathname.startsWith(`${fullHref}/`);
}

/**
 * Desktop sidebar collapse toggle — the panel icon at the top-left of the
 * header (Claude-style). Reads the shared collapse context provided by the
 * layout, so it stays in sync with the sidebar's own edge handle. Hidden on
 * mobile (the drawer handles nav there).
 */
function SidebarCollapseToggle() {
  const { collapsed, toggle } = useSidebarCollapsed();
  const Icon = collapsed ? PanelLeft : PanelLeftClose;
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="hidden md:inline-flex items-center justify-center w-8 h-8 rounded-full border border-border/70 bg-background text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 active:scale-[0.96]"
    >
      <Icon size={17} strokeWidth={1.75} />
    </button>
  );
}

export function Header({ slug, spaceId, spaceName, title, isBroker = false, isBrokerOnly = false, brokerageName = null, brokerageRole = null, isPlatformAdmin = false }: HeaderProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const base = `/s/${slug}`;
  const { theme, toggleTheme } = useTheme();
  const isOnBrokerPage = pathname.startsWith('/broker');
  const showBrokerMobileNavOnly = isBroker && isOnBrokerPage;
  const isOnChippi = pathname.startsWith(`${base}/chippi`);
  const { user } = useUser();
  // Admin console link — DB platformRole (server prop) OR Clerk metadata, so
  // an admin set either way sees it. Matches the desktop sidebar.
  const showAdminLink =
    isPlatformAdmin ||
    (user?.publicMetadata as { role?: string } | undefined)?.role === 'admin';
  const drawerDisplayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'My Account'
    : 'My Account';
  const drawerEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  // Accordion expansion state for the mobile drawer — same contract as the
  // desktop sidebar: at most one parent open at a time, auto-expand the
  // parent that owns the current route. Closing the drawer doesn't reset
  // this; reopening reflects whatever route the realtor is on now.
  const findActiveParentKey = (): string | null => {
    for (const item of realtorNavItems) {
      if (item.children?.length && doesItemOwnPath(item, pathname, base)) {
        return item.href;
      }
    }
    return null;
  };
  const [expandedKey, setExpandedKey] = useState<string | null>(findActiveParentKey);

  useEffect(() => {
    const next = findActiveParentKey();
    if (next) setExpandedKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, base]);

  const handleToggle = (key: string) => () =>
    setExpandedKey((prev) => (prev === key ? null : key));
  const closeDrawer = () => setOpen(false);

  // Broker drawer accordion — same contract as the realtor one above, driven by
  // the shared broker nav sections (base="" since broker hrefs are absolute).
  const brokerSections =
    brokerageRole === 'realtor_member' ? brokerMemberNavSections : brokerAdminNavSections;
  const findBrokerActiveParentKey = (): string | null => {
    for (const section of brokerSections) {
      for (const item of section.items) {
        if (item.children?.length && doesItemOwnPath(item, pathname, '')) {
          return item.href;
        }
      }
    }
    return null;
  };
  const [brokerExpandedKey, setBrokerExpandedKey] = useState<string | null>(
    findBrokerActiveParentKey,
  );
  useEffect(() => {
    const next = findBrokerActiveParentKey();
    if (next) setBrokerExpandedKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, brokerageRole]);
  const handleBrokerToggle = (key: string) => () =>
    setBrokerExpandedKey((prev) => (prev === key ? null : key));

  return (
    <header data-dashboard-header className="h-14 flex items-center justify-between px-4 md:px-6 sticky top-0 z-40">
      <div className="flex items-center gap-3">
        {/* Desktop sidebar collapse toggle (Claude-style panel icon). */}
        <SidebarCollapseToggle />
        {/* Mobile menu trigger — explicit 44×44 tap target with proper hover
            state, not a bare SVG. Radix's Trigger wraps whatever child you
            give it; without dimensions the click area is just the icon. */}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 -ml-2 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 active:scale-[0.98]"
            >
              <MenuToggleIcon open={open} className="size-5" duration={400} />
            </button>
          </SheetTrigger>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-screen max-w-none sm:max-w-none p-0 border-0 bg-sidebar text-sidebar-foreground flex flex-col overflow-hidden"
          >
            {/* 44x44 close affordance, top-right, plain X — Radix wires the
                close behaviour. Solid background (no translucent overlay)
                because the drawer is full-screen — the realtor is in nav
                mode, not peeking through. */}
            <SheetClose asChild>
              <button
                type="button"
                aria-label="Close menu"
                className="absolute top-2 right-2 z-20 inline-flex items-center justify-center w-11 h-11 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 active:scale-[0.98]"
              >
                <X className="size-5" strokeWidth={1.75} />
              </button>
            </SheetClose>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-orange-50/60 via-orange-50/20 to-transparent dark:from-orange-500/[0.04] dark:via-transparent z-0" />
            <div className="relative z-10 flex flex-col h-full overflow-y-auto">
            <SheetHeader className="px-4 py-5 border-b border-sidebar-border">
              <SheetTitle className="flex items-center gap-2.5 text-sidebar-foreground">
                <BrandLogo className="h-5" alt="Chippi" />
              </SheetTitle>
              {/* Workspace switcher — uses the shared desktop component so the
                  rich popover (email header, ⌘-shortcuts, "+ New" footer) is
                  identical across viewports. Inside a Sheet the Radix Popover
                  portals to document.body so it isn't clipped by the drawer. */}
              <div className="mt-2 -mx-3">
                <WorkspaceSwitcher
                  currentName={pathname.startsWith('/broker') ? (brokerageName ?? 'Team') : spaceName}
                  currentSubtitle={pathname.startsWith('/broker') ? 'Team' : 'My workspace'}
                  currentIcon={pathname.startsWith('/broker') ? Building2 : Briefcase}
                  slug={slug}
                  spaceName={spaceName}
                  brokerageMemberships={
                    isBroker && brokerageName
                      ? [{ id: 'current', name: brokerageName, role: brokerageRole ?? 'member' }]
                      : []
                  }
                  isOnBrokerPage={pathname.startsWith('/broker')}
                  userEmail={drawerEmail}
                  inDrawer
                />
              </div>
            </SheetHeader>
            <div className="px-3 pt-3">
              <SearchPill />
            </div>
            <nav className="flex-1 overflow-y-auto px-3 pt-4 pb-2 space-y-0.5">
              {!isBrokerOnly && !showBrokerMobileNavOnly && (
                <>
                  {/* Primary nav ALWAYS renders. The realtor must be able to
                      reach any destination from any route — the previous
                      drawer hid the nav entirely on /chippi, which left them
                      stranded with only chat history.

                      Uses the SAME SidebarNavItem the desktop sidebar
                      renders, so accordion behaviour, chevron affordance,
                      and motion params are identical across viewports.
                      Default state: every parent COLLAPSED. The parent of
                      the active route auto-expands; tapping a different
                      parent's chevron closes the previous one (one open at
                      a time). Tapping a link closes the drawer. */}
                  <div className="space-y-0.5">
                    {realtorNavItems.map((item) => {
                      const hasChildren = !!item.children?.length;
                      return (
                        <SidebarNavItem
                          key={item.href}
                          item={item}
                          base={base}
                          isActive={doesItemOwnPath(item, pathname, base)}
                          isExpanded={hasChildren && expandedKey === item.href}
                          isChildActive={(child) => isMobileChildActive(child, pathname, base)}
                          onToggle={handleToggle(item.href)}
                          onNavigate={closeDrawer}
                        />
                      );
                    })}
                  </div>

                  {/* Chat history — animates in/out below the primary nav
                      when the route enters/leaves /chippi. Same motion
                      params as the desktop sidebar's chippi section so the
                      app feels coherent across viewports. */}
                  <AnimatePresence initial={false} mode="wait">
                    {isOnChippi && (
                      <motion.div
                        key="mobile-chippi-history"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                        className="pt-2"
                      >
                        <div className="mx-3 mb-2 h-px bg-border/60" aria-hidden />
                        <SidebarConversations
                          slug={slug}
                          limit={6}
                          onSelect={() => setOpen(false)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}
              {/* Broker drawer — renders the SAME broker nav sections as the
                  desktop sidebar through the SAME SidebarNavItem accordion, so
                  the Chippi chip, Brief/Inbox/History dropdown, icons, and
                  adminOnly gating are identical across viewports. Only shown on
                  broker pages; brokerage links never bleed into the agent
                  drawer (you switch workspaces with the switcher up top). */}
              {isBroker && showBrokerMobileNavOnly && (
                <div className="space-y-3">
                  {brokerSections.map((section) => {
                    const visibleItems = section.items.filter(
                      (item) =>
                        !item.adminOnly ||
                        brokerageRole === 'broker_owner' ||
                        brokerageRole === 'broker_admin',
                    );
                    if (visibleItems.length === 0) return null;
                    return (
                      <div key={section.label || 'primary'} className="space-y-0.5">
                        {section.label ? (
                          <p className={`${SECTION_LABEL} px-3 pb-1.5`}>{section.label}</p>
                        ) : null}
                        {visibleItems.map((item) => {
                          const hasChildren = !!item.children?.length;
                          return (
                            <SidebarNavItem
                              key={item.href}
                              item={item}
                              base=""
                              isActive={doesItemOwnPath(item, pathname, '')}
                              isExpanded={hasChildren && brokerExpandedKey === item.href}
                              isChildActive={(child) => isMobileChildActive(child, pathname, '')}
                              onToggle={handleBrokerToggle(item.href)}
                              onNavigate={closeDrawer}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </nav>
            {/* What's new + user-menu chip — same components the desktop
                sidebar uses so localStorage state is shared (dismissals,
                favorites, etc.). Only renders for the realtor workspace —
                the broker drawer keeps its existing team/account footer. */}
            {!isBrokerOnly && !showBrokerMobileNavOnly && slug && (
              <>
                <SidebarWhatsNew />
                {showAdminLink && (
                  <>
                    <div className="border-t border-sidebar-border" />
                    <Link
                      href="/admin"
                      onClick={closeDrawer}
                      className="group flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground transition-colors"
                    >
                      <Shield size={16} strokeWidth={1.75} className="flex-shrink-0 opacity-70 group-hover:opacity-100" />
                      Admin
                    </Link>
                  </>
                )}
                <div className="border-t border-sidebar-border" />
                <SidebarUserMenu
                  slug={slug}
                  displayName={drawerDisplayName}
                  email={drawerEmail}
                  imageUrl={user?.imageUrl ?? null}
                  inDrawer
                />
              </>
            )}
            <div className="px-3 pb-4 space-y-0.5 border-t border-sidebar-border pt-3">
              {!showBrokerMobileNavOnly && ((pathname.startsWith(`${base}/settings`) || pathname.startsWith(`${base}/billing`)) ? (
                <>
                  <Link
                    href={base}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
                  >
                    <ArrowLeft size={14} /> Back to dashboard
                  </Link>
                  {[
                    { label: 'Settings', items: [
                      { href: `${base}/settings`, label: 'Settings', icon: Settings },
                    ]},
                    { label: 'Account', items: [
                      { href: `${base}/billing`, label: 'Billing', icon: CreditCard },
                    ]},
                  ].map((section) => (
                    <div key={section.label}>
                      <p className={`${SECTION_LABEL} px-3 pb-1 pt-2`}>{section.label}</p>
                      {section.items.map((item) => {
                        const isActive = item.href === `${base}/settings` ? pathname === item.href : pathname.startsWith(item.href);
                        return (
                          <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
                            className={cn('group flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                              isActive ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground font-normal hover:bg-accent hover:text-foreground'
                            )}>
                            <item.icon size={16} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-55 group-hover:opacity-80')} />
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  ))}
                </>
              ) : secondaryNavItems.length > 0 ? (
                <>
                  <p className={`${SECTION_LABEL} px-3 pb-1.5`}>
                    Account
                  </p>
                  {secondaryNavItems.map((item) => {
                    const href = `${base}${item.href}`;
                    const isActive = pathname.startsWith(href);
                    return (
                      <Link
                        key={item.href}
                        href={href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'group flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
                          isActive
                            ? 'bg-accent text-foreground font-medium'
                            : 'text-muted-foreground font-normal hover:bg-accent hover:text-foreground'
                        )}
                      >
                        <item.icon size={16} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-55 group-hover:opacity-80')} />
                        {item.label}
                      </Link>
                    );
                  })}
                </>
              ) : null)}
              <div className="flex items-center gap-2 px-3 pt-3">
                <BrandLogo className="h-4" alt="Chippi" />
              </div>
            </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Mobile: the Chippi mark in the top bar. On desktop the sidebar logo
            and the breadcrumb carry identity; on mobile the sidebar is hidden
            (bottom MobileNav takes over) and the top bar otherwise shows only
            the menu button — so the brand mark would be absent until the drawer
            is opened. Links to the dashboard home. */}
        <Link
          href={isOnBrokerPage ? '/broker' : base}
          className="md:hidden inline-flex items-center"
          aria-label="Chippi home"
        >
          <BrandLogo className="h-5" alt="Chippi" />
        </Link>

        {/* Chippi mark on the brokerage dashboard header — gives the broker
            surface the same brand anchor the realtor side carries. */}
        {isOnBrokerPage && (
          <Link href="/broker" className="hidden md:inline-flex items-center mr-1" aria-label="Chippi">
            <BrandLogo className="h-5" alt="Chippi" />
          </Link>
        )}

        {/* Desktop breadcrumb — small, monospaced separator, no chunky pills.
            The current section reads as the focal label; the workspace name
            is quiet context. Quick-switch is a borderless link, not a chip. */}
        <div className="hidden md:flex items-center gap-2 text-[13px]">
          {(pathname.startsWith('/broker') || isBrokerOnly) && brokerageName ? (
            <>
              <span className="text-muted-foreground/70 truncate max-w-[160px]">{brokerageName}</span>
              <span className="text-muted-foreground/30">/</span>
              <span className="font-medium text-foreground">
                {getBreadcrumbLabel(pathname)}
              </span>
              {!isBrokerOnly && slug && (
                <Link
                  href={base}
                  className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  title={`Switch to ${spaceName}`}
                >
                  <ArrowLeftRight size={10} />
                  {spaceName}
                </Link>
              )}
            </>
          ) : (
            <>
              <span className="text-muted-foreground/70 truncate max-w-[160px]">{title}</span>
              <span className="text-muted-foreground/30">/</span>
              <span className="font-medium text-foreground">
                {getBreadcrumbLabel(pathname, base)}
              </span>
              {isBroker && brokerageName && (
                <Link
                  href="/broker"
                  onClick={() => triggerAccountSwitch()}
                  className="ml-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
                  title={`Switch to ${brokerageName}`}
                >
                  <ArrowLeftRight size={10} />
                  {brokerageName}
                </Link>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right cluster — quiet icon row in the new sidebar language. Search
          lives on the sidebar's pill (and ⌘K) so the header doesn't carry a
          duplicate trigger. */}
      <div className="flex items-center gap-1.5">
        {slug && <ChippiPowerToggle />}
        {slug && !isOnBrokerPage && <ShareLinksMenu slug={slug} />}
        {slug && <NotificationCenter slug={slug} spaceId={spaceId} />}
        {isBrokerOnly && !slug && <NotificationBell />}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title="Toggle theme"
          className="h-8 w-8 flex items-center justify-center rounded-full border border-border/70 bg-background text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
        >
          {theme === 'dark' ? <Sun size={14} strokeWidth={1.75} /> : <Moon size={14} strokeWidth={1.75} />}
        </button>
        <div className="[&_.cl-userButtonTrigger]:rounded-full">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
