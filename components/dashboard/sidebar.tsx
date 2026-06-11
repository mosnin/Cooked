'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUser } from '@clerk/nextjs';
import { cn } from '@/lib/utils';
import { triggerAccountSwitch } from '@/components/dashboard/account-switch';
import { BrandLogo } from '@/components/brand-logo';
import { repNavItems, repMoreNavItems } from '@/lib/nav-items';
import type { NavItem, NavChild } from '@/lib/nav-items';
import { SECTION_LABEL } from '@/lib/typography';
import { SIDEBAR_WIDTH, SIDEBAR_COLLAPSED } from '@/lib/geometry';
import {
  CollapsedTooltip,
  useSidebarCollapsed,
} from '@/components/dashboard/sidebar-collapse';
import { SidebarNavItem } from '@/components/dashboard/sidebar-nav-item';
import { SidebarConversations } from '@/components/dashboard/sidebar-conversations';
import { SidebarWhatsNew } from '@/components/dashboard/sidebar-whats-new';
import { SidebarUserMenu } from '@/components/dashboard/sidebar-user-menu';
import { PulseNumber } from '@/components/ui/pulse-number';
import {
  Building2,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  UserCircle,
  Mail,
  LayoutDashboard,
  SlidersHorizontal,
  Briefcase,
  ChevronsUpDown,
  PhoneIncoming,
  BarChart3,
  Trophy,
  FileText,
  Megaphone,
  MessageCircle,
  Activity,
  Upload,
  ArrowLeft,
  Settings,
  Key,
  Shuffle,
  GitBranch,
  CreditCard,
  Plus,
  Check,
  Search,
  Flag,
  History,
  SquarePen,
  Shield,
  Contact,
  Handshake,
  Plug,
  Gauge,
  TrendingUp,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface SidebarProps {
  slug: string;
  spaceName: string;
  unreadLeadCount: number;
  pendingDraftCount?: number;
  overdueFollowUpCount?: number;
  activePropertyCount?: number;
  isManager?: boolean;
  isManagerOnly?: boolean;
  teamName?: string | null;
  teamRole?: string | null;
  teamMemberships?: { id: string; name: string; role: string }[];
  isPlatformAdmin?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Manager nav definitions (unchanged structure)
// ═══════════════════════════════════════════════════════════════════════════════

// Phase 7 — manager admin sidebar collapses from 14 entries across 5 labeled
// sections to 5 primary items + a quiet "More" section for the rest.
//
// Primary (daily): Team · Leads · Pipeline · Members · Settings.
// More (one glance below — the routes that have existing users but don't
// earn daily prominence): Reps, Templates, Team Chat, Announcements,
// Leaderboard, Analytics, Import/Export. Invitations folds into Members.
// Settings sub-pages (form-builder, tracking, MCP, auto-assignment, routing
// rules) live behind /manager/settings's own in-page tab strip.
// Manager nav items extend the shared NavItem with the manager-only
// `adminOnly` flag. Rendered through the shared SidebarNavItem accordion
// (base=""), so children/exact behave exactly like the rep nav.
type ManagerNavItem = NavItem & { adminOnly?: boolean };
type ManagerNavSection = { label: string; items: ManagerNavItem[] };

export const managerAdminNavSections: ManagerNavSection[] = [
  {
    label: '',
    items: [
      // Koala-for-Managers Phase 1 — pinned at the top, mirroring the
      // rep sidebar's top-pinned Koala entry. Same icon (chip avatar
      // is rendered by the manager nav via FlatNavItem; MessageCircle is the
      // fallback used elsewhere in the manager nav). The existing
      // /manager/agent-activity entry was previously also labelled "Koala"
      // — that one is the activity feed, not the chat surface; renamed
      // to "Agent activity" below to avoid two nav rows with the same name.
      {
        href: '/manager',
        label: 'Koala',
        icon: MessageCircle,
        exact: true,
        adminOnly: false,
        isAI: true,
        // Mirrors the rep Koala dropdown (Brief / Inbox / History).
        // Brief and Reviews are real manager routes; "History" points at the
        // chat home (/manager), where the conversation-history drawer lives.
        children: [
          { href: '/manager/brief', label: 'Brief' },
          { href: '/manager/reviews', label: 'Inbox' },
          { href: '/manager', label: 'History', exact: true },
        ],
      },
      { href: '/manager/brief', label: 'Brief', icon: LayoutDashboard, exact: false, adminOnly: false },
      { href: '/manager/leads', label: 'Leads', icon: PhoneIncoming, exact: false, adminOnly: false },
      { href: '/manager/people', label: 'People', icon: Users, exact: false, adminOnly: false },
      { href: '/manager/deals', label: 'Deals', icon: Briefcase, exact: false, adminOnly: false },
      { href: '/manager/pipeline', label: 'Pipeline', icon: BarChart3, exact: false, adminOnly: false },
      { href: '/manager/forecast', label: 'Forecast', icon: TrendingUp, exact: false, adminOnly: false },
      { href: '/manager/properties', label: 'Properties', icon: Building2, exact: false, adminOnly: false },
      { href: '/manager/reviews', label: 'Reviews', icon: Flag, exact: false, adminOnly: false },
      { href: '/manager/agent-activity', label: 'Agent activity', icon: Activity, exact: false, adminOnly: false },
      { href: '/manager/integrations', label: 'Integrations', icon: Plug, exact: false, adminOnly: false },
      {
        href: '/manager/settings',
        label: 'Settings',
        icon: SlidersHorizontal,
        exact: false,
        adminOnly: true,
        // Real settings sub-routes (form-builder, auto-assignment, routing
        // rules, MCP all exist under app/manager/settings/). Dropdown gives
        // managers a direct door without first landing on the tab strip.
        children: [
          { href: '/manager/settings/form-builder', label: 'Form builder' },
          { href: '/manager/settings/auto-assignment', label: 'Auto-assignment' },
          { href: '/manager/settings/routing-rules', label: 'Routing rules' },
          { href: '/manager/settings/mcp', label: 'MCP' },
        ],
      },
    ],
  },
  {
    label: 'More',
    items: [
      { href: '/manager/members', label: 'Members', icon: Users, exact: false, adminOnly: false },
      { href: '/manager/reps', label: 'Reps', icon: UserCircle, exact: false, adminOnly: false },
      { href: '/manager/templates', label: 'Templates', icon: FileText, exact: false, adminOnly: false },
      { href: '/manager/leaderboard', label: 'Leaderboard', icon: Trophy, exact: false, adminOnly: false },
      { href: '/manager/analytics', label: 'Analytics', icon: BarChart3, exact: false, adminOnly: false },
      { href: '/manager/usage', label: 'Usage', icon: Gauge, exact: false, adminOnly: false },
      { href: '/manager/import-export', label: 'Import / export', icon: Upload, exact: false, adminOnly: true },
    ],
  },
];

// Phase 7 — rep-members of a team see their own work first.
// Team-wide tools live one glance below in the More section; routes are
// unchanged.
export const managerMemberNavSections: ManagerNavSection[] = [
  {
    label: '',
    items: [
      { href: '/manager', label: 'My day', icon: LayoutDashboard, exact: true, adminOnly: false },
      { href: '/manager/my-leads', label: 'My leads', icon: PhoneIncoming, exact: false, adminOnly: false },
    ],
  },
  {
    label: 'More',
    items: [
      { href: '/manager/templates', label: 'Templates', icon: FileText, exact: false, adminOnly: false },
      { href: '/manager/leaderboard', label: 'Leaderboard', icon: Trophy, exact: false, adminOnly: false },
    ],
  },
];

const managerSettingsNavSections = [
  {
    label: 'Team',
    items: [
      { href: '/manager/settings', label: 'General', icon: Settings, exact: true },
      { href: '/manager/settings/profile', label: 'Profile', icon: UserCircle, exact: false },
      { href: '/manager/invitations', label: 'Invitations', icon: Mail, exact: false },
      { href: '/manager/settings/mcp', label: 'MCP', icon: Key, exact: false },
    ],
  },
  {
    label: 'Lead management',
    items: [
      { href: '/manager/settings/auto-assignment', label: 'Auto-assignment', icon: Shuffle, exact: false },
      { href: '/manager/settings/routing-rules', label: 'Routing rules', icon: GitBranch, exact: false },
    ],
  },
  {
    label: 'Account',
    items: [
      { href: '/manager/billing', label: 'Billing', icon: CreditCard, exact: false },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers: determine active state for nav items and children
// ═══════════════════════════════════════════════════════════════════════════════

function isChildActive(child: NavChild, pathname: string, base: string, searchParams?: string): boolean {
  const [childPath, childQuery] = child.href.split('?');
  const fullHref = `${base}${childPath}`;

  // If the child has query params, match both pathname AND query params
  if (childQuery) {
    if (pathname !== fullHref && !pathname.startsWith(fullHref + '/')) return false;
    // Compare query params
    const childParams = new URLSearchParams(childQuery);
    const currentParams = new URLSearchParams(searchParams || '');
    for (const [key, value] of childParams.entries()) {
      if (currentParams.get(key) !== value) return false;
    }
    return true;
  }

  // No query params — use path matching
  if (child.exact) {
    // Exact match: pathname matches AND no filter query params present
    const currentParams = new URLSearchParams(searchParams || '');
    const hasFilterParams = currentParams.has('type') || currentParams.has('tier') || currentParams.has('sort');
    return pathname === fullHref && !hasFilterParams;
  }
  return pathname.startsWith(fullHref);
}

/** Returns true if the current pathname belongs to this item or any of its children. */
function doesItemOwnPath(item: NavItem, pathname: string, base: string): boolean {
  if (item.href === '') {
    return pathname === base;
  }
  if (item.children) {
    // Check children first — some children like /form-analytics don't share the parent prefix
    const childMatch = item.children.some((child) => {
      const childPath = child.href.split('?')[0];
      const fullChildPath = `${base}${childPath}`;
      return child.exact
        ? pathname === fullChildPath
        : pathname.startsWith(fullChildPath);
    });
    if (childMatch) return true;
  }
  // An `exact` parent only owns its own exact route — used by the manager
  // Koala entry (/manager), whose href is a prefix of every other manager
  // route. Without this, a prefix match would light up Koala on every
  // manager page. Rep parents don't set `exact`, so this is a no-op there.
  if (item.exact) {
    return pathname === `${base}${item.href}`;
  }
  return pathname.startsWith(`${base}${item.href}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section label (used in manager nav)
// ═══════════════════════════════════════════════════════════════════════════════

function SectionLabel({ children }: { children: React.ReactNode }) {
  // Empty labels hide entirely so a "label-less" section renders flush.
  if (!children) return null;
  // Uses the canonical SECTION_LABEL token + sidebar-specific spacing so every
  // small-caps grouping label across the app shares one type treatment.
  return (
    <p className={`${SECTION_LABEL} px-3 pt-6 pb-2 select-none`}>
      {children}
    </p>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Flat nav item (for manager nav, settings sub-pages)
// ═══════════════════════════════════════════════════════════════════════════════

function FlatNavItem({
  href,
  label,
  icon: Icon,
  isActive,
  badge,
  isAI = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  isActive: boolean;
  badge?: React.ReactNode;
  /**
   * When true the item renders the chip avatar (chip-avatar.png) instead of
   * the icon — matches the rep sidebar's top-pinned Koala treatment.
   * Use for the manager's Koala nav entry only.
   */
  isAI?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        // h-9 row, same height as the rep nav rows and canonical button
        // default so every row in the sidebar aligns optically.
        'group relative flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-md text-[13px] transition-colors duration-150',
        isActive
          ? 'bg-foreground/[0.045] text-foreground font-medium'
          : 'text-foreground/65 hover:bg-foreground/[0.025] hover:text-foreground',
      )}
    >
      {/* Active accent bar — 2px on the left, foreground tone, rounded
          corner on the inner edge. Matches the rep sidebar's active
          rail exactly (STYLESHEET §Border & radius — Active rail). */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-foreground"
        />
      )}
      {isAI ? (
        /* Chip avatar — same 16×16 rounded-full as the rep Koala row */
        <img
          src="/chip-avatar.png"
          alt=""
          className="w-[16px] h-[16px] rounded-full flex-shrink-0 ring-1 ring-border/40"
        />
      ) : (
        <Icon
          size={15}
          strokeWidth={isActive ? 2.25 : 1.75}
          className={cn(
            'flex-shrink-0 transition-colors',
            isActive ? 'text-foreground' : 'text-foreground/55 group-hover:text-foreground',
          )}
        />
      )}
      <span className="flex-1 truncate">{label}</span>
      {badge}
    </Link>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Search pill — opens the existing CommandPalette
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quiet "Search · ⌘K" pill below the workspace identity. The CommandPalette
 * (mounted at the layout level) listens for cmd+k / ctrl+k globally; the
 * pill triggers it via a synthetic KeyboardEvent so we don't need to plumb
 * a context. Detects platform for the kbd hint.
 */
export function SearchPill({ collapsed = false }: { collapsed?: boolean }) {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setIsMac(/Mac|iPhone|iPad/i.test(navigator.userAgent));
  }, []);

  function open() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, ctrlKey: false, bubbles: true }),
    );
  }

  if (collapsed) {
    return (
      <CollapsedTooltip enabled label="Search">
        <button
          type="button"
          onClick={open}
          className="mx-auto flex items-center justify-center h-9 w-9 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.025] transition-colors duration-150"
          aria-label="Open command palette"
        >
          <Search size={15} className="flex-shrink-0" strokeWidth={1.75} />
        </button>
      </CollapsedTooltip>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="mx-3 flex items-center gap-2 h-9 pl-3 pr-1.5 rounded-md text-[13px] text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.025] transition-colors duration-150 group"
      aria-label="Open command palette"
    >
      <Search size={13} className="flex-shrink-0" strokeWidth={1.75} />
      <span className="flex-1 text-left">Search</span>
      <kbd className="text-[10px] tabular-nums bg-foreground/[0.04] group-hover:bg-foreground/[0.06] text-muted-foreground px-1.5 py-0.5 rounded font-mono transition-colors">
        {isMac ? '⌘' : 'Ctrl+'}K
      </kbd>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Quick-create — SquarePen icon button beside the workspace switcher. Opens a
// small dropdown of "new record" shortcuts. The list deliberately stays short:
// new contact, new deal, new property. Anything else lives behind a full menu
// or the command palette.
// ═══════════════════════════════════════════════════════════════════════════════

function QuickCreateMenu({ slug }: { slug: string }) {
  const base = `/s/${slug}`;
  const items: { href: string; label: string }[] = [
    { href: `${base}/contacts/new`, label: 'New contact' },
    { href: `${base}/deals`, label: 'New deal' },
    { href: `${base}/properties/new`, label: 'New property' },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Quick create"
          className="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
        >
          <SquarePen size={13} strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-44">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href}>{item.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Workspace switcher
// ═══════════════════════════════════════════════════════════════════════════════

export function WorkspaceSwitcher({
  currentName,
  currentSubtitle,
  currentIcon: Icon,
  slug,
  spaceName,
  teamMemberships,
  isOnManagerPage,
  collapsed = false,
  showQuickCreate = false,
  userEmail = null,
  inDrawer = false,
}: {
  currentName: string;
  currentSubtitle: string;
  currentIcon: React.ComponentType<{ size?: number; className?: string }>;
  slug: string;
  spaceName: string;
  teamMemberships: { id: string; name: string; role: string }[];
  isOnManagerPage: boolean;
  collapsed?: boolean;
  /** Render the SquarePen "new" quick-create dropdown next to the switcher. */
  showQuickCreate?: boolean;
  /** Current user's email, rendered as the popover header. */
  userEmail?: string | null;
  /**
   * Mobile-drawer mode — expands the workspace list inline below the chip
   * instead of opening a Radix Popover. Radix Popover content inside a
   * modal Sheet ends up pointer-events-blocked because it portals as a
   * body sibling and the Sheet's modal disables siblings.
   */
  inDrawer?: boolean;
}) {
  const base = `/s/${slug}`;
  const [drawerExpanded, setDrawerExpanded] = useState(false);

  // Build the workspace list. The rep's own workspace is always first;
  // team memberships follow. Each gets a ⌘1/⌘2/⌘3… shortcut so the
  // popover doubles as a keyboard switcher — same shape as the inspiration.
  const workspaces: {
    key: string;
    name: string;
    href: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    isCurrent: boolean;
  }[] = [];
  if (slug) {
    workspaces.push({
      key: 'solo',
      name: spaceName,
      href: base,
      icon: Briefcase,
      isCurrent: !isOnManagerPage,
    });
  }
  for (const b of teamMemberships) {
    workspaces.push({
      key: b.id,
      name: b.name,
      href: '/manager',
      icon: Building2,
      isCurrent: isOnManagerPage,
    });
  }

  if (inDrawer) {
    // Inline-expand inside the mobile drawer. Same rich content as the
    // popover (email header, ⌘1/⌘2/⌘3, "+ New") just stacked vertically
    // below the chip instead of in a Popover portal.
    return (
      <div className="mx-3">
        <button
          type="button"
          onClick={() => setDrawerExpanded((v) => !v)}
          aria-expanded={drawerExpanded}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-foreground/[0.025]"
        >
          <div className="rounded-md bg-foreground/[0.06] flex items-center justify-center flex-shrink-0 w-6 h-6">
            <Icon size={12} className="text-foreground/80" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium truncate text-foreground leading-tight">
              {currentName}
            </p>
            <p className="text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em] leading-tight mt-0.5">
              {currentSubtitle}
            </p>
          </div>
          <ChevronsUpDown size={11} className="text-muted-foreground/40 flex-shrink-0" />
        </button>
        {drawerExpanded && (
          <div className="mt-1 pt-1 border-t border-border/40 space-y-0.5">
            <WorkspaceSwitcherRows
              workspaces={workspaces}
              userEmail={userEmail}
              hasTeam={teamMemberships.length > 0}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn(collapsed ? 'flex justify-center' : 'mx-3')}>
      <div className={cn('flex items-center', collapsed ? 'justify-center' : 'gap-1')}>
        <Popover>
          <CollapsedTooltip enabled={collapsed} label={`${currentName} · Switch workspace`}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  'rounded-md text-left transition-colors hover:bg-foreground/[0.025] cursor-pointer',
                  collapsed
                    ? 'flex items-center justify-center w-9 h-9'
                    : 'flex-1 min-w-0 flex items-center gap-2 px-2 py-1.5',
                )}
                aria-label={collapsed ? `${currentName} — switch workspace` : undefined}
              >
                <div className="rounded-md bg-foreground/[0.06] flex items-center justify-center flex-shrink-0 w-6 h-6">
                  <Icon size={12} className="text-foreground/80" />
                </div>
                {!collapsed && (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate text-foreground leading-tight">
                        {currentName}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70 uppercase tracking-[0.08em] leading-tight mt-0.5">
                        {currentSubtitle}
                      </p>
                    </div>
                    <ChevronsUpDown size={11} className="text-muted-foreground/40 flex-shrink-0" />
                  </>
                )}
              </button>
            </PopoverTrigger>
          </CollapsedTooltip>
          <WorkspaceSwitcherPopoverContent
            workspaces={workspaces}
            userEmail={userEmail}
            hasTeam={teamMemberships.length > 0}
            collapsed={collapsed}
          />
        </Popover>
        {!collapsed && showQuickCreate && (
          <QuickCreateMenu slug={slug} />
        )}
      </div>
    </div>
  );
}

function WorkspaceSwitcherRows({
  workspaces,
  userEmail,
  hasTeam,
}: {
  workspaces: {
    key: string;
    name: string;
    href: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    isCurrent: boolean;
  }[];
  userEmail: string | null;
  hasTeam: boolean;
}) {
  return (
    <>
      {userEmail && (
        <div className="flex items-center gap-2 px-2.5 py-2">
          <span className="flex-1 truncate text-[12px] text-foreground/85">
            {userEmail}
          </span>
          <ChevronsUpDown
            size={12}
            strokeWidth={1.75}
            className="text-muted-foreground/60 flex-shrink-0"
          />
        </div>
      )}
      {userEmail && <div className="my-1 mx-1 h-px bg-border/60" />}
      {workspaces.map((w, idx) => {
        const WIcon = w.icon;
        const shortcut = `⌘${idx + 1}`;
        return (
          <Link
            key={w.key}
            href={w.href}
            onClick={() => { if (!w.isCurrent && w.href === '/manager') triggerAccountSwitch(); }}
            className={cn(
              'group flex items-center gap-2.5 h-9 px-2 rounded-md text-[12px] transition-colors duration-150',
              w.isCurrent
                ? 'bg-foreground/[0.04] text-foreground'
                : 'text-foreground/85 hover:bg-foreground/[0.05] hover:text-foreground',
            )}
          >
            <div className="w-6 h-6 rounded-md bg-foreground/[0.06] flex items-center justify-center flex-shrink-0">
              <WIcon size={12} className="text-foreground/80" />
            </div>
            <span className="flex-1 truncate font-medium">{w.name}</span>
            {w.isCurrent ? (
              <Check size={13} strokeWidth={2} className="text-blue-500 flex-shrink-0" />
            ) : (
              <kbd className="text-[10px] tabular-nums bg-foreground/[0.04] text-muted-foreground px-1.5 py-0.5 rounded font-mono">
                {shortcut}
              </kbd>
            )}
          </Link>
        );
      })}
      <div className="my-1 mx-1 h-px bg-border/60" />
      <Link
        href="/team"
        className="group flex items-center gap-2 h-9 px-2 rounded-md text-[12px] text-foreground/70 hover:bg-foreground/[0.05] hover:text-foreground transition-colors duration-150"
      >
        <Plus size={13} strokeWidth={1.75} className="flex-shrink-0" />
        <span className="flex-1 text-left">
          {hasTeam ? 'New team' : 'Create or join a team'}
        </span>
        <kbd className="text-[10px] tabular-nums bg-foreground/[0.04] text-muted-foreground px-1.5 py-0.5 rounded font-mono">
          ⌘A
        </kbd>
      </Link>
    </>
  );
}

function WorkspaceSwitcherPopoverContent({
  workspaces,
  userEmail,
  hasTeam,
  collapsed,
}: {
  workspaces: {
    key: string;
    name: string;
    href: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    isCurrent: boolean;
  }[];
  userEmail: string | null;
  hasTeam: boolean;
  collapsed: boolean;
}) {
  return (
    <PopoverContent
      side={collapsed ? 'right' : 'bottom'}
      align="start"
      sideOffset={8}
      className="w-72 p-1 rounded-xl border border-border/70"
    >
      <WorkspaceSwitcherRows
        workspaces={workspaces}
        userEmail={userEmail}
        hasTeam={hasTeam}
      />
    </PopoverContent>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// User footer
// ═══════════════════════════════════════════════════════════════════════════════

function UserFooter({
  href,
  displayName,
  imageUrl,
  collapsed = false,
}: {
  href: string;
  displayName: string;
  imageUrl?: string | null;
  collapsed?: boolean;
}) {
  // Quiet user identity pinned to the bottom. Mirrors the sidebar's flat row
  // language (h-9, 13px text, subtle hover, foreground left tint on press)
  // so the chip doesn't read as a different surface.
  if (collapsed) {
    return (
      <div className="p-2 flex justify-center">
        <CollapsedTooltip enabled label={displayName}>
          <Link
            href={href}
            className="group flex items-center justify-center w-9 h-9 rounded-md hover:bg-foreground/[0.025] transition-colors duration-150"
            aria-label={displayName}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt=""
                className="w-7 h-7 rounded-full flex-shrink-0 object-cover ring-1 ring-border/50"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-foreground/[0.06] flex items-center justify-center text-foreground/80 font-semibold text-[11px] flex-shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
          </Link>
        </CollapsedTooltip>
      </div>
    );
  }

  return (
    <div className="p-2">
      <Link
        href={href}
        className="group flex items-center gap-2.5 h-9 pl-1 pr-2.5 rounded-md hover:bg-foreground/[0.025] transition-colors duration-150"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="w-7 h-7 rounded-full flex-shrink-0 object-cover ring-1 ring-border/50"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-foreground/[0.06] flex items-center justify-center text-foreground/80 font-semibold text-[11px] flex-shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate leading-tight">
            {displayName}
          </p>
        </div>
        <ChevronRight
          size={11}
          className="flex-shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors"
        />
      </Link>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ManagerSidebarConversations — slim manager conversation history rendered when
// on the manager Koala page (/manager). Mirrors the rep SidebarConversations
// structure (CHAT HISTORY label + New button + recent list + active rail) but
// calls the manager-scoped conversations API and links into /manager?conversationId=…
// instead of /s/[slug]/axil. Bounded to 6 rows + "See all →" link.
// ═══════════════════════════════════════════════════════════════════════════════

function ManagerSidebarConversations() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = searchParams.get('conversationId');

  const [conversations, setConversations] = useState<
    { id: string; title: string; preview?: string | null; updatedAt: string }[] | null
  >(null);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/manager-conversations');
      if (!res.ok) { setConversations([]); return; }
      const data = await res.json();
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      setConversations([]);
    }
  }, []);

  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

  const handleNew = useCallback(async () => {
    const res = await fetch('/api/ai/manager-conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) return;
    const conv = await res.json();
    setConversations((prev) => (prev ? [conv, ...prev] : [conv]));
    router.push(`/manager?conversationId=${conv.id}`);
  }, [router]);

  const LIMIT = 6;
  const visible = conversations ? conversations.slice(0, LIMIT) : conversations;
  const hasMore = conversations !== null && conversations.length > LIMIT;

  function timeAgo(date: string): string {
    const diff = (Date.now() - new Date(date).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  return (
    <div className="space-y-1">
      <p className={cn(SECTION_LABEL, 'px-3 pt-6 pb-2 select-none')}>
        Chat history
      </p>

      <button
        type="button"
        onClick={() => void handleNew()}
        className="group w-full flex items-center gap-2 h-8 px-2.5 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
      >
        <Plus size={13} strokeWidth={1.75} className="flex-shrink-0" />
        <span className="flex-1 text-left">New conversation</span>
      </button>

      <div className="pt-1">
        {conversations === null ? (
          <div className="space-y-1 px-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 rounded-md bg-foreground/[0.04] animate-pulse" aria-hidden />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="text-xs text-muted-foreground/60 px-3 py-4 leading-snug">
            No chats yet. Say something below.
          </p>
        ) : (
          <ul className="space-y-px">
            {visible!.map((conv) => {
              const isActive = activeId === conv.id;
              return (
                <li key={conv.id} className="relative">
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-foreground"
                    />
                  )}
                  <div
                    className={cn(
                      'group/row flex items-center gap-1 rounded-md transition-colors duration-150',
                      isActive ? 'bg-foreground/[0.045]' : 'hover:bg-foreground/[0.04]',
                    )}
                  >
                    <Link
                      href={`/manager?conversationId=${conv.id}`}
                      className="flex-1 min-w-0 pl-2.5 pr-1 py-1.5"
                    >
                      <p
                        className={cn(
                          'text-[13px] truncate leading-tight',
                          isActive ? 'font-medium text-foreground' : 'text-foreground/80',
                        )}
                        title={conv.title}
                      >
                        {conv.title.length > 24 ? conv.title.slice(0, 23).trimEnd() + '…' : conv.title}
                      </p>
                      {conv.preview ? (
                        <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5 leading-tight">
                          {conv.preview}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground/40 truncate mt-0.5 leading-tight">
                          No messages yet
                        </p>
                      )}
                      <p className="text-[11px] tabular-nums text-muted-foreground/60 leading-tight mt-0.5">
                        {timeAgo(conv.updatedAt)}
                      </p>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <Link
            href="/manager?view=history"
            className="mt-1 flex items-center justify-between gap-1 px-2.5 h-8 rounded-md text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150"
          >
            <span>See all</span>
            <span aria-hidden className="text-muted-foreground/60">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rep nav — 3 sections: AI at top, Workspace in middle, Settings at bottom
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// ─────────────────────────────────────────────────────────────────────────────
// Section groupings — sit BETWEEN the existing nav items as small-caps
// headers. The rep nav is one flat list in `lib/nav-items.ts` (so any
// route addition picks up shared chrome); the groupings are an inline
// rendering concern here. Adding a header means picking which existing items
// belong to which bucket — not a new feature, just a calmer read.
//
// The buckets, top → bottom:
//   • Koala   → no header (top-pinned, AI)
//   • WORKSPACE → daily work (People, Deals, Calendar, Mailbox, Properties, Studio, Files)
//   • SETUP    → once-and-done (Profile, Intake form)
//   • Settings → no header (bottom-pinned)
// ─────────────────────────────────────────────────────────────────────────────

const WORKSPACE_HREFS = new Set<string>([
  '/contacts',
  '/deals',
  '/calendar',
  '/communication',
  '/properties',
  '/studio',
  '/files',
]);
const SETUP_HREFS = new Set<string>([
  '/profile-page',
  '/intake',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Notification slot — reserved space that sits between the scroll area
// (RepNav, including conversation history on /axil) and the pinned
// user footer. The inspiration the rep shared shows a small
// "Update available →" card here; we don't have a real notification feed
// yet, so the slot renders nothing today. Shipping a fake "update card"
// here would be product theatre — Jobs rule: configuration is failure to
// decide, and decorative copy is failure to be honest.
//
// The slot is a function (not a JSX block) so the call site reads as
// `<SidebarNotificationSlot />` and the empty-today contract is visible
// at the render point. When the feed exists, replace `return null` with
// the card render and the layout will absorb it without re-plumbing.
// ─────────────────────────────────────────────────────────────────────────────

function SidebarNotificationSlot({ collapsed = false }: { collapsed?: boolean }) {
  // Rail-mode collapses the slot entirely — no horizontal room for a card
  // and we don't want a half-card hint in the icon strip.
  if (collapsed) return null;
  // v1: no notification feed, so render nothing. Reserved so future work
  // (e.g. "new release notes", "billing nudge") slots in without moving
  // the user footer up/down.
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin console link — platform-admin only. Sits just above the user-footer
// divider, separated by a hairline. Reads as "leave the rep app to the
// internal console" — same nav-row vocabulary (h-9, 13px, subtle hover) but
// tonally quieter than a CTA: muted-foreground at rest, foreground on hover.
// Renders in all three sidebar states: expanded, collapsed rail, and footer.
// ─────────────────────────────────────────────────────────────────────────────

function AdminConsoleLink({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="px-1 pb-1">
        <CollapsedTooltip enabled label="Admin">
          <Link
            href="/admin"
            aria-label="Admin console"
            className={cn(
              'group relative flex items-center justify-center w-9 h-9 mx-auto rounded-md transition-colors duration-150',
              'text-muted-foreground/70 hover:bg-foreground/[0.025] hover:text-foreground',
            )}
          >
            <Shield
              size={15}
              strokeWidth={1.75}
              className="flex-shrink-0 transition-colors text-muted-foreground/55 group-hover:text-foreground"
            />
          </Link>
        </CollapsedTooltip>
      </div>
    );
  }

  return (
    <div className="px-2 py-1">
      <Link
        href="/admin"
        className={cn(
          'group relative flex items-center gap-2.5 h-9 pl-3 pr-2.5 rounded-md text-[13px] transition-colors duration-150',
          'text-muted-foreground/70 hover:bg-foreground/[0.025] hover:text-foreground',
        )}
      >
        <Shield
          size={15}
          strokeWidth={1.75}
          className="flex-shrink-0 transition-colors text-muted-foreground/55 group-hover:text-foreground"
        />
        <span className="flex-1 truncate">Admin</span>
      </Link>
    </div>
  );
}

function RepNav({
  slug,
  base,
  pathname,
  searchParamsString,
  unreadLeadCount,
  overdueFollowUpCount,
  pendingDraftCount,
  activePropertyCount,
}: {
  slug: string;
  base: string;
  pathname: string;
  searchParamsString: string;
  unreadLeadCount: number;
  overdueFollowUpCount: number;
  pendingDraftCount: number;
  activePropertyCount: number;
}) {
  const { collapsed } = useSidebarCollapsed();
  const settingsItem = repNavItems.find((item) => item.href === '/settings')!;

  // Accordion: at most one parent is expanded at a time. The parent that
  // owns the active route auto-expands; if no parent owns it, everyone
  // stays collapsed. Computed from pathname so route changes (incl. soft
  // navigations) keep the open section in sync without a separate effect.
  const findActiveParentKey = (): string | null => {
    for (const item of repNavItems) {
      if (item.children?.length && doesItemOwnPath(item, pathname, base)) {
        return item.href;
      }
    }
    return null;
  };
  const [expandedKey, setExpandedKey] = useState<string | null>(findActiveParentKey);

  useEffect(() => {
    const next = findActiveParentKey();
    // Only auto-set if the route actually maps to a parent. If the user
    // navigates to a leaf that lives outside any parent (e.g. /contacts),
    // leave whatever they last opened alone — closing it on every nav
    // would feel hostile.
    if (next) setExpandedKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, base]);

  // AI-related items always sit at the top
  const aiItems = repNavItems.filter((item) => item.isAI);
  // Workspace bucket — daily work surfaces (gets the WORKSPACE small-caps
  // header above it). Filtered through the canonical repNavItems order
  // so route additions inherit the order without touching this file.
  const workspaceItems = repNavItems.filter(
    (item) => !item.isAI && WORKSPACE_HREFS.has(item.href),
  );
  // Setup bucket — once-and-done surfaces (gets the SETUP small-caps header).
  const setupItems = repNavItems.filter(
    (item) => !item.isAI && SETUP_HREFS.has(item.href),
  );
  // Any leaf the buckets above didn't claim — kept appended (no header) so
  // a new route added to `lib/nav-items.ts` still renders. The set-based
  // filter makes the bucketing additive, not exhaustive.
  const otherItems = repNavItems.filter(
    (item) =>
      !item.isAI &&
      item.href !== '/settings' &&
      !WORKSPACE_HREFS.has(item.href) &&
      !SETUP_HREFS.has(item.href),
  );

  // Route IS the signal for which nav mode this sidebar is in. On
  // /axil/* the main links cross-fade out and the conversation history
  // slides in their place; off Koala, the reverse.
  const onKoala = pathname.startsWith(`/s/${slug}/axil`);

  // Badge vocabulary, two tiers:
  //   • Calm count (leads, properties) — muted pill, rounded-md, small.
  //     Sits to the right of the label like the inspiration's "Messages 16".
  //     `bg-foreground/[0.05]` keeps it inside the paper-flat hairline
  //     vocabulary; no `bg-secondary` blue, no harsh accent.
  //   • Action count (pendingDrafts) — foreground pill, rounded-full.
  //     Reserved for "you owe this" per STYLESHEET §Visual hierarchy —
  //     the only badge that should pull the eye.
  const calmBadgeClasses =
    'inline-flex h-[18px] items-center justify-center rounded-md px-1.5 ' +
    'text-[11px] font-medium tabular-nums flex-shrink-0 ' +
    'bg-foreground/[0.05] text-muted-foreground';
  const loudBadgeClasses =
    'inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center ' +
    'rounded-full text-[11px] font-semibold tabular-nums flex-shrink-0 ' +
    'bg-primary text-primary-foreground';

  const getBadge = (item: NavItem): React.ReactNode => {
    if (item.badgeKey === 'leads' && unreadLeadCount > 0) {
      return (
        <span className={calmBadgeClasses}>
          <PulseNumber value={unreadLeadCount > 99 ? '99+' : unreadLeadCount} />
        </span>
      );
    }
    if (item.badgeKey === 'pendingDrafts' && pendingDraftCount > 0) {
      return (
        <span className={loudBadgeClasses}>
          <PulseNumber value={pendingDraftCount > 99 ? '99+' : pendingDraftCount} />
        </span>
      );
    }
    if (item.badgeKey === 'properties' && activePropertyCount > 0) {
      return (
        <span className={calmBadgeClasses}>
          <PulseNumber value={activePropertyCount > 99 ? '99+' : activePropertyCount} />
        </span>
      );
    }
    return undefined;
  };

  const getBadgeText = (item: NavItem): string | undefined => {
    if (item.badgeKey === 'leads' && unreadLeadCount > 0) {
      return unreadLeadCount > 99 ? '99+' : String(unreadLeadCount);
    }
    if (item.badgeKey === 'pendingDrafts' && pendingDraftCount > 0) {
      return pendingDraftCount > 99 ? '99+' : String(pendingDraftCount);
    }
    if (item.badgeKey === 'properties' && activePropertyCount > 0) {
      return activePropertyCount > 99 ? '99+' : String(activePropertyCount);
    }
    return undefined;
  };

  // Accordion handler: opening any parent closes the previously-open one.
  // The shared SidebarNavItem fires onToggle when the user taps the chevron;
  // we own the single source of expansion state here, so the contract is
  // naturally "one open at a time" without per-item bookkeeping.
  const handleToggle = (key: string) => () =>
    setExpandedKey((prev) => (prev === key ? null : key));

  const renderItem = (item: NavItem) => {
    const hasChildren = !!(item.children && item.children.length > 0);
    return (
      <SidebarNavItem
        key={item.href}
        item={item}
        base={base}
        isActive={doesItemOwnPath(item, pathname, base)}
        isExpanded={hasChildren && expandedKey === item.href}
        isChildActive={(child) => isChildActive(child, pathname, base, searchParamsString)}
        onToggle={handleToggle(item.href)}
        badge={getBadge(item)}
        badgeText={getBadgeText(item)}
        collapsed={collapsed}
      />
    );
  };

  return (
    <nav
      className={cn(
        'flex-1 py-2 overflow-y-auto space-y-3',
        collapsed ? 'px-1' : 'px-3',
      )}
    >
      {/* Two-mode sidebar: on /axil the conversation history slides in
          below the main nav. The main destinations (People, Deals,
          Calendar…) stay visible the whole time — the rep must always
          have a door out of Koala, not just a door in. The Koala nav
          item itself stays pinned at the top regardless so the door in is
          always there too. Settings stays pinned at the bottom.

          The visual polish pass (PR: sidebar-jobs-polish) introduced two
          small-caps headers — WORKSPACE above the daily-work rows, SETUP
          above the once-and-done rows — to give a 7-row flat list a
          calmer read without changing what's in it. `lib/nav-items.ts`
          stays the canonical order; the headers are an inline rendering
          choice here. In collapsed-rail mode the labels disappear (no
          horizontal room) and the rows render flush. */}
      <div className="space-y-0.5">
        {/* Always visible — top-pinned AI items (Koala + future AI rows).
            No header above this bucket: Koala is the brand mark; it
            doesn't need a category to belong to. */}
        {aiItems.map(renderItem)}

        {/* RECORDS — daily work surfaces (the rep's book of business:
            People, Deals, Properties, etc.). Labeled to match the
            inspiration's "Records" group above the existing workspace nav
            items — no restructuring of `lib/nav-items.ts`, just a calmer
            small-caps header above the same routes. Hidden in collapsed
            rail mode (no horizontal room). */}
        {workspaceItems.length > 0 && (
          <>
            {!collapsed && (
              <p className={cn(SECTION_LABEL, 'px-3 pt-4 pb-1.5 select-none')}>
                Records
              </p>
            )}
            {workspaceItems.map(renderItem)}
          </>
        )}

        {/* SETUP — once-and-done surfaces (Profile, Intake form). Same
            collapse rule as WORKSPACE. */}
        {setupItems.length > 0 && (
          <>
            {!collapsed && (
              <p className={cn(SECTION_LABEL, 'px-3 pt-4 pb-1.5 select-none')}>
                Setup
              </p>
            )}
            {setupItems.map(renderItem)}
          </>
        )}

        {/* Anything the buckets above didn't claim — appended without a
            header so a new `lib/nav-items.ts` route stays renderable
            without forcing an edit to this file. */}
        {otherItems.map(renderItem)}
      </div>

      {/* Context-aware second section. Route IS the signal:
            - On /axil/* → CHAT HISTORY label + recent conversation list
              (expanded) or History icon link (collapsed rail). Bounded to
              6 conversations + "See all →" link into the existing in-chat
              history drawer. Animates in/out with the app's standard
              [0.22, 1, 0.36, 1] curve.
            - Elsewhere → render `repMoreNavItems` if it has anything.
              It's intentionally empty today, but kept as the slot for
              future secondary nav without re-plumbing the layout. */}
      <AnimatePresence initial={false} mode="wait">
        {onKoala && (
          <motion.div
            key="koala-history"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
          >
            {collapsed ? (
              <>
                <div className="my-2 mx-2 h-px bg-border/60" aria-hidden />
                <CollapsedTooltip enabled label="Conversations">
                  <Link
                    href={`/s/${slug}/axil?view=history`}
                    aria-label="Conversation history"
                    className="group relative flex items-center justify-center w-10 h-10 mx-auto rounded-md text-foreground/65 hover:bg-foreground/[0.025] hover:text-foreground transition-colors duration-150"
                  >
                    <History size={15} strokeWidth={1.75} />
                  </Link>
                </CollapsedTooltip>
              </>
            ) : (
              <>
                {/* Hairline divider — the only thing separating primary
                    nav from chat history. No card, no shadow. */}
                <div className="mx-3 mt-1 mb-2 h-px bg-border/60" aria-hidden />
                <SidebarConversations slug={slug} limit={6} />
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* repMoreNavItems — the secondary slot for non-Koala pages.
          Empty today; kept so future additions don't require a layout
          replumb. Only renders when the array has items AND we're not on
          Koala (the Koala state owns this region). */}
      {repMoreNavItems.length > 0 && !onKoala && (
        <div>
          <div className="space-y-0.5">{repMoreNavItems.map(renderItem)}</div>
        </div>
      )}

      {/* Settings — pinned at bottom of scroll area. No children today; the
          shared row handles the no-children case as a plain link with no
          chevron, so this stays in lockstep with the rest of the nav. */}
      <div className="pt-1">
        <SidebarNavItem
          item={settingsItem}
          base={base}
          isActive={doesItemOwnPath(settingsItem, pathname, base)}
          isExpanded={false}
          isChildActive={(child) => isChildActive(child, pathname, base, searchParamsString)}
          onToggle={handleToggle(settingsItem.href)}
          collapsed={collapsed}
        />
      </div>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Sidebar export
// ═══════════════════════════════════════════════════════════════════════════════

export function Sidebar({
  slug,
  spaceName,
  unreadLeadCount,
  pendingDraftCount = 0,
  overdueFollowUpCount = 0,
  activePropertyCount = 0,
  isManager = false,
  isManagerOnly = false,
  teamName = null,
  teamRole = null,
  teamMemberships = [],
  isPlatformAdmin = false,
}: SidebarProps) {
  const pathname = usePathname();
  // Read search params and keep in sync with URL changes
  const [searchParamsString, setSearchParamsString] = useState('');
  useEffect(() => {
    const updateParams = () => {
      setSearchParamsString(window.location.search.replace('?', ''));
    };
    updateParams();
    // Listen for popstate (back/forward) and custom pushState/replaceState
    window.addEventListener('popstate', updateParams);
    // Poll briefly to catch Next.js soft navigations that change query params
    const interval = setInterval(updateParams, 300);
    return () => {
      window.removeEventListener('popstate', updateParams);
      clearInterval(interval);
    };
  }, [pathname]);
  const base = `/s/${slug}`;
  const { user } = useUser();
  // Shared collapse state (provided by the layout). The manager branch below
  // uses it to rail like the rep sidebar; the header panel toggle drives it.
  const { collapsed: managerCollapsed, toggle: managerToggle } = useSidebarCollapsed();

  // Manager nav accordion — one parent expanded at a time, same contract as
  // RepNav. Declared here (not inside the manager branch) because that
  // branch returns early and hooks must not live after a conditional return.
  // base is "" for the manager nav (its hrefs are already absolute, e.g.
  // /manager/leads), so doesItemOwnPath is called with base "" below.
  const managerSections =
    teamRole === 'rep_member'
      ? managerMemberNavSections
      : managerAdminNavSections;
  const findManagerActiveParentKey = (): string | null => {
    for (const section of managerSections) {
      for (const item of section.items) {
        if (item.children?.length && doesItemOwnPath(item, pathname, '')) {
          return item.href;
        }
      }
    }
    return null;
  };
  const [managerExpandedKey, setManagerExpandedKey] = useState<string | null>(
    findManagerActiveParentKey,
  );
  useEffect(() => {
    const next = findManagerActiveParentKey();
    // Same as RepNav: only auto-open when the route maps to a parent.
    // Navigating to a leaf outside any parent leaves the user's last-opened
    // section alone rather than collapsing it on every navigation.
    if (next) setManagerExpandedKey(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, teamRole]);
  const handleManagerToggle = (key: string) => () =>
    setManagerExpandedKey((prev) => (prev === key ? null : key));

  // Admin console link visibility. The server passes isPlatformAdmin from the
  // DB platformRole; we OR it with the Clerk publicMetadata.role so an admin
  // set via the Clerk Dashboard (before the DB role propagates) still sees the
  // link. Rendered in every shell — rep AND manager — because a platform
  // admin is often also a manager/owner and would otherwise never see it.
  const showAdminLink =
    isPlatformAdmin ||
    (user?.publicMetadata as { role?: string } | undefined)?.role === 'admin';

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ') || 'My Account'
    : 'My Account';
  // Primary email — used as the muted subtitle in the user footer chip.
  const userEmail = user?.primaryEmailAddress?.emailAddress ?? null;

  const isOnManagerPage = pathname.startsWith('/manager');
  const isOnManagerSettings = pathname.startsWith('/manager/settings');

  // ── Manager settings sub-nav ──────────────────────────────────────────────
  if (isManager && (isOnManagerPage || isManagerOnly) && isOnManagerSettings) {
    return (
      <aside data-dashboard-sidebar className={cn('hidden md:flex flex-col bg-sidebar border border-border/70 rounded-xl overflow-hidden shrink-0 m-3', SIDEBAR_WIDTH)}>
        <div className="px-4 pt-5 pb-3">
          <BrandLogo className="h-5" alt="Koala" />
        </div>

        <div className="px-3 pb-1">
          <Link
            href="/manager"
            className="group flex items-center gap-2 h-9 px-2.5 rounded-md text-[13px] font-medium transition-colors duration-150 text-muted-foreground hover:bg-foreground/[0.025] hover:text-foreground"
          >
            <ArrowLeft size={13} strokeWidth={1.75} className="flex-shrink-0" />
            <span>Back to team</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 pb-2 space-y-0.5 overflow-y-auto">
          {managerSettingsNavSections.map((section) => (
            <div key={section.label}>
              <SectionLabel>{section.label}</SectionLabel>
              {section.items.map((item) => {
                const isActive = item.exact
                  ? pathname === item.href
                  : pathname.startsWith(item.href);
                return (
                  <FlatNavItem
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    isActive={isActive}
                  />
                );
              })}
            </div>
          ))}
        </nav>

        {showAdminLink && (
          <>
            <div className="border-t border-border/60" />
            <AdminConsoleLink />
          </>
        )}
        {/* What's New + user menu chip — same footer slot as the rep and
            the main manager sidebar. Settings sub-nav is still an in-app
            screen, not a separate product, so the same update card and
            user menu belong here. */}
        <SidebarWhatsNew />
        <div className="border-t border-border/50" />
        <SidebarUserMenu
          slug={slug}
          displayName={displayName}
          email={userEmail}
          imageUrl={user?.imageUrl}
        />
      </aside>
    );
  }

  // ── Manager sidebar ───────────────────────────────────────────────────────
  if (isManager && (isOnManagerPage || isManagerOnly)) {
    return (
      <aside data-dashboard-sidebar className={cn('group/rail relative hidden md:flex flex-col bg-sidebar border border-border/70 rounded-xl shrink-0 overflow-hidden transition-[width] duration-200 ease-out m-3', managerCollapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH)}>
        {/* Same brand-warm tint as the rep sidebar so managers see the
            same identity when they switch workspaces. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-32 rounded-t-xl bg-gradient-to-b from-orange-50/60 via-orange-50/20 to-transparent dark:from-orange-500/[0.04] dark:via-transparent"
        />
        <div className="relative z-10 flex flex-col h-full">
          {/* Brand mark — in collapsed rail mode it doubles as the expand
              affordance, mirroring the rep sidebar. */}
          <div className={cn('pt-5 pb-3', managerCollapsed ? 'flex justify-center px-2' : 'flex items-center justify-between px-4')}>
            {managerCollapsed ? (
              <button
                type="button"
                onClick={managerToggle}
                aria-label="Expand sidebar"
                title="Expand sidebar"
                className="flex items-center justify-center w-10 h-10 rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <PanelLeftOpen size={18} strokeWidth={1.75} />
              </button>
            ) : (
              <>
                <BrandLogo className="h-5" alt="Koala" />
                <button
                  type="button"
                  onClick={managerToggle}
                  aria-label="Collapse sidebar"
                  title="Collapse sidebar"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  <PanelLeftClose size={16} strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>

          <WorkspaceSwitcher
            currentName={teamName ?? 'Team'}
            currentSubtitle="Team"
            currentIcon={Building2}
            slug={slug}
            spaceName={spaceName}
            teamMemberships={teamMemberships}
            isOnManagerPage={isOnManagerPage}
            collapsed={managerCollapsed}
            userEmail={userEmail}
          />

          <div className="mt-3">
            <SearchPill collapsed={managerCollapsed} />
          </div>

          {/* Manager primary nav — same structural vocabulary as RepNav:
              py-2 vertical breathing, space-y-3 between section groups,
              overflow-y-auto so deep section lists don't push the footer off. */}
          <nav className="flex-1 px-3 py-2 mt-1 space-y-3 overflow-y-auto">
            <div className="space-y-0.5">
              {managerSections.map((section) => {
                const visibleItems = section.items.filter(
                  (item) =>
                    !item.adminOnly ||
                    teamRole === 'manager_owner' ||
                    teamRole === 'manager_admin',
                );
                if (visibleItems.length === 0) return null;
                return (
                  <div key={section.label}>
                    {!managerCollapsed && <SectionLabel>{section.label}</SectionLabel>}
                    {visibleItems.map((item) => {
                      const isActive = doesItemOwnPath(item, pathname, '');
                      const hasChildren = !!(item.children && item.children.length > 0);
                      const highlightBadge =
                        'highlight' in item &&
                        (item as any).highlight &&
                        !isActive ? (
                          <span className="inline-flex h-2 w-2 rounded-full bg-lead-hot shrink-0" />
                        ) : undefined;
                      // Manager hrefs are already absolute, so base="". The
                      // shared accordion row handles the chip-avatar (isAI),
                      // chevron dropdown, indented children and active-child
                      // highlight — identical to the rep sidebar.
                      return (
                        <SidebarNavItem
                          key={item.href}
                          item={item}
                          base=""
                          collapsed={managerCollapsed}
                          isActive={isActive}
                          isExpanded={hasChildren && managerExpandedKey === item.href}
                          isChildActive={(child) =>
                            isChildActive(child, pathname, '', searchParamsString)
                          }
                          onToggle={handleManagerToggle(item.href)}
                          badge={highlightBadge}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Conversation history — mirrors the rep sidebar's contextual
                section. Slides in when on the manager Koala page (/manager exact),
                same AnimatePresence pattern. Shows manager conversations via the
                manager-scoped conversations API. Hidden in collapsed rail mode —
                there's no room for a conversation list at 56px. */}
            <AnimatePresence initial={false} mode="wait">
              {!managerCollapsed && pathname === '/manager' && (
                <motion.div
                  key="manager-koala-history"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                >
                  {/* Hairline divider — same as rep sidebar (mx-3 to match) */}
                  <div className="mx-3 mt-1 mb-2 h-px bg-border/60" aria-hidden />
                  <ManagerSidebarConversations />
                </motion.div>
              )}
            </AnimatePresence>
          </nav>

          {/* What's New card — same slot as the rep sidebar. Manager users
              see the same release notes. Collapses to an icon in rail mode,
              matching the rep shell. */}
          <SidebarWhatsNew collapsed={managerCollapsed} />

          {showAdminLink && (
            <>
              <div className="border-t border-border/60" />
              <AdminConsoleLink />
            </>
          )}
          {/* User footer — matches the rep's SidebarUserMenu chip (avatar +
              name + email + popover with themes/settings/logout). The old
              UserFooter was a plain link with no popover — swapped for parity. */}
          <div className="border-t border-border/50" />
          <SidebarUserMenu
            slug={slug}
            displayName={displayName}
            email={userEmail}
            imageUrl={user?.imageUrl}
            collapsed={managerCollapsed}
          />
        </div>
      </aside>
    );
  }

  // ── Rep workspace sidebar ────────────────────────────────────────────
  // The SidebarCollapseProvider now lives in the layout (wrapping both this
  // sidebar and the header), so the header's panel toggle and the sidebar
  // share one collapse state.
  return (
    <RepSidebarShell
      slug={slug}
      spaceName={spaceName}
      base={base}
      pathname={pathname}
      searchParamsString={searchParamsString}
      unreadLeadCount={unreadLeadCount}
      overdueFollowUpCount={overdueFollowUpCount}
      pendingDraftCount={pendingDraftCount}
      activePropertyCount={activePropertyCount}
      teamMemberships={teamMemberships}
      isOnManagerPage={isOnManagerPage}
      displayName={displayName}
      imageUrl={user?.imageUrl}
      email={userEmail}
      isPlatformAdmin={showAdminLink}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Rep sidebar shell — consumes the collapse context so all subcomponents
// can react to width changes via `useSidebarCollapsed()`. The aside container
// transitions width only on user-toggle (not on initial hydration).
// ═══════════════════════════════════════════════════════════════════════════════

function RepSidebarShell({
  slug,
  spaceName,
  base,
  pathname,
  searchParamsString,
  unreadLeadCount,
  overdueFollowUpCount,
  pendingDraftCount,
  activePropertyCount,
  teamMemberships,
  isOnManagerPage,
  displayName,
  imageUrl,
  email,
  isPlatformAdmin = false,
}: {
  slug: string;
  spaceName: string;
  base: string;
  pathname: string;
  searchParamsString: string;
  unreadLeadCount: number;
  overdueFollowUpCount: number;
  pendingDraftCount: number;
  activePropertyCount: number;
  teamMemberships: { id: string; name: string; role: string }[];
  isOnManagerPage: boolean;
  displayName: string;
  imageUrl?: string | null;
  email?: string | null;
  isPlatformAdmin?: boolean;
}) {
  const { collapsed, toggle } = useSidebarCollapsed();

  return (
    <aside
      data-dashboard-sidebar
      className={cn(
        'group/rail relative hidden md:flex flex-col bg-sidebar border border-border/70 rounded-xl shrink-0 m-3',
        'transition-[width] duration-200 ease-in-out',
        collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH,
      )}
    >
      {/* Brand-warm tint at top — clip width follows the rail so the orange
          wash doesn't hint at content beyond the visible edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 rounded-t-xl bg-gradient-to-b from-orange-50/60 via-orange-50/20 to-transparent dark:from-orange-500/[0.04] dark:via-transparent"
      />

      <div className="relative z-10 flex flex-col h-full">
        {/* Brand mark — small, monochrome, sets identity without dominating.
            Expanded: the logo sits at the left with a panel-collapse button
            on the right. Collapsed: the logo gives way to an open-panel icon
            that expands the rail. */}
        <div
          className={cn(
            'pt-5 pb-3',
            collapsed ? 'flex justify-center px-2' : 'flex items-center justify-between px-4',
          )}
        >
          {collapsed ? (
            <button
              type="button"
              onClick={toggle}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="flex items-center justify-center w-10 h-10 rounded-md text-muted-foreground/80 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <PanelLeftOpen size={18} strokeWidth={1.75} />
            </button>
          ) : (
            <>
              <BrandLogo className="h-5" alt="Koala" />
              <button
                type="button"
                onClick={toggle}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground/70 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              >
                <PanelLeftClose size={16} strokeWidth={1.75} />
              </button>
            </>
          )}
        </div>

        {/* Workspace identity (with switcher when there's somewhere to go).
            The SquarePen quick-create button sits inline on the right when
            the sidebar is expanded — a small dropdown of "new contact / new
            deal / new property" shortcuts. Hidden in collapsed rail mode
            because the row is the workspace identity at that width. */}
        <WorkspaceSwitcher
          currentName={spaceName}
          currentSubtitle="Solo rep"
          currentIcon={Briefcase}
          slug={slug}
          spaceName={spaceName}
          // The rep sidebar stays a rep surface — no team rows
          // here. Switching to the team lives on the header ("Switch to
          // {team}") so the workspace identity here reads clean.
          teamMemberships={[]}
          isOnManagerPage={isOnManagerPage}
          collapsed={collapsed}
          showQuickCreate
          userEmail={email}
        />

        {/* Search */}
        <div className="mt-3">
          <SearchPill collapsed={collapsed} />
        </div>

        {/* Primary nav + More + Settings */}
        <RepNav
          slug={slug}
          base={base}
          pathname={pathname}
          searchParamsString={searchParamsString}
          unreadLeadCount={unreadLeadCount}
          overdueFollowUpCount={overdueFollowUpCount}
          pendingDraftCount={pendingDraftCount}
          activePropertyCount={activePropertyCount}
        />

        {/* Notification card slot — reserved space the inspiration the
            rep sent shows as an "Update available →" card. We don't
            have a notification feed yet; the slot returns null today so
            the layout doesn't shift when it's added later. */}
        <SidebarNotificationSlot collapsed={collapsed} />

        {/* What's new card — small paper-flat update card pinned just above
            the user footer. Dismissed state lives in localStorage with a
            `v1` suffix so future bumps re-show. Hidden entirely in
            collapsed rail mode (no horizontal room). */}
        <SidebarWhatsNew collapsed={collapsed} />

        {/* Platform-admin console link — only rendered for isPlatformAdmin
            accounts. Separated from the user footer by a hairline so it
            reads as "this exits the rep app." Calm; no CTA weight. */}
        {isPlatformAdmin && (
          <>
            <div className="border-t border-border/60" />
            <AdminConsoleLink collapsed={collapsed} />
          </>
        )}

        {/* User footer pinned at bottom, separated by a hairline. The chip
            opens an account-menu popover (Themes, Settings, Notifications,
            Hotkeys, Apps, Referrals, Plans, Help, Trash, Log out). The
            collapse toggle is the panel button in the header. */}
        <div className="border-t border-border/50" />
        <SidebarUserMenu
          slug={slug}
          displayName={displayName}
          email={email}
          imageUrl={imageUrl}
          collapsed={collapsed}
        />
      </div>
    </aside>
  );
}
