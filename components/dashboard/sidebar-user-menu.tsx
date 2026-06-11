'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useClerk } from '@clerk/nextjs';
import {
  MoreHorizontal,
  Sun,
  Moon,
  Settings,
  Bell,
  Gift,
  CreditCard,
  LifeBuoy,
  LogOut,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useTheme } from '@/components/theme-provider';

// ─────────────────────────────────────────────────────────────────────────────
// SidebarUserMenu — the realtor's footer chip + popover. Avatar + online dot
// + name + email, with a MoreHorizontal trigger that opens a menu of account
// actions. The trigger is the WHOLE chip on the avatar+name region; the ⋯ is
// purely a visual hint. Tapping anywhere on the chip opens the menu.
//
// Every row is wired to something real — no dead stubs. Themes → toggleTheme(),
// Settings → /settings, Notifications → /settings?tab=notifications,
// Affiliate → /affiliate (the referral program), Plans → /billing,
// Help → /support (the in-app support-ticket center), Log out → Clerk signOut.
// ─────────────────────────────────────────────────────────────────────────────

interface SidebarUserMenuProps {
  slug: string;
  displayName: string;
  email?: string | null;
  imageUrl?: string | null;
  collapsed?: boolean;
  /**
   * When rendered inside the mobile drawer Sheet, the Radix Popover portal
   * lands as a sibling of the Sheet's modal — and the modal sets
   * `pointer-events: none` on siblings, so the popover content is unclickable.
   * In drawer mode we skip the Popover entirely and expand the menu inline
   * below the chip. Same row vocabulary, just no portal.
   */
  inDrawer?: boolean;
}

interface MenuRow {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  kbd?: string;
  rightIcon?: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  rightLabel?: string;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  destructive?: boolean;
  /** Visually separates the next row group. */
  divider?: boolean;
}

export function SidebarUserMenu({
  slug,
  displayName,
  email,
  imageUrl,
  collapsed = false,
  inDrawer = false,
}: SidebarUserMenuProps) {
  const { signOut } = useClerk();
  const { theme, toggleTheme } = useTheme();
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const base = `/s/${slug}`;

  const handleSignOut = () => {
    void signOut({ redirectUrl: '/login/realtor' });
  };

  const rows: MenuRow[] = [
    {
      label: 'Themes',
      icon: theme === 'dark' ? Sun : Moon,
      kbd: '⌘T',
      onClick: toggleTheme,
    },
    {
      label: 'Settings',
      icon: Settings,
      kbd: '⌘S',
      href: `${base}/settings`,
    },
    {
      label: 'Notifications',
      icon: Bell,
      kbd: '⌘N',
      href: `${base}/settings?tab=notifications`,
      divider: true,
    },
    {
      label: 'Affiliate',
      icon: Gift,
      rightLabel: 'New',
      href: `${base}/affiliate`,
    },
    {
      label: 'Plans',
      icon: CreditCard,
      rightIcon: ChevronRight,
      href: `${base}/billing`,
      divider: true,
    },
    {
      label: 'Help',
      icon: LifeBuoy,
      rightIcon: ChevronRight,
      href: `${base}/support`,
      divider: true,
    },
    {
      label: 'Log out',
      icon: LogOut,
      onClick: handleSignOut,
      destructive: true,
    },
  ];

  const avatarBlock = (
    <div className="relative flex-shrink-0">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          className="w-8 h-8 rounded-full object-cover ring-1 ring-border/60"
        />
      ) : (
        <div className="w-8 h-8 rounded-full bg-foreground/[0.06] flex items-center justify-center text-foreground/80 font-semibold text-[12px] ring-1 ring-border/60">
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-background"
      />
    </div>
  );

  if (inDrawer) {
    // Inline-expand mode for the mobile drawer. The chip toggles a list of
    // rows directly underneath — no Portal, no Sheet-modal collision.
    return (
      <div className="p-2">
        <button
          type="button"
          onClick={() => setDrawerExpanded((v) => !v)}
          aria-expanded={drawerExpanded}
          className="group w-full flex items-center gap-2.5 h-12 pl-1.5 pr-2 rounded-md hover:bg-foreground/[0.04] transition-colors duration-150 text-left"
        >
          {avatarBlock}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-foreground truncate leading-tight">
              {displayName}
            </p>
            {email && (
              <p className="text-[11px] text-muted-foreground/80 truncate leading-tight mt-0.5">
                {email}
              </p>
            )}
          </div>
          <ChevronDown
            size={14}
            strokeWidth={1.75}
            className={cn(
              'flex-shrink-0 text-muted-foreground/60 transition-transform duration-200',
              drawerExpanded && 'rotate-180',
            )}
          />
        </button>
        {drawerExpanded && (
          <div className="mt-1 pt-1 border-t border-border/40 space-y-0.5">
            {rows.map((row) => {
              const node = renderRow(row);
              if (row.divider) {
                return (
                  <div key={`${row.label}-div`}>
                    {node}
                    <div className="my-1 mx-1 h-px bg-border/50" />
                  </div>
                );
              }
              return node;
            })}
          </div>
        )}
      </div>
    );
  }

  if (collapsed) {
    // Rail mode — single avatar opens the user menu popover. The browser-
    // native `title` provides hover text instead of stacking a Radix Tooltip
    // inside the PopoverTrigger (which fights with `asChild` slot semantics).
    return (
      <div className="p-2 flex justify-center">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={displayName}
              aria-label={`${displayName} account menu`}
              className="group flex items-center justify-center w-10 h-10 rounded-md hover:bg-foreground/[0.04] transition-colors duration-150"
            >
              {avatarBlock}
            </button>
          </PopoverTrigger>
          <UserMenuPopoverContent rows={rows} side="right" align="end" />
        </Popover>
      </div>
    );
  }

  return (
    <div className="p-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="group w-full flex items-center gap-2.5 h-12 pl-1.5 pr-2 rounded-md hover:bg-foreground/[0.04] transition-colors duration-150 text-left"
          >
            {avatarBlock}
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate leading-tight">
                {displayName}
              </p>
              {email && (
                <p className="text-[11px] text-muted-foreground/80 truncate leading-tight mt-0.5">
                  {email}
                </p>
              )}
            </div>
            <MoreHorizontal
              size={14}
              strokeWidth={1.75}
              className="flex-shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors"
            />
          </button>
        </PopoverTrigger>
        <UserMenuPopoverContent rows={rows} side="top" align="start" />
      </Popover>
    </div>
  );
}

function renderRow(row: MenuRow): React.ReactNode {
  const Icon = row.icon;
  const RightIcon = row.rightIcon;

  const inner = (
    <>
      <Icon
        size={13}
        strokeWidth={1.75}
        className={cn(
          'flex-shrink-0',
          row.destructive ? 'text-foreground/70' : 'text-foreground/55',
        )}
      />
      <span className="flex-1 text-left truncate">{row.label}</span>
      {row.kbd && (
        <kbd className="text-[10px] tabular-nums bg-foreground/[0.04] text-muted-foreground px-1.5 py-0.5 rounded font-mono">
          {row.kbd}
        </kbd>
      )}
      {row.rightLabel && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-foreground/[0.04] rounded px-1.5 py-0.5">
          {row.rightLabel}
        </span>
      )}
      {RightIcon && (
        <RightIcon size={11} strokeWidth={1.75} className="flex-shrink-0 text-muted-foreground/50" />
      )}
    </>
  );

  const classes = cn(
    'flex items-center gap-2 h-8 px-2 rounded-md text-[12px] transition-colors duration-150',
    row.destructive
      ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-500/10'
      : 'text-foreground/85 hover:bg-foreground/[0.05] hover:text-foreground',
  );

  if (row.href) {
    if (row.external) {
      return (
        <a
          key={row.label}
          href={row.href}
          target="_blank"
          rel="noopener noreferrer"
          className={classes}
        >
          {inner}
        </a>
      );
    }
    return (
      <Link key={row.label} href={row.href} className={classes}>
        {inner}
      </Link>
    );
  }
  return (
    <button key={row.label} type="button" onClick={row.onClick} className={cn(classes, 'w-full text-left')}>
      {inner}
    </button>
  );
}

function UserMenuPopoverContent({
  rows,
  side,
  align,
}: {
  rows: MenuRow[];
  side: 'top' | 'right';
  align: 'start' | 'end';
}) {
  return (
    <PopoverContent
      side={side}
      align={align}
      sideOffset={8}
      className="w-64 p-1 rounded-xl border border-border/70"
    >
      {rows.map((row) => {
        const node = renderRow(row);
        if (row.divider) {
          return (
            <div key={`${row.label}-div`}>
              {node}
              <div className="my-1 mx-1 h-px bg-border/60" />
            </div>
          );
        }
        return node;
      })}
    </PopoverContent>
  );
}
