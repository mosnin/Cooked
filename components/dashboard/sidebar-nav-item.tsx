'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavChild, NavItem } from '@/lib/nav-items';
import { CollapsedTooltip } from '@/components/dashboard/sidebar-collapse';

// ─────────────────────────────────────────────────────────────────────────────
// Shared sidebar nav item — used by both the desktop sidebar AND the mobile
// drawer so the accordion behaviour, motion params, and visual language are
// identical across viewports. State is owned by the caller (parent renders
// pass `isExpanded` + `onToggle`) so accordion behaviour (one parent
// expanded at a time) is naturally enforced without per-item bookkeeping.
//
// Behaviour contract:
//   - Parents WITH children: the row's label + icon link to the parent
//     route (Chippi → /chippi, Properties → /properties); a separate
//     chevron button at the right edge toggles expansion. Tap the label
//     to navigate (auto-expands on first navigate). Tap the chevron to
//     collapse without leaving the page.
//   - Parents WITHOUT children navigate to `item.href` on tap. No chevron.
//   - Children animate in/out with height + opacity, standard app easing
//     (220–260ms, [0.22, 1, 0.36, 1]).
//   - Rail/collapsed mode (desktop only): icon-only Link to the parent
//     route, no children rendered (no horizontal room).
// ─────────────────────────────────────────────────────────────────────────────

const EXPAND_TRANSITION = { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const };
const CHEVRON_TRANSITION_MS = 200;

export function SidebarNavItem({
  item,
  base,
  isActive,
  isExpanded,
  isChildActive,
  onToggle,
  onNavigate,
  badge,
  badgeText,
  collapsed = false,
}: {
  item: NavItem;
  base: string;
  /** Whether the parent row itself is "active" (owns the current route). */
  isActive: boolean;
  /** Whether this parent's children panel is open. */
  isExpanded: boolean;
  /** Per-child active check — owner computes from pathname + searchParams. */
  isChildActive: (child: NavChild) => boolean;
  /** Toggle expansion. Caller enforces accordion: opening this closes others. */
  onToggle: () => void;
  /** Optional side-effect on any link click (used by mobile drawer to close). */
  onNavigate?: () => void;
  badge?: React.ReactNode;
  /** Plain-text badge for the collapsed-rail tooltip. */
  badgeText?: string;
  /** Desktop rail/collapsed mode: render icon-only, hide children. */
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  const hasChildren = !!(item.children && item.children.length > 0);
  const href = `${base}${item.href}`;

  const tooltipLabel = badgeText ? `${item.label} · ${badgeText}` : item.label;

  // Shared inner content for the label/icon side of the parent row.
  // Excludes the chevron — that lives in its own sibling button.
  const linkContent = (
    <>
      {item.isAI ? (
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
            isActive
              ? 'text-foreground'
              : 'text-foreground/55 group-hover:text-foreground',
          )}
        />
      )}

      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && badge}
    </>
  );

  // Full row content for the no-children case (Link wraps everything).
  const rowContent = (
    <>
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-foreground"
        />
      )}
      {linkContent}
    </>
  );

  const rowClasses = cn(
    'group relative rounded-md text-[13px] transition-colors duration-150',
    collapsed
      ? 'flex items-center justify-center w-10 h-10 mx-auto'
      : 'flex items-center gap-2.5 h-9 pl-3 pr-2.5',
    isActive
      ? 'bg-foreground/[0.045] text-foreground font-medium'
      : 'text-foreground/65 hover:bg-foreground/[0.025] hover:text-foreground',
  );

  return (
    <div>
      <CollapsedTooltip enabled={collapsed} label={tooltipLabel}>
        {hasChildren && !collapsed ? (
          // Parent with children → label/icon link navigates to the parent
          // route AND auto-expands; chevron is a separate button that
          // toggles expansion without navigating. Two affordances, one row.
          <div
            className={cn(
              'group relative rounded-md text-[13px] transition-colors duration-150',
              'flex items-center h-9 pl-3 pr-1',
              isActive
                ? 'bg-foreground/[0.045] text-foreground font-medium'
                : 'text-foreground/65 hover:bg-foreground/[0.025] hover:text-foreground',
            )}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-foreground"
              />
            )}
            <Link
              href={href}
              onClick={() => {
                onNavigate?.();
                if (!isExpanded) onToggle();
              }}
              className="flex-1 flex items-center gap-2.5 min-w-0"
            >
              {linkContent}
            </Link>
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={isExpanded}
              aria-controls={`nav-children-${item.href}`}
              aria-label={isExpanded ? `Collapse ${item.label}` : `Expand ${item.label}`}
              className="flex-shrink-0 w-7 h-7 inline-flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              <ChevronDown
                size={12}
                strokeWidth={1.75}
                className={cn(
                  'transition-transform ease-out',
                  isExpanded && 'rotate-180',
                )}
                style={{ transitionDuration: `${CHEVRON_TRANSITION_MS}ms` }}
              />
            </button>
          </div>
        ) : (
          // Parent without children (or collapsed rail) → plain navigation.
          // Rail-mode parents with children also fall here: the icon links
          // to the parent route so a single click from the rail still gets
          // the realtor somewhere useful (children can't render in the rail).
          <Link href={href} onClick={onNavigate} className={rowClasses}>
            {rowContent}
          </Link>
        )}
      </CollapsedTooltip>

      {/* Children — height + opacity animation, standard easing curve.
          Hidden in rail mode (no horizontal room for the indent + labels). */}
      {hasChildren && !collapsed && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="children"
              id={`nav-children-${item.href}`}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={EXPAND_TRANSITION}
              className="overflow-hidden"
            >
              <div className="ml-[14px] pl-3 py-1 space-y-px border-l border-border/50">
                {item.children!.map((child) => {
                  const childHref = `${base}${child.href}`;
                  const childActive = isChildActive(child);
                  return (
                    <Link
                      key={child.href}
                      href={childHref}
                      onClick={onNavigate}
                      className={cn(
                        'flex items-center h-7 px-2 rounded text-[12px] transition-colors duration-150',
                        childActive
                          ? 'text-foreground font-medium'
                          : 'text-foreground/55 hover:text-foreground hover:bg-foreground/[0.025]',
                      )}
                    >
                      <span className="truncate">{child.label}</span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
