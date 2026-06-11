'use client';

/**
 * AdminShell — the chrome wrapper for every admin page.
 *
 * Visual language: matches the realtor sidebar exactly — FlatNavItem
 * pattern, 2px foreground active rail, hairline borders, SECTION_LABEL
 * token, h-9 rows. Paper-flat. No shadows on chrome.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton, useUser } from '@clerk/nextjs';
import {
  LayoutDashboard,
  Users,
  Building,
  Building2,
  Mail,
  CreditCard,
  ScrollText,
  Megaphone,
  Send,
  LineChart,
  BarChart3,
  Activity,
  Bot,
  Menu,
  Sun,
  Moon,
  Shield,
  ArrowLeft,
  Gauge,
  LifeBuoy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useTheme } from '@/components/theme-provider';
import { BrandLogo } from '@/components/brand-logo';
import { PAGE_MAX, SIDEBAR_WIDTH } from '@/lib/geometry';
import { SECTION_LABEL } from '@/lib/typography';
import { useState } from 'react';

// ── Nav structure (routes unchanged) ──────────────────────────────────────

const navSections = [
  {
    label: 'Management',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
      { href: '/admin/users', label: 'Users', icon: Users, exact: false },
      { href: '/admin/brokerages', label: 'Brokerages', icon: Building2, exact: false },
      { href: '/admin/spaces', label: 'Spaces', icon: Building, exact: false },
      { href: '/admin/billing', label: 'Billing', icon: CreditCard, exact: false },
      { href: '/admin/invitations', label: 'Invitations', icon: Mail, exact: false },
    ],
  },
  {
    label: 'Growth',
    items: [
      { href: '/admin/broadcast', label: 'Broadcast', icon: Send, exact: false },
      { href: '/admin/announcements', label: 'Announcements', icon: Megaphone, exact: false },
      { href: '/admin/cohorts', label: 'Cohorts', icon: LineChart, exact: false },
      { href: '/admin/form-analytics', label: 'Form analytics', icon: BarChart3, exact: false },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/scoring-health', label: 'Scoring health', icon: Activity, exact: false },
      { href: '/admin/agent-stats', label: 'Agent health', icon: Bot, exact: false },
      { href: '/admin/audit-log', label: 'Audit log', icon: ScrollText, exact: false },
      { href: '/admin/observability', label: 'Observability', icon: Gauge, exact: false },
      { href: '/admin/support', label: 'Support', icon: LifeBuoy, exact: false },
    ],
  },
] as const;

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  exact: boolean;
};

const navItems: NavItem[] = navSections.flatMap((s) => s.items as unknown as NavItem[]);

// Mobile bottom nav — highest-traffic pages only
const mobileNavItems: NavItem[] = [
  navSections[0].items[0] as unknown as NavItem, // Overview
  navSections[0].items[1] as unknown as NavItem, // Users
  navSections[0].items[2] as unknown as NavItem, // Brokerages
  navSections[0].items[4] as unknown as NavItem, // Billing
  navSections[2].items[2] as unknown as NavItem, // Audit log
];

// ── NavLink — mirrors FlatNavItem from the realtor sidebar ─────────────────

function NavLink({
  item,
  pathname,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  onClick?: () => void;
}) {
  const isActive = item.exact
    ? pathname === item.href
    : pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'group relative flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-md text-[13px] transition-colors duration-150',
        isActive
          ? 'bg-foreground/[0.045] text-foreground font-medium'
          : 'text-foreground/65 hover:bg-foreground/[0.025] hover:text-foreground',
      )}
    >
      {/* Active rail — 2px foreground strip on the left edge. The one place
          a 2px border appears; same signature as the realtor sidebar. */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-foreground"
        />
      )}
      <item.icon
        size={15}
        strokeWidth={isActive ? 2.25 : 1.75}
        className={cn(
          'flex-shrink-0 transition-colors',
          isActive ? 'text-foreground' : 'text-foreground/55 group-hover:text-foreground',
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

// ── Section label — canonical SECTION_LABEL token ─────────────────────────

function NavSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(SECTION_LABEL, 'px-3 pt-6 pb-2 select-none')}>
      {children}
    </p>
  );
}

// ── User footer chip — mirrors the realtor sidebar's UserFooter ────────────
// Avatar + name + email pinned to the bottom of the sidebar. The Clerk
// UserButton is the avatar and carries the account menu (manage, sign out),
// so identity lives in the same place as the rest of the app.

function AdminUserFooter() {
  const { user } = useUser();
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.username ||
    'Admin';
  const email = user?.primaryEmailAddress?.emailAddress ?? null;

  return (
    <div className="p-2">
      <div className="group flex items-center gap-2.5 h-9 pl-1.5 pr-2.5 rounded-md hover:bg-foreground/[0.025] transition-colors duration-150">
        <UserButton
          appearance={{ elements: { userButtonAvatarBox: 'w-7 h-7' } }}
        />
        <div className="flex-1 min-w-0 leading-tight">
          <p className="text-[13px] font-medium text-foreground truncate">
            {displayName}
          </p>
          {email && (
            <p className="text-[11px] text-muted-foreground truncate">{email}</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar nav — shared between desktop aside and mobile Sheet ────────────

function SidebarNav({
  pathname,
  onItemClick,
}: {
  pathname: string;
  onItemClick?: () => void;
}) {
  return (
    <nav className="flex-1 px-3 pt-2 pb-2 overflow-y-auto">
      {navSections.map((section) => (
        <div key={section.label}>
          <NavSectionLabel>{section.label}</NavSectionLabel>
          <div className="space-y-0.5">
            {(section.items as unknown as NavItem[]).map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                onClick={onItemClick}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ── AdminShell ─────────────────────────────────────────────────────────────

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="app-theme flex min-h-screen bg-background text-foreground">
      {/* ── Desktop sidebar ──────────────────────────────────────────────── */}
      <aside
        className={cn(
          'hidden md:flex flex-col h-screen sticky top-0 bg-sidebar border-r border-border/70 shrink-0',
          SIDEBAR_WIDTH,
        )}
      >
        {/* Brand header: logo + "admin" small-cap label */}
        <div className="px-4 pt-5 pb-3 flex items-center gap-2">
          <BrandLogo className="h-5" alt="Chippi" />
          <div className="flex items-center gap-1.5">
            <Shield
              size={11}
              strokeWidth={1.75}
              className="text-muted-foreground/50 flex-shrink-0"
            />
            <span className={cn(SECTION_LABEL, 'pt-px')}>admin</span>
          </div>
        </div>

        {/* Nav */}
        <SidebarNav pathname={pathname} />

        {/* Footer — Back to app link, hairline, then the user identity chip
            (pinned to the bottom, matching the realtor sidebar). */}
        <div className="border-t border-border/50">
          <div className="px-3 py-2">
            <Link
              href="/"
              className={cn(
                'group flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-md text-[13px] transition-colors duration-150',
                'text-foreground/55 hover:bg-foreground/[0.025] hover:text-foreground',
              )}
            >
              <ArrowLeft
                size={13}
                strokeWidth={1.75}
                className="flex-shrink-0 text-foreground/40 group-hover:text-foreground/70 transition-colors"
              />
              <span>Back to app</span>
            </Link>
          </div>
          <div className="border-t border-border/50">
            <AdminUserFooter />
          </div>
        </div>
      </aside>

      {/* ── Main column ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — sticky, quiet. Page titles live in the page body, not here. */}
        <header className="h-14 border-b border-border/70 flex items-center justify-between px-4 md:px-6 bg-background sticky top-0 z-40">
          <div className="flex items-center gap-3">
            {/* Mobile menu trigger */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open navigation"
                  className="md:hidden flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
                >
                  <Menu size={17} strokeWidth={1.75} />
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-64 p-0 bg-sidebar border-r border-border/70"
              >
                <SheetHeader className="px-4 pt-5 pb-3 flex flex-row items-center gap-2">
                  <BrandLogo className="h-5" alt="Chippi" />
                  <div className="flex items-center gap-1.5">
                    <Shield size={11} strokeWidth={1.75} className="text-muted-foreground/50" />
                    <SheetTitle asChild>
                      <span className={cn(SECTION_LABEL, 'pt-px')}>admin</span>
                    </SheetTitle>
                  </div>
                </SheetHeader>
                <SidebarNav pathname={pathname} onItemClick={() => setOpen(false)} />
                <div className="border-t border-border/50">
                  <div className="px-3 py-2">
                    <Link
                      href="/"
                      onClick={() => setOpen(false)}
                      className={cn(
                        'group flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-md text-[13px] transition-colors duration-150',
                        'text-foreground/55 hover:bg-foreground/[0.025] hover:text-foreground',
                      )}
                    >
                      <ArrowLeft size={13} strokeWidth={1.75} className="flex-shrink-0 opacity-50" />
                      <span>Back to app</span>
                    </Link>
                  </div>
                  <div className="border-t border-border/50">
                    <AdminUserFooter />
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {/* Mobile identity (visible only below md) */}
            <div className="md:hidden flex items-center gap-1.5">
              <BrandLogo className="h-4" alt="Chippi" />
              <Shield size={11} strokeWidth={1.75} className="text-muted-foreground/50" />
              <span className={cn(SECTION_LABEL, 'pt-px')}>admin</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              {theme === 'dark' ? (
                <Sun size={14} strokeWidth={1.75} />
              ) : (
                <Moon size={14} strokeWidth={1.75} />
              )}
            </Button>
            {/* Identity lives in the sidebar footer (desktop) / drawer footer
                (mobile), matching the realtor dashboard — not in the header. */}
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-8 md:px-8 md:py-10 pb-24 md:pb-12">
          <div className={cn('w-full mx-auto', PAGE_MAX)}>
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border/70 flex safe-area-bottom">
        {mobileNavItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <div
                className={cn(
                  'w-9 h-6 rounded-md flex items-center justify-center transition-colors',
                  isActive ? 'bg-foreground/[0.06]' : '',
                )}
              >
                <item.icon size={16} strokeWidth={isActive ? 2.25 : 1.75} />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
