'use client';

import { useState, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { getInitials } from '@/lib/formatting';
import { CONTACT_STAGES } from '@/lib/constants';
import {
  Search,
  AlertTriangle,
  Inbox,
  X,
  CalendarDays,
  ChevronRight,
  Tag as TagIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { EASE_APPLE } from '@/lib/motion';
import { BODY_MUTED, H1, TITLE_FONT } from '@/lib/typography';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────

type BrokerContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  type: 'QUALIFICATION' | 'TOUR' | 'APPLICATION';
  leadType: 'rental' | 'buyer' | 'seller' | null;
  leadScore: number | null;
  scoreLabel: string | null;
  tags: string[];
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  spaceId: string;
  realtorName: string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Lead-score → tier. Mirrors contact-table.tsx and broker-leads-client.tsx.
 * Thresholds: >=75 hot, >=45 warm, else cold. Null/zero returns null.
 */
function scoreTier(
  score: number | null,
): { label: string; dot: string; text: string } | null {
  if (score == null || score <= 0) return null;
  if (score >= 75) return { label: 'Hot', dot: 'bg-lead-hot', text: 'text-lead-hot' };
  if (score >= 45) return { label: 'Warm', dot: 'bg-lead-warm', text: 'text-lead-warm' };
  return { label: 'Cold', dot: 'bg-lead-cold', text: 'text-lead-cold' };
}

/**
 * Lead-score chip: tier dot + numeric score. Exact markup from contact-table.tsx.
 */
function ScoreChip({ score }: { score: number | null }) {
  const tier = scoreTier(score);
  if (!tier) return null;
  return (
    <span
      className="inline-flex items-center gap-1 flex-shrink-0"
      title={`${tier.label} lead · score ${score}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} aria-hidden />
      <span className={cn('text-[11px] font-semibold tabular-nums', tier.text)}>
        {score}
      </span>
    </span>
  );
}

const STAGES = CONTACT_STAGES;

const stageLabels: Record<string, string> = {
  ALL: 'All stages',
  QUALIFICATION: 'Qualifying',
  TOUR: 'Tour',
  APPLICATION: 'Applied',
};

const sortLabels = {
  'agent-priority': 'Hottest first',
  newest: 'Recently added',
  oldest: 'Oldest first',
  'name-az': 'Name A–Z',
  'name-za': 'Name Z–A',
} as const;

type SortKey = keyof typeof sortLabels;

const SYSTEM_TAGS = new Set(['application-link', 'new-lead']);

// ── Main component ─────────────────────────────────────────────────────────────

export function BrokerPeopleTable() {
  const [contacts, setContacts] = useState<BrokerContact[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [leadTypeFilter, setLeadTypeFilter] = useState<'all' | 'new' | 'rental' | 'buyer'>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [tagPopoverSearch, setTagPopoverSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('agent-priority');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ search, type: typeFilter });
      const res = await fetch(`/api/broker/contacts?${params}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      setContacts(await res.json());
      setError(false);
    } catch (err) {
      console.error('[broker-people-table] fetch failed:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // ── Client-side filtering + sorting ───────────────────────────────────────
  const allTags = Array.from(
    new Set(contacts.flatMap((c) => c.tags.filter((t) => !SYSTEM_TAGS.has(t)))),
  ).sort();

  const visibleContacts = (() => {
    let list = contacts
      .filter((c) => {
        if (leadTypeFilter === 'all') return true;
        if (leadTypeFilter === 'new') return c.tags.includes('new-lead');
        if (leadTypeFilter === 'rental') return c.leadType === 'rental';
        if (leadTypeFilter === 'buyer') return c.leadType === 'buyer';
        return true;
      })
      .filter((c) => !tagFilter || c.tags.includes(tagFilter));

    if (sortBy === 'agent-priority') {
      list = [...list].sort((a, b) => (b.leadScore ?? -1) - (a.leadScore ?? -1));
    } else if (sortBy === 'newest') {
      list = [...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } else if (sortBy === 'oldest') {
      list = [...list].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    } else if (sortBy === 'name-az') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'name-za') {
      list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    }
    return list;
  })();

  // ── Lead-type chips ────────────────────────────────────────────────────────
  const leadTypeChips: { key: 'all' | 'new' | 'rental' | 'buyer'; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: contacts.length },
    { key: 'new', label: 'New', count: contacts.filter((c) => c.tags.includes('new-lead')).length },
    { key: 'rental', label: 'Rental', count: contacts.filter((c) => c.leadType === 'rental').length },
    { key: 'buyer', label: 'Buyer', count: contacts.filter((c) => c.leadType === 'buyer').length },
  ];

  // ── Status sentence ────────────────────────────────────────────────────────
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeekCount = contacts.filter(
    (c) => new Date(c.createdAt).getTime() >= weekAgo,
  ).length;

  const subtitle = (() => {
    if (loading || error) return null;
    if (contacts.length === 0) return null;
    const noun = contacts.length === 1 ? 'person' : 'people';
    if (newThisWeekCount > 0) {
      return `${contacts.length} ${noun} across the brokerage. ${newThisWeekCount} new this week.`;
    }
    return `${contacts.length} ${noun} across the brokerage.`;
  })();

  const clearAllFilters = () => {
    setTypeFilter('ALL');
    setLeadTypeFilter('all');
    setTagFilter('');
  };

  const hasAnyFilter =
    typeFilter !== 'ALL' || leadTypeFilter !== 'all' || !!tagFilter;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header — status-sentence pattern */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>People.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Everyone your brokerage is working with
        </h1>
        {subtitle && <p className={BODY_MUTED}>{subtitle}</p>}
      </header>

      {/* Lead-type chip strip */}
      {!loading && !error && contacts.length > 0 && (
        <div
          role="tablist"
          aria-label="Filter people"
          className="flex items-center gap-5 border-b border-border/70 -mt-1"
        >
          {leadTypeChips.map((chip) => {
            const active = leadTypeFilter === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setLeadTypeFilter(chip.key)}
                className={cn(
                  'relative inline-flex items-center gap-1.5 pb-2.5 pt-0.5 text-sm transition-colors duration-150 ease-out -mb-px',
                  active
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground font-normal',
                )}
              >
                {chip.label}
                <span
                  className={cn(
                    'tabular-nums text-[11px] rounded-full px-1.5 py-0.5 transition-colors duration-150 ease-out',
                    active
                      ? 'bg-foreground/[0.06] text-foreground/70'
                      : 'bg-foreground/[0.04] text-muted-foreground',
                  )}
                >
                  {chip.count}
                </span>
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 right-0 -bottom-px h-[2px] rounded-full bg-foreground"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Filter row — search + stage + tag + sort */}
      {!loading && !error && contacts.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 sm:flex-initial min-w-[160px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              placeholder="Search…"
              className="pl-9 h-9 w-full sm:w-64 bg-background border-border/70"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {/* Stage filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <span className="text-muted-foreground">Stage:</span>
                  {stageLabels[typeFilter] ?? 'All stages'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {(['ALL', 'QUALIFICATION', 'TOUR', 'APPLICATION'] as const).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={() => setTypeFilter(key)}
                    className={cn(typeFilter === key && 'font-semibold')}
                  >
                    {stageLabels[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Tag filter */}
            {allTags.length > 0 && (
              <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border/70 bg-background text-xs font-medium transition-colors hover:bg-foreground/[0.04]',
                      tagFilter ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <TagIcon
                      size={12}
                      className={tagFilter ? 'text-foreground' : 'text-muted-foreground'}
                    />
                    {tagFilter ? (
                      <>
                        <span className="truncate max-w-[160px]">{tagFilter}</span>
                        <span
                          role="button"
                          aria-label="Clear tag filter"
                          onClick={(e) => {
                            e.stopPropagation();
                            setTagFilter('');
                          }}
                          className="ml-0.5 -mr-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm hover:bg-foreground/10"
                        >
                          <X size={10} />
                        </span>
                      </>
                    ) : (
                      'Tag'
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-64 p-0">
                  <div className="border-b border-border/60 px-2 py-1.5">
                    <Input
                      value={tagPopoverSearch}
                      onChange={(e) => setTagPopoverSearch(e.target.value)}
                      placeholder="Search tags…"
                      className="h-8 border-0 shadow-none focus-visible:ring-0 text-xs px-1"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto py-1">
                    {(() => {
                      const q = tagPopoverSearch.trim().toLowerCase();
                      const filtered = q
                        ? allTags.filter((t) => t.toLowerCase().includes(q))
                        : allTags;
                      if (filtered.length === 0) {
                        return (
                          <p className="px-3 py-2 text-xs text-muted-foreground">
                            No tags match.
                          </p>
                        );
                      }
                      return filtered.map((tag) => {
                        const active = tagFilter === tag;
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              setTagFilter(active ? '' : tag);
                              setTagPopoverOpen(false);
                              setTagPopoverSearch('');
                            }}
                            className={cn(
                              'w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-foreground/[0.04]',
                              active && 'font-semibold text-foreground',
                            )}
                          >
                            {tag}
                          </button>
                        );
                      });
                    })()}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {/* Sort */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border/70 bg-background text-xs font-medium text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <span className="text-muted-foreground">Sort:</span>
                  {sortLabels[sortBy]}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={() => setSortBy(key)}
                    className={cn(sortBy === key && 'font-semibold')}
                  >
                    {sortLabels[key]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <ul className="divide-y divide-border/60">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <li key={i} className="flex items-center gap-3 py-3">
              <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center mb-4">
            <AlertTriangle
              size={20}
              className="text-rose-600 dark:text-rose-400"
              strokeWidth={1.5}
            />
          </div>
          <p className="text-xl tracking-tight font-semibold text-foreground mb-1">
            Could not reach contacts.
          </p>
          <p className="text-sm text-muted-foreground">Usually temporary.</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchContacts();
            }}
            className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visibleContacts.length === 0 && (() => {
        const isSearch = !!search || !!tagFilter;

        if (!search && !hasAnyFilter && contacts.length === 0) {
          return (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
              <p className="text-base text-foreground">No contacts across the brokerage yet.</p>
              <p className={cn(BODY_MUTED, 'mt-1.5')}>
                Contacts will appear here as your realtors add them.
              </p>
            </div>
          );
        }

        if (isSearch) {
          return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-4">
                <Search size={20} className="text-muted-foreground/60" strokeWidth={1.5} />
              </div>
              <p className="text-xl tracking-tight font-semibold text-foreground mb-1">
                No matches.
              </p>
              <p className="text-sm text-muted-foreground">
                Try a shorter query or clear filters.
              </p>
              {hasAnyFilter && (
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <X size={13} /> Clear filters
                </button>
              )}
            </div>
          );
        }

        return (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-foreground/[0.04] flex items-center justify-center mb-4">
              <Inbox size={20} className="text-muted-foreground/60" strokeWidth={1.5} />
            </div>
            <p className="text-xl tracking-tight font-semibold text-foreground mb-1">
              Nothing in this view.
            </p>
            <p className="text-sm text-muted-foreground">
              Adjust the filters to see more.
            </p>
            {hasAnyFilter && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
              >
                <X size={13} /> Clear filters
              </button>
            )}
          </div>
        );
      })()}

      {/* Contact list */}
      {!loading && !error && visibleContacts.length > 0 && (
        <ul className="divide-y divide-border/60">
          {visibleContacts.map((contact, idx) => (
            <BrokerContactRow
              key={contact.id}
              contact={contact}
              idx={idx}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── BrokerContactRow ───────────────────────────────────────────────────────────
//
// Mirrors ContactRow in contact-table.tsx exactly — same avatar, name + stage
// pill, email·phone truncating line, ScoreChip, follow-up pill — with one
// broker-only addition: a Realtor byline under the contact's name/email line.
// Row click drills into /broker?prompt=... (Chippi prefilled about this lead).

function BrokerContactRow({
  contact,
  idx,
}: {
  contact: BrokerContact;
  idx: number;
}) {
  const stage = STAGES.find((s) => s.key === contact.type) ?? STAGES[0];
  const shouldAnimate = idx < 10;
  const delay = shouldAnimate ? idx * 0.03 : 0;
  const pillDelay = shouldAnimate ? delay + 0.05 : 0;
  const followUpDate = contact.followUpAt ? new Date(contact.followUpAt) : null;
  const followUpOverdue = followUpDate ? followUpDate < new Date() : false;

  const drillPrompt = encodeURIComponent(
    `Tell me about ${contact.name} (${contact.realtorName}'s lead). Where are they in the funnel and what's the next move?`
  );

  const rowClassName = cn(
    'group/row flex items-center gap-3 py-3 px-2 -mx-2 rounded-md transition-colors',
    'hover:bg-muted/30',
  );

  return (
    <motion.li
      initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_APPLE, delay }}
    >
      <Link href={`/broker?prompt=${drillPrompt}`} className={rowClassName}>
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
          {getInitials(contact.name)}
        </div>

        {/* Name + stage pill + email/phone + realtor byline */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">
              {contact.name}
            </span>
            <motion.span
              initial={shouldAnimate ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18, ease: EASE_APPLE, delay: pillDelay }}
              className={cn(
                'inline-flex text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0',
                stage.className,
              )}
            >
              {stage.label}
            </motion.span>
          </div>

          {/* email · phone — single truncating line */}
          {(contact.email || contact.phone) && (
            <div className="mt-0.5 text-xs text-muted-foreground truncate">
              {contact.email && <span>{contact.email}</span>}
              {contact.email && contact.phone && (
                <span className="text-muted-foreground/40"> · </span>
              )}
              {contact.phone && (
                <span className="tabular-nums">{contact.phone}</span>
              )}
            </div>
          )}

          {/* Realtor byline — the broker-only addition */}
          <div className="mt-0.5 text-[11px] text-muted-foreground/70 truncate">
            {contact.realtorName}
          </div>
        </div>

        {/* Right metadata: ScoreChip + follow-up + chevron */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <ScoreChip score={contact.leadScore} />

          {followUpDate && (
            <span
              className={cn(
                'hidden sm:inline-flex items-center gap-1 text-[11px] font-medium rounded px-1.5 py-0.5',
                followUpOverdue
                  ? 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15'
                  : 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
              )}
            >
              <CalendarDays size={10} />
              {followUpDate.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}

          <ChevronRight
            size={14}
            className="lg:hidden text-muted-foreground/40 flex-shrink-0"
            aria-hidden
          />
        </div>
      </Link>
    </motion.li>
  );
}
