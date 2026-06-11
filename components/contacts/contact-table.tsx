'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ContactForm } from './contact-form';
import {
  Search,
  Trash2,
  Pencil,
  Phone,
  Mail,
  Wallet,
  MapPin,
  LayoutGrid,
  List,
  Download,
  Upload,
  Bookmark,
  X,
  CheckSquare,
  GitCompare,
  CalendarDays,
  MoreHorizontal,
  Inbox,
  Mic,
  Tag as TagIcon,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { BODY_MUTED, H1, TITLE_FONT } from '@/lib/typography';

import Link from 'next/link';
import { ApplicationCompare } from './application-compare';
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
import { downloadCSV } from '@/lib/csv';
import type { SavedView } from '@/lib/types';
import { formatCurrency as _formatCurrency, getInitials } from '@/lib/formatting';
import { CONTACT_STAGES } from '@/lib/constants';
import { CsvImportModal } from './csv-import-modal';
import { toast } from 'sonner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { motion } from 'framer-motion';
import { EASE_APPLE } from '@/lib/motion';

type Client = {
  id: string;
  name: string;
  type: 'QUALIFICATION' | 'TOUR' | 'APPLICATION';
  phone: string | null;
  email: string | null;
  budget: number | null;
  preferences: string | null;
  properties: string[];
  createdAt: string;
  address: string | null;
  notes: string | null;
  tags: string[];
  followUpAt: string | null;
  leadType: 'rental' | 'buyer';
  leadScore: number | null;
};

const STAGES = CONTACT_STAGES;

function formatCurrency(value: number | null) {
  if (value == null) return null;
  return _formatCurrency(value);
}

/**
 * Lead-score → tier. Thresholds mirror lib/dynamic-lead-scoring.ts
 * (>=75 hot, >=45 warm, else cold). Null/unscored returns null so the card
 * renders nothing rather than a misleading zero.
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
 * Lead-score chip — a tier dot + the score, scannable at a glance. The one
 * piece of "who's hot" signal a realtor wants without sorting for it.
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

interface ContactTableProps {
  slug: string;
}

export function ContactTable({ slug }: ContactTableProps) {
  const [contacts, setContacts] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [leadTypeFilter, setLeadTypeFilter] = useState<'all' | 'new' | 'rental' | 'buyer'>('all');
  const [tagFilter, setTagFilter] = useState('');
  // Popover-based tag filter. Replaces the previous always-on chip strip,
  // which became unreadable noise once a workspace accumulated >10 tags.
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [tagPopoverSearch, setTagPopoverSearch] = useState('');
  const [sortBy, setSortBy] = useState<
    'newest' | 'oldest' | 'name-az' | 'name-za' | 'agent-priority'
  >('agent-priority');
  const [importOpen, setImportOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editContact, setEditContact] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  // Set on fetchContacts failure. Used to render an inline banner above the
  // list instead of silently falling through to the "fresh workspace" empty
  // state — which would tell a realtor with 200 contacts they have none.
  const [error, setError] = useState(false);
  const [view, setView] = useState<'card' | 'list'>('list');
  // Multi-select moves behind a deliberate Select mode. Default is "scan and
  // tap a row" — the row is a link, no checkbox in sight. Hit Select and the
  // checkboxes appear and the row toggles instead of navigating. The
  // realtor's screenshot showed a permanent checkbox column crowding every
  // row; we owe them that space back.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [saveViewName, setSaveViewName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const { confirm, ConfirmDialog } = useConfirm();

  // Load saved views from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`saved-views-contacts-${slug}`);
      if (stored) setSavedViews(JSON.parse(stored));
    } catch {
      /* ignore */
    }
  }, [slug]);

  function persistSavedViews(views: SavedView[]) {
    setSavedViews(views);
    localStorage.setItem(`saved-views-contacts-${slug}`, JSON.stringify(views));
  }

  function handleSaveView() {
    if (!saveViewName.trim()) return;
    const newView: SavedView = {
      id: crypto.randomUUID(),
      name: saveViewName.trim(),
      page: 'contacts',
      filters: { typeFilter },
    };
    persistSavedViews([...savedViews, newView]);
    setSaveViewName('');
    setShowSaveInput(false);
  }

  function applyView(view: SavedView) {
    const f = view.filters as { typeFilter?: string };
    if (f.typeFilter) setTypeFilter(f.typeFilter);
  }

  function deleteView(id: string) {
    persistSavedViews(savedViews.filter((v) => v.id !== id));
  }

  const fetchContacts = useCallback(async () => {
    try {
      const params = new URLSearchParams({ slug, search, type: typeFilter });
      const res = await fetch(`/api/contacts?${params}`);
      if (!res.ok) {
        setError(true);
        return;
      }
      setContacts(await res.json());
      setError(false);
    } catch (err) {
      console.error('[contact-table] fetchContacts failed:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [slug, search, typeFilter]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // Leaving Select mode clears the active selection — no orphaned state.
  useEffect(() => {
    if (!selectMode) setSelectedIds(new Set());
  }, [selectMode]);

  // Esc clears the selection AND exits Select mode — single calming gesture
  // for "I'm done with this," same shortcut the drafts inbox uses.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          setSelectedIds(new Set());
        } else if (selectMode) {
          setSelectMode(false);
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectMode, selectedIds.size]);

  async function handleAdd(data: any) {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, slug }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to add contact');
    }
    fetchContacts();
  }

  async function handleEdit(data: any) {
    if (!editContact) return;
    const res = await fetch(`/api/contacts/${editContact.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Failed to update contact');
    }
    setEditContact(null);
    fetchContacts();
  }

  async function handleDelete(id: string) {
    const contact = contacts.find((c) => c.id === id);
    const confirmed = await confirm({
      title: 'Delete this client?',
      description: contact
        ? `"${contact.name}" will be gone. I can't bring them back.`
        : "This client will be gone. I can't bring them back.",
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/contacts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Contact deleted.');
      } else {
        toast.error("Couldn't delete that contact. Try again.");
      }
    } catch {
      toast.error("Couldn't delete that contact. Try again.");
    }
    fetchContacts();
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === visibleContacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleContacts.map((c) => c.id)));
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    const confirmed = await confirm({
      title: `Delete ${ids.length} client${ids.length !== 1 ? 's' : ''}?`,
      description: "These will be gone. I can't bring them back.",
    });
    if (!confirmed) return;
    try {
      const results = await Promise.allSettled(
        ids.map((id) => fetch(`/api/contacts/${id}`, { method: 'DELETE' })),
      );
      const failures = results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
      );
      if (failures.length === 0) {
        toast.success(`Deleted ${ids.length} contacts.`);
      } else if (failures.length === ids.length) {
        toast.error("Couldn't delete those contacts. Try again.");
      } else {
        toast.success(`Deleted ${ids.length - failures.length} contacts.`);
        toast.error(`${failures.length} got stuck. Try those again.`);
      }
    } catch {
      toast.error("Couldn't delete those contacts. Try again.");
    } finally {
      setSelectedIds(new Set());
      fetchContacts();
    }
  }

  async function handleBulkChangeType(newType: Client['type']) {
    const ids = [...selectedIds];
    const prevTypes = new Map<string, Client['type']>();
    for (const id of ids) {
      const contact = contacts.find((c) => c.id === id);
      if (contact) prevTypes.set(id, contact.type);
    }
    try {
      const results = await Promise.allSettled(
        ids.map((id) =>
          fetch(`/api/contacts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: newType }),
          }),
        ),
      );
      const failures = results.filter(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok),
      );
      const successes = ids.length - failures.length;
      const stageLabel = stageLabels[newType] ?? newType.toLowerCase();
      if (successes > 0) {
        toast.success(`Moved ${successes} to ${stageLabel}.`, {
          action: {
            label: 'Undo',
            onClick: () => undoBulkStageChange(prevTypes),
          },
        });
      }
      if (failures.length > 0) {
        toast.error(`${failures.length} got stuck. Try those again.`);
      }
    } catch {
      toast.error("Couldn't update those contacts. Try again.");
    } finally {
      setSelectedIds(new Set());
      fetchContacts();
    }
  }

  async function undoBulkStageChange(prevTypes: Map<string, Client['type']>) {
    try {
      await Promise.allSettled(
        [...prevTypes.entries()].map(([id, type]) =>
          fetch(`/api/contacts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type }),
          }),
        ),
      );
      toast.success('Moved back.');
    } catch {
      toast.error("Couldn't undo. Try moving them manually.");
    } finally {
      fetchContacts();
    }
  }

  function handleExportSelected() {
    const toExport = visibleContacts.filter((c) => selectedIds.has(c.id));
    exportContactsCSV(toExport);
  }

  function handleExportAll() {
    exportContactsCSV(visibleContacts);
  }

  function exportContactsCSV(items: Client[]) {
    downloadCSV(
      'contacts.csv',
      items.map((c) => ({
        Name: c.name,
        Stage: c.type,
        Phone: c.phone ?? '',
        Email: c.email ?? '',
        'Budget ($/mo)': c.budget ?? '',
        Address: c.address ?? '',
        Preferences: c.preferences ?? '',
        Notes: c.notes ?? '',
        Tags: c.tags.join('; '),
        'Follow-up': c.followUpAt
          ? new Date(c.followUpAt).toLocaleDateString('en-US')
          : '',
        Added: new Date(c.createdAt).toLocaleDateString('en-US'),
      })),
    );
  }

  // Unique user-defined tags (exclude system tags)
  const SYSTEM_TAGS = new Set(['application-link', 'new-lead']);
  const allTags = Array.from(
    new Set(contacts.flatMap((c) => c.tags.filter((t) => !SYSTEM_TAGS.has(t)))),
  ).sort();

  // Apply tag + leadType filters and sorting client-side
  const visibleContacts = (() => {
    let list = contacts
      .filter((c) => {
        if (leadTypeFilter === 'all') return true;
        if (leadTypeFilter === 'new') return c.tags.includes('new-lead');
        return c.leadType === leadTypeFilter;
      })
      .filter((c) => !tagFilter || c.tags.includes(tagFilter));
    if (sortBy === 'agent-priority') {
      list = [...list].sort((a, b) => (b.leadScore ?? -1) - (a.leadScore ?? -1));
    } else if (sortBy === 'oldest') {
      list = [...list].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
    } else if (sortBy === 'newest') {
      list = [...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } else if (sortBy === 'name-az') {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'name-za') {
      list = [...list].sort((a, b) => b.name.localeCompare(a.name));
    }
    return list;
  })();

  const contactViews = savedViews.filter((v) => v.page === 'contacts');

  const leadTypeChips: {
    key: 'all' | 'new' | 'rental' | 'buyer';
    label: string;
    count: number;
  }[] = [
    { key: 'all', label: 'All', count: contacts.length },
    { key: 'new', label: 'New', count: contacts.filter((c) => c.tags.includes('new-lead')).length },
    { key: 'rental', label: 'Rental', count: contacts.filter((c) => c.leadType === 'rental').length },
    { key: 'buyer', label: 'Buyer', count: contacts.filter((c) => c.leadType === 'buyer').length },
  ];

  const sortLabels: Record<typeof sortBy, string> = {
    'agent-priority': 'Hottest first',
    newest: 'Recently added',
    oldest: 'Oldest first',
    'name-az': 'Name A–Z',
    'name-za': 'Name Z–A',
  };

  const stageLabels: Record<string, string> = {
    ALL: 'All stages',
    QUALIFICATION: 'Qualifying',
    TOUR: 'Tour',
    APPLICATION: 'Applied',
  };

  // Subtitle copy — one quiet sentence, count-aware. The old loud chrome
  // ("Qualifying 5 → Tour 0 → Applied 0 → 5 total" pipeline strip) is gone;
  // the stage filter carries the cut, and a sentence carries the count.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeekCount = contacts.filter(
    (c) => new Date(c.createdAt).getTime() >= weekAgo,
  ).length;
  const subtitle = (() => {
    if (loading || error) return null;
    if (contacts.length === 0) return null;
    const noun = contacts.length === 1 ? 'contact' : 'contacts';
    if (newThisWeekCount > 0) {
      return `${contacts.length} ${noun} · ${newThisWeekCount} new this week.`;
    }
    return `${contacts.length} ${noun}.`;
  })();

  return (
    <div className="space-y-6">
      {/* Header — canonical three-line pattern: muted greeting, serif Times
          h1, one-sentence status. The "Tell Chippi → / or fill out the form"
          pair that used to sit awkwardly inside the h1 row moved to the
          empty state — when there's data, that affordance is noise. */}
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>People.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Your relationships
        </h1>
        {subtitle && <p className={BODY_MUTED}>{subtitle}</p>}
      </header>

      {/* Lead-type chip strip — small line directly under the title, only
          when there's data to filter. The chip count format matches the
          existing labels (All · New · Rental · Buyer). */}
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
                  // Underline tab — the page's primary spine. The active tab
                  // carries a 2px foreground rail, the rest recede to muted.
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

      {/* ONE filter row — search · stage · tag · sort · view · select ·
          overflow. Used to be three rows of chrome plus a pipeline progress
          strip; mirrors the deals page toolbar pattern. */}
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

            {/* Tag filter — hidden when no user-defined tags exist. */}
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
                {(Object.keys(sortLabels) as (keyof typeof sortLabels)[]).map((key) => (
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

            {/* View toggle */}
            <div className="flex rounded-md border border-border/70 overflow-hidden bg-background flex-shrink-0">
              <button
                type="button"
                onClick={() => setView('list')}
                aria-label="List view"
                aria-pressed={view === 'list'}
                className={cn(
                  'h-9 w-9 flex items-center justify-center transition-colors',
                  view === 'list'
                    ? 'bg-foreground/[0.045] text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
                )}
              >
                <List size={14} />
              </button>
              <button
                type="button"
                onClick={() => setView('card')}
                aria-label="Grid view"
                aria-pressed={view === 'card'}
                className={cn(
                  'h-9 w-9 flex items-center justify-center transition-colors',
                  view === 'card'
                    ? 'bg-foreground/[0.045] text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
                )}
              >
                <LayoutGrid size={14} />
              </button>
            </div>

            {/* Select-mode toggle — bulk actions live behind a deliberate
                gesture instead of a permanent checkbox column on every row. */}
            <button
              type="button"
              onClick={() => setSelectMode((s) => !s)}
              aria-pressed={selectMode}
              className={cn(
                'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-xs font-medium transition-colors',
                selectMode
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-background border-border/70 text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
              )}
            >
              <CheckSquare size={12} />
              {selectMode ? 'Done' : 'Select'}
            </button>

            {/* Overflow */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More options"
                  className="h-9 w-9 flex items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => setShowSaveInput(true)}>
                  <Bookmark size={12} />
                  Save view
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <Upload size={12} />
                  Import
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => handleExportAll()}
                  disabled={contacts.length === 0}
                >
                  <Download size={12} />
                  Export
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Save-view inline input */}
      {showSaveInput && (
        <div className="flex items-center gap-1.5">
          <input
            ref={saveInputRef}
            type="text"
            value={saveViewName}
            onChange={(e) => setSaveViewName(e.target.value)}
            placeholder="Name this view…"
            className="text-xs rounded-md border border-border/70 bg-background px-2.5 h-8 w-44 focus:outline-none focus:ring-2 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveView();
              if (e.key === 'Escape') setShowSaveInput(false);
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={handleSaveView}
            className="h-8 px-3 rounded-md text-xs font-medium bg-foreground text-background hover:bg-foreground/90 transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setShowSaveInput(false)}
            className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Saved-view chips */}
      {contactViews.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs text-muted-foreground mr-1">Saved:</span>
          {contactViews.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-1 text-xs font-medium rounded-full pl-2.5 pr-1 h-6 border border-border/70 bg-background"
            >
              <button
                type="button"
                onClick={() => applyView(v)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={() => deleteView(v.id)}
                className="w-4 h-4 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
              >
                <X size={9} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Loading skeleton — rows match the calmer divide-y vocabulary. */}
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

      {/* Inline error banner — fetch failed. */}
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
            I couldn&apos;t reach your contacts.
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

      {/* Empty state — context-aware. The fresh-workspace case is where the
          "Tell Chippi → / or fill out the form" pair lives now: when the
          list is empty the affordance earns its place; when it isn't, that
          header CTA was just chrome competing with the title. */}
      {!loading && !error && visibleContacts.length === 0 && (() => {
        const hasStageFilter = typeFilter !== 'ALL';
        const hasLeadTypeFilter = leadTypeFilter !== 'all';
        const hasTagFilter = !!tagFilter;
        const hasAnyFilter = hasStageFilter || hasLeadTypeFilter || hasTagFilter;
        const isSearchOrFilterCase = !!search || hasTagFilter;
        const isFreshWorkspace = !search && !hasAnyFilter && contacts.length === 0;
        const clearAllFilters = () => {
          setTypeFilter('ALL');
          setLeadTypeFilter('all');
          setTagFilter('');
        };

        if (isFreshWorkspace) {
          return (
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-12 text-center">
              <p className="text-base text-foreground">No relationships yet.</p>
              <p className={cn(BODY_MUTED, 'mt-1.5')}>
                <Link
                  href={`/s/${slug}/chippi?prefill=${encodeURIComponent(
                    "I'm adding a new person — ",
                  )}`}
                  className="text-foreground underline underline-offset-2 hover:no-underline"
                >
                  Tell Chippi about someone
                </Link>
                {', or '}
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="text-foreground underline underline-offset-2 hover:no-underline"
                >
                  fill out the form
                </button>
                .
              </p>
            </div>
          );
        }

        if (isSearchOrFilterCase) {
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
              Adjust the current filters to see more.
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

      {/* Card view — stage-grouped (existing pattern, kept for the grid
          toggle; cleaned only of the always-on checkbox). */}
      {!loading && !error && visibleContacts.length > 0 && view === 'card' && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {STAGES.map((stage) => {
            const stageContacts = visibleContacts.filter((c) => c.type === stage.key);
            if (stageContacts.length === 0 && !search && !tagFilter) {
              return (
                <div
                  key={stage.key}
                  className={cn(
                    'rounded-lg border-2 border-dashed p-4 flex flex-col items-center justify-center min-h-[120px] text-center gap-2',
                    stage.border,
                  )}
                >
                  <span className={cn('w-2 h-2 rounded-full', stage.dotColor)} />
                  <p className="text-xs font-semibold text-muted-foreground">
                    {stage.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60">
                    {stage.description}
                  </p>
                </div>
              );
            }
            if (stageContacts.length === 0) return null;
            return (
              <div key={stage.key} className="flex flex-col gap-2">
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-3 py-2',
                    stage.headerBg,
                  )}
                >
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', stage.dotColor)} />
                  <span className="text-xs font-semibold text-foreground">{stage.label}</span>
                  <span
                    className={cn(
                      'ml-auto text-[11px] font-semibold rounded-md px-1.5 py-0.5',
                      stage.className,
                    )}
                  >
                    {stageContacts.length}
                  </span>
                </div>
                {stageContacts.map((contact) => (
                  <ContactCard
                    key={contact.id}
                    contact={contact}
                    slug={slug}
                    onEdit={() => setEditContact(contact)}
                    onDelete={() => handleDelete(contact.id)}
                    selectMode={selectMode}
                    selected={selectedIds.has(contact.id)}
                    onToggleSelect={() => toggleSelect(contact.id)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* List view — divide-y row vocabulary. */}
      {!loading && !error && visibleContacts.length > 0 && view === 'list' && (
        <div>
          {/* Tiny strip — only when select mode is on, so the select-all
              checkbox has a home. Otherwise the row list speaks for itself;
              column labels on a single-data-line list are chrome that pays
              no rent. */}
          {selectMode && (
            <div className="flex items-center gap-3 pb-2 border-b border-border/60 mb-1">
              <input
                type="checkbox"
                checked={
                  selectedIds.size === visibleContacts.length && visibleContacts.length > 0
                }
                onChange={toggleSelectAll}
                aria-label="Select all"
                className="rounded border-border cursor-pointer flex-shrink-0"
              />
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `Select up to ${visibleContacts.length}`}
              </span>
            </div>
          )}

          <ul className="divide-y divide-border/60">
            {visibleContacts.map((contact, idx) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                slug={slug}
                idx={idx}
                selectMode={selectMode}
                selected={selectedIds.has(contact.id)}
                onToggleSelect={() => toggleSelect(contact.id)}
                onEdit={() => setEditContact(contact)}
                onDelete={() => handleDelete(contact.id)}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Bulk-action bar — only when something is selected. */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto w-fit z-30 flex items-center flex-wrap gap-2 rounded-lg border border-border/70 bg-card px-3 sm:px-4 py-2 sm:py-3 max-w-[calc(100vw-2rem)]">
          <CheckSquare size={14} className="text-foreground" />
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-border mx-1" />
          <Select onValueChange={(v) => handleBulkChangeType(v as Client['type'])}>
            <SelectTrigger className="h-8 text-xs w-36 bg-muted border-0">
              <SelectValue placeholder="Move to stage…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="QUALIFICATION">Qualifying</SelectItem>
              <SelectItem value="TOUR">Tour</SelectItem>
              <SelectItem value="APPLICATION">Applied</SelectItem>
            </SelectContent>
          </Select>
          {selectedIds.size >= 2 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCompare(true)}
              className="h-8 gap-1.5 text-xs hidden sm:inline-flex"
            >
              <GitCompare size={12} />
              Compare
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportSelected}
            className="h-8 gap-1.5 text-xs"
          >
            <Download size={12} />
            Export
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDelete}
            className="h-8 text-xs"
          >
            Delete
          </Button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            aria-label="Clear selection"
            className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-1"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {showCompare && selectedIds.size >= 2 && (
        <ApplicationCompare
          slug={slug}
          selectedIds={[...selectedIds]}
          onClose={() => setShowCompare(false)}
        />
      )}
      <ContactForm
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={handleAdd}
        mode="add"
        slug={slug}
      />
      <ContactForm
        open={!!editContact}
        onOpenChange={(o) => !o && setEditContact(null)}
        onSubmit={handleEdit}
        mode="edit"
        defaultValues={
          editContact
            ? {
                name: editContact.name,
                email: editContact.email ?? '',
                phone: editContact.phone ?? '',
                budget: editContact.budget?.toString() ?? '',
                preferences: editContact.preferences ?? '',
                properties: editContact.properties.join(', '),
                address: editContact.address ?? '',
                notes: editContact.notes ?? '',
                type: editContact.type,
                tags: editContact.tags.join(', '),
              }
            : undefined
        }
      />

      {importOpen && (
        <CsvImportModal
          slug={slug}
          onClose={() => setImportOpen(false)}
          onImported={(count) => {
            setImportOpen(false);
            if (count > 0) {
              toast.success('Contacts imported.');
              fetchContacts();
            }
          }}
        />
      )}
      {ConfirmDialog}
    </div>
  );
}

// ─── ContactRow — canonical divide-y row vocabulary ────────────────────────
//
// Avatar (32) / name + stage pill on top / email · phone on a single line
// below. The line truncates as one — phone numbers no longer wrap to their
// own line on mobile. Edit / mic / delete fade in on row hover at lg+; on
// smaller screens a quiet chevron hints the row is tappable. Multi-select
// moves behind the page-level Select toggle.

function ContactRow({
  contact,
  slug,
  idx,
  selectMode,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
}: {
  contact: Client;
  slug: string;
  idx: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const stage = STAGES.find((s) => s.key === contact.type)!;
  // Cap stagger to first 10 rows — past that, the row enters instantly.
  // 30ms-per-row is the Apple list cadence (tight enough to read as one
  // gesture, loose enough that each row reads its own arrival).
  const shouldAnimate = idx < 10;
  const delay = shouldAnimate ? idx * 0.03 : 0;
  // Stage pill follows the row by 50ms — small enough to feel like a single
  // composed gesture; large enough that the eye registers the row first.
  const pillDelay = shouldAnimate ? delay + 0.05 : 0;
  const followUpDate = contact.followUpAt ? new Date(contact.followUpAt) : null;
  const followUpOverdue = followUpDate ? followUpDate < new Date() : false;

  // The body of the row — shared between Link and select-toggle wrappers so
  // the visual layout never drifts between modes.
  const body = (
    <>
      <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {getInitials(contact.name)}
      </div>
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
        {/* email · phone — single truncating line. Either may be absent;
            the separator only renders when both are present. */}
        {(contact.email || contact.phone) && (
          <div className="mt-0.5 text-xs text-muted-foreground truncate">
            {contact.email && <span>{contact.email}</span>}
            {contact.email && contact.phone && (
              <span className="text-muted-foreground/40"> · </span>
            )}
            {contact.phone && <span className="tabular-nums">{contact.phone}</span>}
          </div>
        )}
      </div>
      {/* Right metadata — follow-up pill stays visible (the realtor needs
          to see it without hovering). The action icons hide until row
          hover at lg+; smaller screens fall back to a quiet chevron. */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Lead temperature — always visible, same signal as the cards. */}
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
        {!selectMode && (
          <>
            <div className="hidden lg:flex gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
              <Link
                href={`/s/${slug}/chippi/log?personId=${contact.id}`}
                aria-label={`Log a note for ${contact.name}`}
                title="Log a note"
                onClick={(e) => e.stopPropagation()}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Mic size={13} />
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onEdit();
                }}
                aria-label={`Edit ${contact.name}`}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete();
                }}
                aria-label={`Delete ${contact.name}`}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <ChevronRight
              size={14}
              className="lg:hidden text-muted-foreground/40 flex-shrink-0"
              aria-hidden
            />
          </>
        )}
      </div>
    </>
  );

  const rowClassName = cn(
    'group/row flex items-center gap-3 py-3 px-2 -mx-2 rounded-md transition-colors',
    selected ? 'bg-muted/40' : 'hover:bg-muted/30',
  );

  return (
    <motion.li
      // Apple list entrance — 200ms fade + 8px slide-up. Capped at 10 rows
      // so a long contact list doesn't choreograph the whole page on load.
      initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE_APPLE, delay }}
    >
      {selectMode ? (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          className={cn(rowClassName, 'w-full text-left cursor-pointer')}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${contact.name}`}
            className="rounded border-border cursor-pointer flex-shrink-0"
          />
          {body}
        </button>
      ) : (
        <Link href={`/s/${slug}/contacts/${contact.id}`} className={rowClassName}>
          {body}
        </Link>
      )}
    </motion.li>
  );
}

// ─── Card view sub-component ────────────────────────────────────────────────

function ContactCard({
  contact,
  slug,
  onEdit,
  onDelete,
  selectMode,
  selected,
  onToggleSelect,
}: {
  contact: Client;
  slug: string;
  onEdit: () => void;
  onDelete: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  return (
    <div
      className={cn(
        'group rounded-lg border bg-card overflow-hidden transition-colors duration-150 hover:bg-muted/30',
        selected ? 'border-border bg-muted/40' : 'border-border/70',
      )}
    >
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2.5 min-w-0">
            {selectMode && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                onClick={(e) => e.stopPropagation()}
                className="rounded border-border cursor-pointer flex-shrink-0 mt-0.5"
                aria-label={`Select ${contact.name}`}
              />
            )}
            <div className="w-8 h-8 rounded-full bg-muted/40 text-muted-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {getInitials(contact.name)}
            </div>
            <div className="min-w-0">
              <Link
                href={`/s/${slug}/contacts/${contact.id}`}
                className="font-semibold text-sm hover:text-foreground transition-colors truncate block leading-tight"
              >
                {contact.name}
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Lead temperature — always visible, the scannable signal. */}
            <ScoreChip score={contact.leadScore} />
            {!selectMode && (
              <div className="flex gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={onEdit}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  aria-label={`Edit ${contact.name}`}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                  aria-label={`Delete ${contact.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1">
          {contact.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone size={10} className="flex-shrink-0" />
              <a
                href={`tel:${contact.phone}`}
                className="truncate hover:text-foreground transition-colors"
              >
                {contact.phone}
              </a>
            </div>
          )}
          {contact.email && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Mail size={10} className="flex-shrink-0" />
              <a
                href={`mailto:${contact.email}`}
                className="truncate hover:text-foreground transition-colors"
              >
                {contact.email}
              </a>
            </div>
          )}
          {contact.budget != null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet size={10} className="flex-shrink-0" />
              <span>
                {formatCurrency(contact.budget)}
                {contact.leadType === 'rental' ? '/mo' : ''}
              </span>
            </div>
          )}
          {contact.preferences && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin size={10} className="flex-shrink-0" />
              <span className="truncate">{contact.preferences}</span>
            </div>
          )}
          {contact.followUpAt && (
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium',
                new Date(contact.followUpAt) < new Date()
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400',
              )}
            >
              <CalendarDays size={10} className="flex-shrink-0" />
              <span>
                {new Date(contact.followUpAt) < new Date() ? 'Overdue' : 'Due'}{' '}
                {new Date(contact.followUpAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
