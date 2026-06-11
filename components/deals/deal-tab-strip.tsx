'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * URL-driven tab strip for the deal detail page. Near-copy of the people
 * detail's tab strip (see `app/s/[slug]/contacts/[id]/detail-client.tsx`) so
 * the two surfaces feel identical to a realtor switching back and forth.
 *
 * The realtor moves between People and Deals all day; their mental model
 * resets on every transition. Matching the chrome — same border-b-2
 * underline, same `?tab=` URL contract, same `scroll={false}` prefetch
 * behaviour — keeps the transition silent. Consolidating this and the
 * contact tab strip into a single `<DetailTabStrip>` is a deliberate
 * follow-up; doing it here would refactor the contact one mid-ship.
 */

export type DealTabKey =
  | 'activity'
  | 'documents'
  | 'contacts'
  | 'commission'
  | 'tasks';

const TABS: { key: DealTabKey; label: string }[] = [
  { key: 'activity', label: 'Activity' },
  { key: 'documents', label: 'Documents' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'commission', label: 'Commission' },
  { key: 'tasks', label: 'Tasks' },
];

export const DEAL_TAB_KEYS: DealTabKey[] = TABS.map((t) => t.key);

export function isDealTabKey(value: string | null | undefined): value is DealTabKey {
  return value != null && DEAL_TAB_KEYS.includes(value as DealTabKey);
}

export function DealTabStrip({ baseHref }: { baseHref: string }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const active: DealTabKey = isDealTabKey(tabParam) ? tabParam : 'activity';

  return (
    <nav
      className="flex items-center gap-1 border-b border-border/60 -mx-2 px-2 overflow-x-auto"
      aria-label="Deal sections"
    >
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={`${baseHref}?tab=${t.key}`}
            scroll={false}
            className={cn(
              'flex items-center px-3 py-2 -mb-px text-sm whitespace-nowrap border-b-2 transition-colors duration-150',
              isActive
                ? 'border-foreground text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            aria-current={isActive ? 'page' : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
