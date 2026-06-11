'use client';

/**
 * Email inbox view — the Email tab of the Communication surface.
 *
 * Channel-pure (no WhatsApp). Rows tap into a full-page read at
 * /email/[id]. Filter sits at the top: Inbox · Starred · Sent. Star
 * toggles right from the row (always visible on mobile, hover-revealed
 * on desktop) and writes through to Gmail's STARRED label. Load more
 * pages in 30 at a time via Gmail's pageToken.
 *
 * Search: a visible input in the toolbar. Typing debounces 300ms then
 * fires /api/email?q=... which passes the query to Gmail's full-text
 * search. Clearing the field (or pressing Escape) returns to the
 * current filter view. Load more threads the q param through pagination.
 *
 * Page chrome (scroll container, greeting, title, subtitle) is owned by
 * the parent CommunicationView. This component renders one toolbar row
 * (filter chips · search · New message) followed by the list / empty /
 * loading states for the email tab only.
 *
 * Compose stays a modal: writing is a focal task that earns a dialog.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Mail, Plug, Plus, Search, Send, Star, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ShimmerText } from '@/components/chippi/shimmer-text';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  BODY,
  BODY_MUTED,
  SECTION_LABEL,
  PRIMARY_PILL,
  GHOST_PILL,
  CAPTION,
  META,
} from '@/lib/typography';

export type EmailFilter = 'inbox' | 'starred' | 'sent';

const FILTERS: { key: EmailFilter; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'starred', label: 'Starred' },
  { key: 'sent', label: 'Sent' },
];

interface EmailListItem {
  id: string;
  threadId: string;
  fromName: string;
  fromAddress: string;
  toName: string;
  toAddress: string;
  subject: string | null;
  snippet: string;
  sentAt: string;
  unread: boolean;
  starred: boolean;
}

interface ConnectedPayload {
  connected: true;
  provider: 'gmail' | 'outlook';
  filter: EmailFilter;
  items: EmailListItem[];
  nextPageToken: string | null;
  noteOutlookReadPending?: boolean;
}

interface NotConnectedPayload {
  connected: false;
}

type FetchPayload = ConnectedPayload | NotConnectedPayload;

interface EmailInboxViewProps {
  slug: string;
  initialConnected: boolean;
  initialProvider: string | null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const ms = now.getTime() - then.getTime();
  if (ms < 60_000) return 'now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function filterStorageKey(slug: string): string {
  return `email-filter:${slug}`;
}

function readStoredFilter(slug: string): EmailFilter {
  if (typeof window === 'undefined') return 'inbox';
  try {
    const v = window.localStorage.getItem(filterStorageKey(slug));
    if (v === 'starred' || v === 'sent' || v === 'inbox') return v;
  } catch {
    /* localStorage can throw in private browsing — treat as inbox. */
  }
  return 'inbox';
}

function writeStoredFilter(slug: string, filter: EmailFilter): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(filterStorageKey(slug), filter);
  } catch {
    /* no-op */
  }
}

export function EmailInboxView({
  slug,
  initialConnected,
  initialProvider: _initialProvider,
}: EmailInboxViewProps) {
  const router = useRouter();
  const [connected, setConnected] = useState(initialConnected);
  const [filter, setFilter] = useState<EmailFilter>('inbox');
  const [items, setItems] = useState<EmailListItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialConnected);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noteOutlookReadPending, setNoteOutlookReadPending] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  /** Index where the most-recent "load more" batch starts. Rows at indices
   *  below this entered with the initial filter paint and should not re-
   *  animate; rows at/after it are the newly appended page and stagger in. */
  const [appendCursor, setAppendCursor] = useState(0);
  const filterRef = useRef<EmailFilter>('inbox');

  // Search state: raw input, debounced query that actually fires.
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate filter from localStorage on mount.
  useEffect(() => {
    const stored = readStoredFilter(slug);
    setFilter(stored);
    filterRef.current = stored;
  }, [slug]);

  // Debounce: 300ms after the last keystroke, commit the search query.
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value.trim());
    }, 300);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    searchInputRef.current?.focus();
  }, []);

  // Clean up debounce timer on unmount.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const fetchPage = useCallback(
    async (args: {
      filter: EmailFilter;
      pageToken: string | null;
      append: boolean;
      q?: string;
    }) => {
      if (!connected) {
        setLoading(false);
        return;
      }
      if (args.append) setLoadingMore(true);
      else setLoading(true);
      setErrorMessage(null);

      const params = new URLSearchParams();
      params.set('slug', slug);
      params.set('filter', args.filter);
      if (args.pageToken) params.set('pageToken', args.pageToken);
      if (args.q) params.set('q', args.q);

      try {
        const res = await fetch(`/api/email?${params.toString()}`);
        if (!res.ok) throw new Error(`Could not load (${res.status}).`);
        const data = (await res.json()) as FetchPayload;
        // If a newer fetch already wrote (filter changed), discard this one.
        if (filterRef.current !== args.filter) return;
        if (!data.connected) {
          setConnected(false);
          setItems([]);
          setNextPageToken(null);
          return;
        }
        setConnected(true);
        setNoteOutlookReadPending(Boolean(data.noteOutlookReadPending));
        setItems((prev) => {
          if (args.append) {
            setAppendCursor(prev.length);
            return [...prev, ...data.items];
          }
          setAppendCursor(0);
          return data.items;
        });
        setNextPageToken(data.nextPageToken);
      } catch (err) {
        if (filterRef.current !== args.filter) return;
        setErrorMessage(
          err instanceof Error ? err.message : 'Could not reach your inbox.',
        );
      } finally {
        if (filterRef.current === args.filter) {
          if (args.append) setLoadingMore(false);
          else setLoading(false);
        }
      }
    },
    [connected, slug],
  );

  // Fetch whenever filter or search query changes. When a search query is
  // present, pass it to Gmail's full-text search; label filtering is relaxed
  // server-side. The filter-change handler always clears the search first so
  // changing filters never fires this with both a filter and a query.
  useEffect(() => {
    filterRef.current = filter;
    if (!connected) {
      setLoading(false);
      return;
    }
    fetchPage({
      filter,
      pageToken: null,
      append: false,
      q: searchQuery || undefined,
    });
  }, [filter, searchQuery, connected, fetchPage]);

  const handleFilterChange = useCallback(
    (next: EmailFilter) => {
      writeStoredFilter(slug, next);
      setFilter(next);
      // Switching filters clears the search so the user sees the real Inbox/Starred/Sent.
      setSearchInput('');
      setSearchQuery('');
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [slug],
  );

  const handleLoadMore = useCallback(() => {
    if (!nextPageToken || loadingMore) return;
    fetchPage({ filter, pageToken: nextPageToken, append: true, q: searchQuery || undefined });
  }, [fetchPage, filter, loadingMore, nextPageToken, searchQuery]);

  const handleSent = useCallback(() => {
    setComposeOpen(false);
    // Refetch the current view so the new outbound shows up if filter=sent.
    fetchPage({ filter, pageToken: null, append: false, q: searchQuery || undefined });
  }, [fetchPage, filter, searchQuery]);

  const handleStarToggle = useCallback(
    async (messageId: string, nextStarred: boolean) => {
      // Optimistic update + write through. Roll back on failure.
      setItems((prev) =>
        prev.map((it) =>
          it.id === messageId ? { ...it, starred: nextStarred } : it,
        ),
      );
      try {
        const res = await fetch('/api/email/star', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, messageId, starred: nextStarred }),
        });
        if (!res.ok) throw new Error('star failed');
      } catch {
        // Roll back.
        setItems((prev) =>
          prev.map((it) =>
            it.id === messageId ? { ...it, starred: !nextStarred } : it,
          ),
        );
      }
    },
    [slug],
  );

  const handleRowOpen = useCallback(
    (messageId: string) => {
      // Mark as read locally — Gmail will catch up server-side; we don't
      // round-trip a read-mark in v1.
      setItems((prev) =>
        prev.map((it) => (it.id === messageId ? { ...it, unread: false } : it)),
      );
      router.push(`/s/${slug}/email/${encodeURIComponent(messageId)}`);
    },
    [router, slug],
  );

  if (!connected) return <DisconnectedState slug={slug} />;

  return (
    <div className="space-y-5">
      {/* Toolbar: filter chips · search · New message */}
      <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
        <FilterChips value={filter} onChange={handleFilterChange} />

        {/* Search input — always visible at rest (DOET check 1). The
         *  magnifying-glass is an icon signifier inside the field;
         *  the X button appears only when there is text to clear. */}
        <div className="relative flex-1 min-w-[160px] sm:min-w-[220px] max-w-xs">
          <Search
            size={14}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            ref={searchInputRef}
            type="search"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                clearSearch();
              }
            }}
            placeholder="Search mail"
            aria-label="Search mail"
            className="pl-9 pr-9 h-9 text-sm rounded-full"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors duration-150 p-0.5"
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          className={cn(PRIMARY_PILL, 'whitespace-nowrap shrink-0 ml-auto sm:ml-0')}
          aria-label="New message"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New message</span>
          <span className="sm:hidden">New</span>
        </button>
      </div>

      {loading && (
        <ShimmerText
          messages={['Reading your inbox.', 'Catching up.']}
          className="block text-sm"
        />
      )}

      {!loading && errorMessage && (
        <Card>
          <CardContent className="p-5 space-y-2">
            <p className={BODY}>I couldn&apos;t reach your inbox just now.</p>
            <p className={BODY_MUTED}>{errorMessage}</p>
          </CardContent>
        </Card>
      )}

      {/* Cross-fade between filter/search datasets. The list inside is a
       *  stagger container; on filter or query change AnimatePresence swaps
       *  the whole list cleanly. The key includes the debounced query so
       *  search results get a fresh entrance. */}
      <AnimatePresence mode="wait" initial={false}>
        {!loading && !errorMessage && (
          <motion.div
            key={`feed-${filter}-${searchQuery}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_APPLE }}
          >
            {items.length === 0 ? (
              <EmptyFeed filter={filter} searchQuery={searchQuery} />
            ) : (
              <>
                <motion.ul
                  className="divide-y divide-border/60"
                  initial="initial"
                  animate="enter"
                  variants={{
                    initial: {},
                    enter: { transition: { staggerChildren: 0.03 } },
                  }}
                >
                  {items.map((it, idx) => (
                    <EmailRow
                      key={it.id}
                      item={it}
                      filter={filter}
                      /* Newly appended rows start their stagger fresh; the
                       *  initial batch staggers off the container above. */
                      appendDelay={
                        idx >= appendCursor && appendCursor > 0
                          ? (idx - appendCursor) * 0.03
                          : undefined
                      }
                      onOpen={() => handleRowOpen(it.id)}
                      onToggleStar={() => handleStarToggle(it.id, !it.starred)}
                    />
                  ))}
                </motion.ul>
                {nextPageToken && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className={cn(
                        GHOST_PILL,
                        'border border-border/70 transition-transform duration-150 active:scale-[0.98]',
                      )}
                    >
                      {loadingMore ? 'Loading…' : 'Load more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {noteOutlookReadPending && (
        <p className={cn(CAPTION, 'pt-2')}>
          Outlook reading is on the way. Connect Gmail to see your inbox.
        </p>
      )}

      <ComposeDialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        slug={slug}
        onSent={handleSent}
      />
    </div>
  );
}

function FilterChips({
  value,
  onChange,
}: {
  value: EmailFilter;
  onChange: (next: EmailFilter) => void;
}) {
  return (
    <div className="flex items-center gap-2 shrink-0" role="tablist" aria-label="Filter">
      {FILTERS.map((f, idx) => (
        <span key={f.key} className="flex items-center gap-2">
          {idx > 0 && <span className={BODY_MUTED}>·</span>}
          <button
            type="button"
            role="tab"
            aria-selected={value === f.key}
            onClick={() => onChange(f.key)}
            className={cn(
              'text-sm transition-colors duration-150',
              value === f.key
                ? 'text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        </span>
      ))}
    </div>
  );
}

/** Star icon with a one-shot scale pulse when the value transitions
 *  false → true (the moment the realtor stars something). Unstarring
 *  is intentionally quiet — the row already lost amber, that's feedback
 *  enough. First paint never pulses; only an in-session toggle does. */
function StarPulse({
  starred,
  size = 15,
  className,
}: {
  starred: boolean;
  size?: number;
  className?: string;
}) {
  const prevRef = useRef(starred);
  const pulse = !prevRef.current && starred;
  useEffect(() => {
    prevRef.current = starred;
  }, [starred]);
  return (
    <motion.span
      initial={false}
      animate={pulse ? { scale: [0.9, 1] } : { scale: 1 }}
      transition={{ duration: 0.18, ease: EASE_APPLE }}
      className="inline-flex"
    >
      <Star size={size} strokeWidth={1.75} className={className} />
    </motion.span>
  );
}

function EmailRow({
  item,
  filter,
  appendDelay,
  onOpen,
  onToggleStar,
}: {
  item: EmailListItem;
  filter: EmailFilter;
  /** When set, this row entered via "Load more" and stagger off its own
   *  delay rather than the parent container's staggerChildren. */
  appendDelay?: number;
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  // For Sent: show the recipient, not the realtor themselves.
  const isSent = filter === 'sent';
  const displayName = isSent
    ? item.toName || item.toAddress || '(no recipient)'
    : item.fromName || item.fromAddress || '(unknown sender)';
  const displayAddress = isSent ? item.toAddress : item.fromAddress;

  // Item entrance: 8px slide-up + fade. EASE_APPLE for the calm settle.
  // When this is a load-more row, override the parent container's stagger
  // with our own incremental delay.
  const itemVariants =
    appendDelay !== undefined
      ? {
          initial: { opacity: 0, y: 8 },
          enter: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.24, ease: EASE_APPLE, delay: appendDelay },
          },
        }
      : {
          initial: { opacity: 0, y: 8 },
          enter: {
            opacity: 1,
            y: 0,
            transition: { duration: 0.24, ease: EASE_APPLE },
          },
        };

  return (
    <motion.li
      className="group/row"
      variants={itemVariants}
      initial={appendDelay !== undefined ? 'initial' : undefined}
      animate={appendDelay !== undefined ? 'enter' : undefined}
    >
      <div className="flex items-start gap-3 py-3">
        {/* Unread dot — left rail. Tiny but earned by being the only thing
            that pulls the eye to a new row. */}
        <span className="w-1.5 shrink-0 pt-2.5 flex items-center justify-center">
          <span
            className={cn(
              'block w-1.5 h-1.5 rounded-full transition-colors',
              item.unread ? 'bg-foreground' : 'bg-transparent',
            )}
            aria-hidden
          />
        </span>

        <button
          type="button"
          onClick={onOpen}
          className="flex-1 min-w-0 text-left hover:bg-foreground/[0.02] transition-all duration-150 -my-1 py-1 rounded-sm hover:-translate-y-px active:scale-[0.98] active:translate-y-0"
        >
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-sm truncate',
                item.unread
                  ? 'font-semibold text-foreground'
                  : 'text-foreground',
              )}
            >
              {displayName}
            </span>
            {displayAddress && displayAddress !== displayName && (
              <span className={cn(CAPTION, 'truncate min-w-0')}>
                {displayAddress}
              </span>
            )}
          </div>
          <p className={cn(CAPTION, 'mt-0.5 truncate')}>
            {item.subject ? (
              <>
                <span
                  className={cn(
                    item.unread ? 'text-foreground' : 'text-foreground/80',
                  )}
                >
                  {item.subject}
                </span>
                {item.snippet ? <span> — {item.snippet}</span> : null}
              </>
            ) : (
              item.snippet || ''
            )}
          </p>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          aria-label={item.starred ? 'Unstar' : 'Star'}
          className={cn(
            'shrink-0 p-1 -m-1 rounded-md transition-opacity duration-150',
            item.starred
              ? 'opacity-100'
              : 'opacity-100 md:opacity-0 md:group-hover/row:opacity-100',
          )}
        >
          <StarPulse
            starred={item.starred}
            className={cn(
              'transition-colors duration-200',
              item.starred
                ? 'fill-amber-500 text-amber-500'
                : 'text-muted-foreground hover:text-foreground',
            )}
            size={15}
          />
        </button>

        <span className={cn(META, 'shrink-0 pt-1 tabular-nums')}>
          {formatRelative(item.sentAt)}
        </span>
      </div>
    </motion.li>
  );
}

function EmptyFeed({ filter, searchQuery }: { filter: EmailFilter; searchQuery: string }) {
  if (searchQuery) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 py-12 px-6 flex flex-col items-center text-center">
        <div className="mb-3 w-10 h-10 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
          <Search size={16} strokeWidth={1.75} className="text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">No results.</p>
        <p className="mt-1 text-[13px] text-muted-foreground max-w-[280px] leading-relaxed">
          Nothing matched that search. Try a different term.
        </p>
      </div>
    );
  }
  const title =
    filter === 'starred'
      ? 'Nothing starred yet.'
      : filter === 'sent'
        ? 'Nothing sent yet.'
        : 'Inbox is quiet.';
  return (
    <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 py-12 px-6 flex flex-col items-center text-center">
      <div className="mb-3 w-10 h-10 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
        <Mail size={16} strokeWidth={1.75} className="text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-[13px] text-muted-foreground max-w-[280px] leading-relaxed">
        Anything new will land here.
      </p>
    </div>
  );
}

function DisconnectedState({ slug }: { slug: string }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-9 h-9 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
            <Mail size={16} strokeWidth={1.75} className="text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <p className={BODY}>
              Bring your email here so the day&apos;s threads live in one place.
            </p>
            <p className={BODY_MUTED}>Gmail is the fast path.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/s/${slug}/integrations`}
            className={PRIMARY_PILL}
            aria-label="Connect email"
          >
            <Plug className="h-4 w-4" />
            Connect email
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Compose dialog ────────────────────────────────────────────────── */

function ComposeDialog({
  open,
  onClose,
  slug,
  onSent,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  onSent: () => void;
  initial?: {
    to?: string;
    subject?: string;
    body?: string;
  };
}) {
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTo(initial?.to ?? '');
    setCc('');
    setSubject(initial?.subject ?? '');
    setBody(initial?.body ?? '');
    setErrorMessage(null);
    setSending(false);
  }, [open, initial?.to, initial?.subject, initial?.body]);

  const handleSend = useCallback(async () => {
    setSending(true);
    setErrorMessage(null);
    try {
      const payload: Record<string, unknown> = { slug, to, subject, body };
      if (cc.trim()) payload.cc = cc;
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || 'That didn’t go through.');
      }
      onSent();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'That didn’t go through.',
      );
    } finally {
      setSending(false);
    }
  }, [body, cc, onSent, slug, subject, to]);

  const canSubmit = useMemo(() => {
    if (sending) return false;
    if (!to.trim()) return false;
    if (!subject.trim()) return false;
    if (!body.trim()) return false;
    return true;
  }, [body, sending, subject, to]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* Compose entrance — Apple subtlety:
       *  - Mobile: slide-up from bottom + fade (sheet-feel without a sheet).
       *  - Desktop: scale 0.98 → 1 + fade, 200ms.
       *  Overrides the shadcn defaults (zoom-in-95) to land at the spec. */}
      <DialogContent
        className={cn(
          'sm:max-w-xl duration-200',
          'data-[state=open]:zoom-in-[0.98] data-[state=closed]:zoom-out-[0.98]',
          'data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4',
          'sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=closed]:slide-out-to-bottom-0',
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-medium text-foreground">
            New message
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email-to" className={SECTION_LABEL}>
              To
            </Label>
            <Input
              id="email-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@email.com"
              disabled={sending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email-cc" className={SECTION_LABEL}>
              Cc{' '}
              <span className="font-normal lowercase tracking-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="email-cc"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="name@email.com"
              disabled={sending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email-subject" className={SECTION_LABEL}>
              Subject
            </Label>
            <Input
              id="email-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              disabled={sending}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="email-body" className={SECTION_LABEL}>
              Message
            </Label>
            <Textarea
              id="email-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
              rows={8}
              disabled={sending}
              className="resize-none"
            />
          </div>

          {errorMessage && (
            <p className="text-xs text-destructive">{errorMessage}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className={cn(GHOST_PILL)}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSubmit}
              className={cn(PRIMARY_PILL, 'disabled:opacity-50')}
            >
              <Send className="h-4 w-4" />
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Exposed so the read page can reuse the same compose modal. */
export { ComposeDialog as EmailComposeDialog };

/** Exposed so the read page can reuse the same star pulse. */
export { StarPulse as EmailStarPulse };
