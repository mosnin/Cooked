import {
  Users,
  UserCircle,
  Briefcase,
  MessageCircle,
  Inbox,
  Settings,
  Calendar,
  ClipboardList,
  Building2,
  FolderOpen,
  Aperture,
  Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NavChild {
  href: string;
  label: string;
  exact?: boolean;
}

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  /** Sub-items that expand inline */
  children?: NavChild[];
  /** Show as AI assistant item with chip avatar */
  isAI?: boolean;
  /** Badge key for dynamic counts (e.g. 'leads', 'followUps') */
  badgeKey?: string;
}

// ── Rep sidebar nav ──────────────────────────────────────────────────────
//
// Koala is the home — the chat surface IS the OS. The Koala entry expands
// into the agent's sub-surfaces (Full day, Drafts, Activity, Memory,
// Integrations), so the chat root stays a clean chat-first hero and the
// rep reaches the dashboards via the dropdown rather than scrolling
// past them every time they want to talk to Koala.
//
// Everything else in the sidebar is the rep-facing substrate they still
// expect from a CRM: People, Deals, Practice, Calendar, Products, Intake.

export const repNavItems: NavItem[] = [
  {
    href: '/axil',
    label: 'Koala',
    icon: MessageCircle,
    isAI: true,
    badgeKey: 'pendingDrafts',
    children: [
      { href: '/axil/brief', label: 'Brief' },
      { href: '/axil/inbox', label: 'Inbox' },
      { href: '/axil/history', label: 'History' },
    ],
  },
  {
    href: '/contacts',
    label: 'People',
    icon: Users,
    badgeKey: 'leads',
    children: [
      { href: '/sync', label: 'Smart sync' },
    ],
  },
  {
    href: '/deals',
    label: 'Deals',
    icon: Briefcase,
  },
  {
    href: '/practice',
    label: 'Practice',
    icon: Target,
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: Calendar,
  },
  {
    href: '/communication',
    label: 'Mailbox',
    icon: Inbox,
  },
  {
    href: '/properties',
    label: 'Products',
    icon: Building2,
    badgeKey: 'properties',
    children: [
      { href: '/properties/new', label: 'Add product' },
      { href: '/properties/commissions', label: 'Commissions' },
      { href: '/cma', label: 'Pricing analysis' },
    ],
  },
  {
    href: '/studio',
    label: 'Studio',
    icon: Aperture,
    children: [
      { href: '/studio/create', label: 'Create' },
      { href: '/studio/edit', label: 'Edit' },
      { href: '/studio/compose', label: 'Compose' },
      { href: '/studio/schedule', label: 'Schedule' },
      { href: '/studio/library', label: 'Library' },
      { href: '/studio/brand', label: 'Brand' },
    ],
  },
  {
    href: '/files',
    label: 'Files',
    icon: FolderOpen,
    children: [
      { href: '/documents', label: 'Documents' },
    ],
  },
  {
    href: '/profile-page',
    label: 'Profile',
    icon: UserCircle,
  },
  {
    href: '/intake',
    label: 'Intake form',
    icon: ClipboardList,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
  },
];

/**
 * Secondary "More" section — intentionally empty. The sidebar checks
 * `repMoreNavItems.length > 0` and hides the section when it is.
 *
 * Routes that used to live here are reachable two ways:
 *   - Settings → Integrations (was: /integrations)
 *   - Settings → Koala → Build your own agents (was: /agents)
 *   - Per-surface stats tabs (was: /analytics)
 * Anything else is reachable by direct URL but doesn't earn nav weight.
 */
export const repMoreNavItems: NavItem[] = [];

// ── Header right-side menu ───────────────────────────────────────────────────
//
// Intentionally empty. Settings already lives in `repNavItems` as a
// primary nav row; surfacing it again in a separate "Account" section in
// the mobile drawer was a duplicate. Kept as an extension point — add
// Billing, Profile, or other account-level routes here when they earn it.
export const secondaryNavItems: { href: string; label: string; icon: LucideIcon }[] = [];

/** Primary items with shorter labels for the mobile bottom bar. */
export const mobileNavItems = [
  { href: '/axil', label: 'Koala', icon: MessageCircle },
  { href: '/contacts', label: 'People', icon: Users },
  { href: '/deals', label: 'Deals', icon: Briefcase },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;
