'use client';

/**
 * /s/[slug]/calendar — the realtor's calendar, here.
 *
 * Chippi doesn't own a calendar. The realtor already lives in Google
 * Calendar (or Outlook); this surface mirrors what's there AND lets
 * them add events that write THROUGH to the same calendar.
 *
 * Four views — Month (default), Week, Day, Agenda — backed by the
 * same /api/calendar/events GET. View mode persists per slug in
 * localStorage so the realtor's preferred lens sticks.
 *
 * Three connection states still hold:
 *   1. Not connected → calm prompt, one primary action (connect).
 *   2. Connected, events present → render in the selected view.
 *   3. Connected, no events in window → Month/Week/Day still render
 *      their grids (empty days are useful — tap to add); Agenda shows
 *      the "Quiet stretch" empty state.
 *
 * Manual add: + New event in the header always opens the modal;
 * tapping an empty Day/Week slot pre-fills the date+time; tapping a
 * Month cell opens that day in Day view, where empty slots are the
 * tappable surface. Save → POST /api/calendar/events → optimistic
 * splice into the visible view + toast.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Variants } from 'framer-motion';
import { ChevronLeft, ChevronRight, ExternalLink, Calendar as CalendarIcon, Plug, Plus, RotateCcw, Search, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  BODY,
  SECTION_LABEL,
  PRIMARY_PILL,
  GHOST_PILL,
  META,
  CAPTION,
} from '@/lib/typography';
import {
  addDays,
  addMonths,
  localDayKey,
  monthGridDays,
  parseLocalDayKey,
  startOfLocalDay,
  startOfMonth,
  weekDays,
} from '@/lib/calendar/date';

/* ── Motion constants ───────────────────────────────────────────────── */
/* Apple-ish curve everywhere: [0.22, 1, 0.36, 1]. No springs, no overshoot
 * beyond 1.02. Durations sit in 180–260ms — fast enough to feel
 * instantaneous, slow enough to read as deliberate. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const DUR_QUICK = 0.18; // view crossfade, chevron press, chip enter
const DUR_PRESS = 0.18; // chip tap scale-down
const DUR_PULSE = 0.2; // time-slot ring pulse before modal
const DUR_RING = 0.24; // today's-ring glow on mount + optimistic chip enter

/* Row-stagger for the month grid: 40ms BETWEEN ROWS (not cells). Six rows
 * → 240ms sweep total. The whole grid lands before the eye finishes
 * tracking it. Per-cell delay is `row * STAGGER_ROW_DELAY`. */
const STAGGER_ROW_DELAY = 0.04;
const MONTH_CELL_VARIANTS: Variants = {
  initial: { opacity: 0, y: 4 },
  enter: (row: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: DUR_QUICK, ease: EASE, delay: row * STAGGER_ROW_DELAY },
  }),
};

/* Chip enter (default): fade + 4px slide-down. Reused across Month/Week/Day. */
const CHIP_ENTER_VARIANTS: Variants = {
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR_QUICK, ease: EASE } },
};

/* Chip enter (optimistic, just-created by the realtor): scale 0.95 → 1 +
 * fade. The slight pop tells the realtor "your event landed" without
 * shouting. 240ms with the Apple curve. */
const CHIP_OPTIMISTIC_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1, transition: { duration: DUR_RING, ease: EASE } },
};

interface CalendarEventOut {
  id: string;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string | null;
  attendees: { email: string; name: string | null; responseStatus: string | null }[];
  /**
   * Client-only marker — set true when the realtor just created this event
   * locally. Drives the optimistic "scale 0.95 → 1 + fade" entrance on the
   * chip. Cleared after the animation lands (we don't ship it to the API).
   */
  __justCreated?: boolean;
}

interface ConnectedPayload {
  connected: true;
  provider: string;
  events: CalendarEventOut[];
}

interface NotConnectedPayload {
  connected: false;
}

type FetchPayload = ConnectedPayload | NotConnectedPayload;

interface CalendarViewProps {
  slug: string;
  initialConnected: boolean;
  initialProvider: string | null;
}

type ViewMode = 'month' | 'week' | 'day' | 'agenda';
const VIEW_MODES: ViewMode[] = ['month', 'week', 'day', 'agenda'];

function isViewMode(v: string | null): v is ViewMode {
  return v === 'month' || v === 'week' || v === 'day' || v === 'agenda';
}

function viewStorageKey(slug: string) {
  return `chippi:calendar:view:${slug}`;
}

function providerLabel(provider: string | null): string {
  if (provider === 'googlecalendar') return 'Google Calendar';
  if (provider === 'outlook_calendar') return 'Outlook Calendar';
  return 'your calendar';
}

function formatTimeRange(start: string, end: string, allDay: boolean): string {
  if (allDay) return 'All day';
  const fmt: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
  return `${new Date(start).toLocaleTimeString(undefined, fmt)} — ${new Date(end).toLocaleTimeString(undefined, fmt)}`;
}

function shortEventLabel(ev: CalendarEventOut): string {
  if (ev.allDay) return ev.title;
  const d = new Date(ev.start);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'p' : 'a';
  const hour12 = ((h + 11) % 12) + 1;
  const time = m === 0 ? `${hour12}${ampm}` : `${hour12}:${String(m).padStart(2, '0')}${ampm}`;
  return `${time} ${ev.title}`;
}

function eventsForDayKey(events: CalendarEventOut[], key: string): CalendarEventOut[] {
  return events
    .filter((ev) => localDayKey(new Date(ev.start)) === key)
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

const HOUR_START = 6; // 6am
const HOUR_END = 21; // 9pm (inclusive label, exclusive bound for math)
const HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

export function CalendarView({
  slug,
  initialConnected,
  initialProvider,
}: CalendarViewProps) {
  const [connected, setConnected] = useState(initialConnected);
  const [provider, setProvider] = useState<string | null>(initialProvider);
  const [events, setEvents] = useState<CalendarEventOut[]>([]);
  const [loading, setLoading] = useState(initialConnected);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // View mode — defaults to Month; rehydrate from localStorage post-mount
  // so SSR-and-hydration agree (we can't read localStorage on the server).
  const [view, setView] = useState<ViewMode>('month');

  // Mobile flag — Tailwind `sm:` breakpoint is 640px. Drives the auto-switch
  // to Day on first paint AND the header compression. We track via
  // matchMedia + a listener so rotating a phone updates the layout.
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(viewStorageKey(slug));
      // On mobile, Month/Week are unusable in the 640px column — auto-fall
      // back to Day on first paint. We do NOT persist this override: if the
      // realtor explicitly taps Month/Week later, that intent sticks.
      const mobile = window.innerWidth < 640;
      if (mobile && (!stored || stored === 'month' || stored === 'week')) {
        setView('day');
        return;
      }
      if (isViewMode(stored)) setView(stored);
    } catch {
      // localStorage unavailable (private mode, SSR edge); fall back to default.
    }
  }, [slug]);
  const setViewPersisted = useCallback(
    (next: ViewMode) => {
      setView(next);
      try {
        window.localStorage.setItem(viewStorageKey(slug), next);
      } catch {
        /* noop */
      }
    },
    [slug],
  );

  // The grid's focal date — drives Month/Week/Day cursors. Today on mount.
  const [cursor, setCursor] = useState<Date>(() => startOfLocalDay(new Date()));

  // Search query — client-side filter of loaded events. Empty = normal view.
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Add-event modal state.
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPrefill, setModalPrefill] = useState<{ date: Date; hour?: number } | null>(null);

  const openAddModal = useCallback((date: Date, hour?: number) => {
    setModalPrefill({ date, hour });
    setModalOpen(true);
  }, []);

  // Fetch on connect. Same shape as before.
  useEffect(() => {
    if (!connected) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    fetch(`/api/calendar/events?slug=${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const data = (await res.json()) as FetchPayload;
        if (cancelled) return;
        if (!data.connected) {
          setConnected(false);
          setProvider(null);
          setEvents([]);
          return;
        }
        setProvider(data.provider);
        setEvents(data.events);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message || 'Could not reach your calendar.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, slug]);

  // Splice the created event into local state — optimistic, no refetch.
  // Tag with __justCreated so the chip can enter with scale 0.95 → 1 + fade.
  // We strip the flag ~400ms later so subsequent re-renders don't replay it.
  const handleEventCreated = useCallback((ev: CalendarEventOut) => {
    const stamped: CalendarEventOut = { ...ev, __justCreated: true };
    setEvents((curr) => [...curr, stamped]);
    window.setTimeout(() => {
      setEvents((curr) =>
        curr.map((e) => (e.id === ev.id ? { ...e, __justCreated: false } : e)),
      );
    }, 400);
  }, []);

  // For Month/Week cursors that need to step.
  const goPrev = useCallback(() => {
    setCursor((c) => {
      if (view === 'month') return addMonths(c, -1);
      if (view === 'week') return addDays(c, -7);
      if (view === 'day') return addDays(c, -1);
      return c;
    });
  }, [view]);
  const goNext = useCallback(() => {
    setCursor((c) => {
      if (view === 'month') return addMonths(c, 1);
      if (view === 'week') return addDays(c, 7);
      if (view === 'day') return addDays(c, 1);
      return c;
    });
  }, [view]);
  const goToday = useCallback(() => setCursor(startOfLocalDay(new Date())), []);

  const headerLabel = useMemo(() => {
    if (view === 'month') {
      // Mobile: "May 2026" → "May" (year is implicit from cursor + Today nudge).
      return cursor.toLocaleDateString(undefined, {
        month: 'long',
        year: isMobile ? undefined : 'numeric',
      });
    }
    if (view === 'week') {
      const start = weekDays(cursor)[0];
      const end = weekDays(cursor)[6];
      const sameMonth = start.getMonth() === end.getMonth();
      const monthFmt: Intl.DateTimeFormatOptions = { month: 'short' };
      // Mobile: collapse the range to "Week of May 31" — saves ~10ch.
      if (isMobile) {
        return `Week of ${start.toLocaleDateString(undefined, monthFmt)} ${start.getDate()}`;
      }
      if (sameMonth) {
        return `${start.toLocaleDateString(undefined, monthFmt)} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
      }
      return `${start.toLocaleDateString(undefined, monthFmt)} ${start.getDate()} – ${end.toLocaleDateString(undefined, monthFmt)} ${end.getDate()}, ${end.getFullYear()}`;
    }
    if (view === 'day') {
      // Mobile: drop the year + use short weekday so it fits beside the chevrons.
      if (isMobile) {
        return cursor.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      }
      return cursor.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }
    return 'Next 30 days';
  }, [cursor, view, isMobile]);

  // Width: month/week need more room than the reading column.
  const wide = view === 'month' || view === 'week';

  return (
    <div className="h-full overflow-y-auto">
      <div
        className={cn(
          // Bottom padding clears the mobile chat bar (~90px) + the floating
          // bottom nav (~90px) — without it the last week of the month grid
          // disappears behind that chrome. Desktop has neither, so pb-24 is
          // enough above the safe-area inset.
          'w-full mx-auto chat-content-wrap pt-10 sm:pt-14 pb-56 md:pb-24 space-y-8',
          wide ? 'max-w-6xl' : 'max-w-3xl',
        )}
      >
        <header className="space-y-1.5">
          <p className={BODY_MUTED}>Calendar.</p>
          <h1 className={H1} style={TITLE_FONT}>
            Your calendar, in here.
          </h1>
          <p className={BODY_MUTED}>
            {connected
              ? `Reading from ${providerLabel(provider)}.`
              : 'Connect your calendar so I can see your day and put tours on it.'}
          </p>
        </header>

        {!connected && <NotConnectedState slug={slug} />}

        {connected && (
          <ToggleRow
            view={view}
            onViewChange={setViewPersisted}
            headerLabel={headerLabel}
            showNav={view !== 'agenda'}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
            onAdd={() => openAddModal(startOfLocalDay(new Date()))}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchInputRef={searchInputRef}
          />
        )}

        {connected && loading && (
          <p className={BODY_MUTED}>One moment — pulling your events.</p>
        )}

        {connected && !loading && errorMessage && (
          <Card>
            <CardContent className="p-5 space-y-2">
              <p className={BODY}>I couldn&apos;t reach your calendar just now.</p>
              <p className={BODY_MUTED}>{errorMessage}</p>
            </CardContent>
          </Card>
        )}

        {connected && !loading && !errorMessage && (
          // Cross-fade the body when the realtor flips Month/Week/Day/Agenda,
          // or when entering/leaving search mode.
          // 180ms with the Apple ease — no jump-cut, no slide. The key
          // changes on view or searchQuery so each state gets a clean entrance.
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={searchQuery ? `search-${searchQuery}` : view}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR_QUICK, ease: EASE }}
            >
              {searchQuery ? (
                <SearchResultsView events={events} query={searchQuery} />
              ) : (
                <>
                  {view === 'month' && (
                    <MonthView
                      cursor={cursor}
                      events={events}
                      onCellTap={(day) => {
                        setCursor(day);
                        setViewPersisted('day');
                      }}
                    />
                  )}
                  {view === 'week' && (
                    <WeekView
                      cursor={cursor}
                      events={events}
                      onSlotTap={(day, hour) => openAddModal(day, hour)}
                    />
                  )}
                  {view === 'day' && (
                    <DayView
                      cursor={cursor}
                      events={events}
                      onSlotTap={(hour) => openAddModal(cursor, hour)}
                    />
                  )}
                  {view === 'agenda' && <AgendaView events={events} />}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {connected && (
          <AddEventModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            prefill={modalPrefill}
            slug={slug}
            onCreated={handleEventCreated}
            isMobile={isMobile}
          />
        )}
      </div>
    </div>
  );
}

/* ── Toggle row ─────────────────────────────────────────────────────── */

function ToggleRow({
  view,
  onViewChange,
  headerLabel,
  showNav,
  onPrev,
  onNext,
  onToday,
  onAdd,
  searchQuery,
  onSearchChange,
  searchInputRef,
}: {
  view: ViewMode;
  onViewChange: (next: ViewMode) => void;
  headerLabel: string;
  showNav: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onAdd: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  // Two stacked rows on mobile (toggle then nav+add); single row on `sm:+`.
  // The label has a tight floor on mobile (110px) so the chevrons stay
  // anchored even on a 320px viewport without the row wrapping mid-control.
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:flex-wrap">
      <div
        role="tablist"
        aria-label="Calendar view"
        className="inline-flex self-start items-center rounded-full border border-border/70 p-0.5"
      >
        {VIEW_MODES.map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={view === m}
            onClick={() => onViewChange(m)}
            className={cn(
              'h-7 rounded-full text-[11px] font-medium uppercase tracking-wider transition-colors duration-150',
              'px-2.5 sm:px-3',
              view === m
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 sm:gap-3 sm:ml-auto flex-wrap">
        {/* Search input — always visible at rest (DOET check 1). Escape
         *  clears the query and returns to the current view. */}
        <div className="relative flex-1 min-w-[140px] sm:min-w-[200px] max-w-[260px]">
          <Search
            size={14}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <Input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onSearchChange('');
                searchInputRef.current?.blur();
              }
            }}
            placeholder="Search events"
            aria-label="Search events"
            className="pl-8 pr-8 h-8 text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                onSearchChange('');
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground transition-colors duration-150 p-0.5"
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>

        {showNav && (
          <div className="flex items-center gap-1 min-w-0">
            {/* Chevron press: 10° tilt on press, snap back. 180ms each leg.
             * The press rotation gives the chrome a tactile beat — the
             * realtor feels the calendar step instead of just seeing it. */}
            <motion.button
              type="button"
              onClick={onPrev}
              whileTap={{ rotate: -10 }}
              transition={{ duration: DUR_PRESS, ease: EASE }}
              className="h-8 w-8 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 shrink-0"
              aria-label="Previous"
            >
              <ChevronLeft size={16} strokeWidth={1.75} />
            </motion.button>
            <span
              className={cn(
                BODY,
                'text-center truncate min-w-[110px] sm:min-w-[180px]',
              )}
            >
              {headerLabel}
            </span>
            <motion.button
              type="button"
              onClick={onNext}
              whileTap={{ rotate: 10 }}
              transition={{ duration: DUR_PRESS, ease: EASE }}
              className="h-8 w-8 rounded-full inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150 shrink-0"
              aria-label="Next"
            >
              <ChevronRight size={16} strokeWidth={1.75} />
            </motion.button>
            <button
              type="button"
              onClick={onToday}
              className={cn(
                GHOST_PILL,
                'shrink-0',
                // Icon-only on mobile (RotateCcw = jump back to today);
                // text label re-appears at `sm:+`.
                'h-8 w-8 px-0 sm:h-7 sm:w-auto sm:px-3 sm:text-xs',
              )}
              aria-label="Today"
              title="Today"
            >
              <RotateCcw size={14} strokeWidth={1.75} className="sm:hidden" />
              <span className="hidden sm:inline">Today</span>
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={onAdd}
          className={cn(
            PRIMARY_PILL,
            'whitespace-nowrap shrink-0 ml-auto sm:ml-0',
            // Smallest screens: icon-only "+" (40px square). Names appear
            // progressively as room allows.
            'h-9 w-9 px-0 sm:w-auto sm:px-4',
          )}
          aria-label="New event"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">New event</span>
        </button>
      </div>
    </div>
  );
}

/* ── Month view ─────────────────────────────────────────────────────── */

function MonthView({
  cursor,
  events,
  onCellTap,
}: {
  cursor: Date;
  events: CalendarEventOut[];
  onCellTap: (day: Date) => void;
}) {
  const reduced = useReducedMotion();
  const days = useMemo(() => monthGridDays(cursor), [cursor]);
  const monthIndex = startOfMonth(cursor).getMonth();
  const todayKey = localDayKey(new Date());
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventOut[]>();
    for (const ev of events) {
      const k = localDayKey(new Date(ev.start));
      const arr = map.get(k) ?? [];
      arr.push(ev);
      map.set(k, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
    return map;
  }, [events]);

  const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // On mobile, the 7-col grid would crush every cell to ~55px — chips render
  // as "C…" or "Or…". We give the grid a 630px floor (90px × 7) and let the
  // outer container scroll horizontally. At `sm:+` (≥640px viewport), the
  // overflow context goes away entirely so the grid fills naturally and any
  // future sticky behavior anchors to the page scroll like before.
  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      <div className="overflow-x-auto sm:overflow-visible">
        <div className="min-w-[630px] sm:min-w-0">
          <div className="grid grid-cols-7 border-b border-border/60 bg-muted/20">
            {weekdayLabels.map((w) => (
              <div key={w} className={cn(SECTION_LABEL, 'px-3 py-2 text-left')}>
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 grid-rows-6">
            {days.map((day, i) => {
              const key = localDayKey(day);
              const isCurrentMonth = day.getMonth() === monthIndex;
              const isToday = key === todayKey;
              const row = Math.floor(i / 7);
              const dayEvents = eventsByDay.get(key) ?? [];
              const visible = dayEvents.slice(0, 3);
              const overflow = dayEvents.length - visible.length;
              // Hairline border between cells — top and left borders so the
              // outer frame doesn't double up.
              const borderRules = cn(
                i >= 7 ? 'border-t border-border/60' : '',
                i % 7 !== 0 ? 'border-l border-border/60' : '',
              );
              return (
                // Row-stagger entrance: each row of seven cells lands 40ms
                // after the previous row. Whole sweep finishes in 240ms.
                // `reduced` collapses to a flat fade-in so the visual still
                // settles, just without the directional sweep.
                <motion.button
                  key={key + i}
                  type="button"
                  onClick={() => onCellTap(day)}
                  custom={row}
                  variants={
                    reduced
                      ? {
                          initial: { opacity: 0 },
                          enter: { opacity: 1, transition: { duration: DUR_QUICK } },
                        }
                      : MONTH_CELL_VARIANTS
                  }
                  initial="initial"
                  animate="enter"
                  className={cn(
                    'min-h-[96px] text-left p-2 hover:bg-muted/30 transition-colors duration-150 flex flex-col gap-1',
                    borderRules,
                  )}
                >
                  {/* Day-number badge. The today-ring is a separately
                   * animated overlay — 240ms opacity glow on mount. If the
                   * realtor lands on the month and today already has a
                   * ring, we want it to feel like it's lighting up, not
                   * sitting there static. */}
                  <span
                    className={cn(
                      'relative inline-flex items-center justify-center h-6 w-6 rounded-full text-xs tabular-nums',
                      isCurrentMonth ? 'text-foreground' : 'text-muted-foreground/50',
                    )}
                  >
                    {isToday && (
                      <motion.span
                        aria-hidden
                        initial={reduced ? { opacity: 1 } : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: DUR_RING, ease: EASE }}
                        className="absolute inset-0 rounded-full ring-1 ring-foreground/30"
                      />
                    )}
                    <span className="relative">{day.getDate()}</span>
                  </span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    {visible.map((ev) => (
                      <ChipInCell key={ev.id} event={ev} reduced={!!reduced} />
                    ))}
                    {overflow > 0 && (
                      <span className={cn(CAPTION, 'truncate px-1.5')}>+{overflow} more</span>
                    )}
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Month/Week chip ────────────────────────────────────────────────── */
/* The short-label chip rendered inside a month cell or week slot.
 * Default enter: fade + 4px slide-down (CHIP_ENTER_VARIANTS).
 * Optimistic enter (`__justCreated` true): scale 0.95 → 1 + fade.
 * Tap: subtle scale 0.97 press, snap back. Apple curve, 180ms.
 *
 * `stopPropagation` is passed by the Week view so chip taps don't
 * bubble up and pop the add-event modal. Month view leaves it false —
 * the whole cell is one tap target there, and a chip-tap should
 * follow the cell-tap into Day view. */
function ChipInCell({
  event,
  reduced,
  stopPropagation = false,
  labelMode = 'short',
}: {
  event: CalendarEventOut;
  reduced: boolean;
  stopPropagation?: boolean;
  /** `short` = "9a Tour" (Month — time prefix matters). `title` = "Tour"
   *  (Week/Day — hour slot already carries the time). */
  labelMode?: 'short' | 'title';
}) {
  const variants = event.__justCreated ? CHIP_OPTIMISTIC_VARIANTS : CHIP_ENTER_VARIANTS;
  const label = labelMode === 'short' ? shortEventLabel(event) : event.title;
  return (
    <motion.span
      initial={reduced ? false : 'initial'}
      animate={reduced ? { opacity: 1 } : 'animate'}
      variants={reduced ? undefined : variants}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={reduced ? undefined : { duration: DUR_PRESS, ease: EASE }}
      className="text-[11px] truncate rounded bg-muted/40 px-1.5 py-0.5 text-foreground"
      title={event.title}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
    >
      {label}
    </motion.span>
  );
}

/* ── Week view ──────────────────────────────────────────────────────── */

function WeekView({
  cursor,
  events,
  onSlotTap,
}: {
  cursor: Date;
  events: CalendarEventOut[];
  onSlotTap: (day: Date, hour: number) => void;
}) {
  const reduced = useReducedMotion();
  const days = useMemo(() => weekDays(cursor), [cursor]);
  const todayKey = localDayKey(new Date());
  // Tap → ring-pulse → modal. The pulse is a 200ms confirmation that the
  // tap landed. We hold the modal-open call back briefly (~140ms) so the
  // pulse reads as a distinct beat rather than a flicker swallowed by
  // the modal entrance. The two animations then overlap on the tail end.
  const [pulseSlot, setPulseSlot] = useState<string | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    },
    [],
  );
  const handleSlotTap = useCallback(
    (d: Date, hour: number) => {
      if (reduced) {
        onSlotTap(d, hour);
        return;
      }
      const k = `${localDayKey(d)}-${hour}`;
      setPulseSlot(k);
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = window.setTimeout(() => setPulseSlot(null), DUR_PULSE * 1000);
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => onSlotTap(d, hour), 140);
    },
    [onSlotTap, reduced],
  );
  // Min-width 694px = 64px gutter + 7 × 90px columns so events have room
  // for at least 8-9 characters of title before truncating. The outer
  // container scrolls horizontally on narrow viewports; at `sm:+` the
  // overflow context dissolves so the sticky day header keeps anchoring
  // to the page scroll like it always did on desktop.
  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      <div className="overflow-x-auto sm:overflow-visible">
        <div className="min-w-[694px] sm:min-w-0">
          <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))] border-b border-border/60 bg-muted/20 sticky top-0 z-10">
            <div />
            {days.map((d) => {
              const key = localDayKey(d);
              const isToday = key === todayKey;
              return (
                <div key={key} className="px-2 py-2">
                  <p className={cn(SECTION_LABEL)}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</p>
                  <span
                    className={cn(
                      'relative text-sm tabular-nums mt-0.5 inline-flex items-center justify-center h-6 w-6 rounded-full',
                    )}
                  >
                    {isToday && (
                      <motion.span
                        aria-hidden
                        initial={reduced ? { opacity: 1 } : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: DUR_RING, ease: EASE }}
                        className="absolute inset-0 rounded-full ring-1 ring-foreground/30"
                      />
                    )}
                    <span className="relative">{d.getDate()}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-[64px_repeat(7,minmax(0,1fr))]">
            {HOURS.map((hour) => (
              <HourRow
                key={hour}
                hour={hour}
                days={days}
                events={events}
                onSlotTap={handleSlotTap}
                pulseSlot={pulseSlot}
                reduced={!!reduced}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function HourRow({
  hour,
  days,
  events,
  onSlotTap,
  pulseSlot,
  reduced,
}: {
  hour: number;
  days: Date[];
  events: CalendarEventOut[];
  onSlotTap: (day: Date, hour: number) => void;
  pulseSlot: string | null;
  reduced: boolean;
}) {
  return (
    <>
      <div className="border-t border-border/60 px-2 py-1.5 text-right">
        <span className={META}>{formatHourLabel(hour)}</span>
      </div>
      {days.map((d) => {
        const key = localDayKey(d);
        const slotKey = `${key}-${hour}`;
        const isPulsing = pulseSlot === slotKey;
        const slotEvents = eventsForDayKey(events, key).filter((ev) => {
          if (ev.allDay) return hour === HOUR_START; // pin all-day to first row
          return new Date(ev.start).getHours() === hour;
        });
        return (
          <button
            key={slotKey}
            type="button"
            onClick={() => onSlotTap(d, hour)}
            className="relative border-t border-l border-border/60 min-h-[44px] hover:bg-muted/30 transition-colors duration-150 text-left p-1 flex flex-col gap-0.5"
          >
            {/* Ring-pulse on tap confirms the gesture landed before the
             * modal arrives. Fades out after DUR_PULSE so the modal's
             * own entrance picks up the eye. */}
            {isPulsing && !reduced && (
              <motion.span
                aria-hidden
                initial={{ opacity: 0.55 }}
                animate={{ opacity: 0 }}
                transition={{ duration: DUR_PULSE, ease: EASE }}
                className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-foreground/30"
              />
            )}
            {slotEvents.map((ev) => (
              <ChipInCell
                key={ev.id}
                event={ev}
                reduced={reduced}
                stopPropagation
                labelMode="title"
              />
            ))}
          </button>
        );
      })}
    </>
  );
}

function formatHourLabel(hour: number): string {
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}${ampm}`;
}

/* ── Day view ───────────────────────────────────────────────────────── */

function DayView({
  cursor,
  events,
  onSlotTap,
}: {
  cursor: Date;
  events: CalendarEventOut[];
  onSlotTap: (hour: number) => void;
}) {
  const reduced = useReducedMotion();
  const key = localDayKey(cursor);
  const dayEvents = eventsForDayKey(events, key);
  const allDayEvents = dayEvents.filter((ev) => ev.allDay);
  // Same pulse-before-modal pattern as WeekView, scoped to a single hour
  // since the Day view's slot key is just the hour number.
  const [pulseHour, setPulseHour] = useState<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
    },
    [],
  );
  const handleSlotTap = useCallback(
    (hour: number) => {
      if (reduced) {
        onSlotTap(hour);
        return;
      }
      setPulseHour(hour);
      if (pulseTimerRef.current !== null) window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = window.setTimeout(() => setPulseHour(null), DUR_PULSE * 1000);
      if (openTimerRef.current !== null) window.clearTimeout(openTimerRef.current);
      openTimerRef.current = window.setTimeout(() => onSlotTap(hour), 140);
    },
    [onSlotTap, reduced],
  );
  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      {allDayEvents.length > 0 && (
        <div className="border-b border-border/60 bg-muted/20 px-3 py-2 space-y-1">
          <p className={SECTION_LABEL}>All day</p>
          {allDayEvents.map((ev) => (
            <EventChip key={ev.id} event={ev} reduced={!!reduced} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-[72px_minmax(0,1fr)]">
        {HOURS.map((hour) => {
          const slotEvents = dayEvents.filter(
            (ev) => !ev.allDay && new Date(ev.start).getHours() === hour,
          );
          const isPulsing = pulseHour === hour;
          return (
            <div key={hour} className="contents">
              <div className="border-t border-border/60 px-3 py-2 text-right">
                <span className={META}>{formatHourLabel(hour)}</span>
              </div>
              <button
                type="button"
                onClick={() => handleSlotTap(hour)}
                className="relative border-t border-l border-border/60 min-h-[52px] hover:bg-muted/30 transition-colors duration-150 text-left p-2 flex flex-col gap-1"
              >
                {isPulsing && !reduced && (
                  <motion.span
                    aria-hidden
                    initial={{ opacity: 0.55 }}
                    animate={{ opacity: 0 }}
                    transition={{ duration: DUR_PULSE, ease: EASE }}
                    className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-foreground/30"
                  />
                )}
                {slotEvents.map((ev) => (
                  <EventChip key={ev.id} event={ev} reduced={!!reduced} />
                ))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventChip({ event, reduced }: { event: CalendarEventOut; reduced: boolean }) {
  const variants = event.__justCreated ? CHIP_OPTIMISTIC_VARIANTS : CHIP_ENTER_VARIANTS;
  const body = (
    <motion.span
      initial={reduced ? false : 'initial'}
      animate={reduced ? { opacity: 1 } : 'animate'}
      variants={reduced ? undefined : variants}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={reduced ? undefined : { duration: DUR_PRESS, ease: EASE }}
      className="block text-xs rounded bg-muted/40 px-2 py-1 text-foreground truncate"
      title={event.title}
    >
      <span className="font-medium">{event.title}</span>
      {!event.allDay && (
        <span className={cn(META, 'ml-2')}>
          {formatTimeRange(event.start, event.end, event.allDay)}
        </span>
      )}
    </motion.span>
  );
  if (event.htmlLink) {
    return (
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="block"
      >
        {body}
      </a>
    );
  }
  return body;
}

/* ── Search results view ─────────────────────────────────────────────── */
/* Client-side filter of the already-loaded 30-day event window. Matches
 * against title, location (description), and attendee emails/names — the
 * same fields a realtor would want to search. Renders as an Agenda-style
 * list so it reuses the same vocabulary without inventing a new surface. */

function matchesQuery(ev: CalendarEventOut, q: string): boolean {
  const lower = q.toLowerCase();
  if (ev.title.toLowerCase().includes(lower)) return true;
  if (ev.description && ev.description.toLowerCase().includes(lower)) return true;
  for (const a of ev.attendees) {
    if (a.email.toLowerCase().includes(lower)) return true;
    if (a.name && a.name.toLowerCase().includes(lower)) return true;
  }
  return false;
}

function SearchResultsView({ events, query }: { events: CalendarEventOut[]; query: string }) {
  const results = useMemo(
    () => events.filter((ev) => matchesQuery(ev, query))
           .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
    [events, query],
  );

  if (results.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
        <div className="mx-auto mb-3 w-10 h-10 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
          <Search size={16} strokeWidth={1.75} className="text-muted-foreground" />
        </div>
        <p className={BODY}>No events matched.</p>
        <p className={`${BODY_MUTED} mt-1`}>Try a different term.</p>
      </div>
    );
  }

  // Group by local day, same vocabulary as AgendaView.
  const grouped = new Map<string, CalendarEventOut[]>();
  for (const ev of results) {
    const key = localDayKey(new Date(ev.start));
    const arr = grouped.get(key) ?? [];
    arr.push(ev);
    grouped.set(key, arr);
  }
  const dayKeys = Array.from(grouped.keys()).sort();

  return (
    <div className="space-y-10">
      {dayKeys.map((dayKey) => (
        <section key={dayKey} className="space-y-3">
          <p className={SECTION_LABEL}>{formatDayHeading(dayKey)}</p>
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {grouped.get(dayKey)!.map((ev) => (
              <li key={ev.id} className="py-4">
                <EventRow event={ev} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ── Agenda view (preserves original list rendering) ────────────────── */

function AgendaView({ events }: { events: CalendarEventOut[] }) {
  // Group by local day so the page reads as a timeline.
  const grouped = new Map<string, CalendarEventOut[]>();
  for (const ev of events) {
    const key = localDayKey(new Date(ev.start));
    const arr = grouped.get(key) ?? [];
    arr.push(ev);
    grouped.set(key, arr);
  }
  const dayKeys = Array.from(grouped.keys()).sort();

  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
        <p className={BODY}>Nothing on the books in the next 30 days.</p>
        <p className={`${BODY_MUTED} mt-1`}>Quiet stretch.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {dayKeys.map((dayKey) => (
        <section key={dayKey} className="space-y-3">
          <p className={SECTION_LABEL}>{formatDayHeading(dayKey)}</p>
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {grouped.get(dayKey)!.map((ev) => (
              <li key={ev.id} className="py-4">
                <EventRow event={ev} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function formatDayHeading(dayKey: string): string {
  const eventDay = parseLocalDayKey(dayKey);
  const todayKey = localDayKey(new Date());
  if (dayKey === todayKey) return 'Today';
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = localDayKey(tomorrow);
  if (dayKey === tomorrowKey) return 'Tomorrow';
  return eventDay.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function EventRow({ event }: { event: CalendarEventOut }) {
  const others = event.attendees.filter((a) => a.email);
  const attendeeLine =
    others.length === 0
      ? null
      : others.length <= 2
        ? others.map((a) => a.name || a.email).join(', ')
        : `${others.length} people`;

  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1 min-w-0">
        <p className={`${BODY} font-medium truncate`}>{event.title}</p>
        <p className={META}>
          {formatTimeRange(event.start, event.end, event.allDay)}
          {attendeeLine && <span> &middot; with {attendeeLine}</span>}
        </p>
      </div>
      {event.htmlLink && (
        <ExternalLink
          size={14}
          strokeWidth={1.75}
          className="mt-0.5 text-muted-foreground shrink-0"
        />
      )}
    </div>
  );

  if (event.htmlLink) {
    return (
      <a
        href={event.htmlLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block hover:bg-muted/30 -mx-3 px-3 py-0.5 rounded transition-colors"
      >
        {body}
      </a>
    );
  }
  return body;
}

/* ── Not connected state (preserved) ────────────────────────────────── */

function NotConnectedState({ slug }: { slug: string }) {
  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 w-9 h-9 rounded-lg bg-foreground/[0.04] flex items-center justify-center shrink-0">
            <CalendarIcon size={16} strokeWidth={1.75} className="text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <p className={BODY}>
              Connect your calendar and I&apos;ll put tours on it, watch for
              conflicts, and pull your day into the brief.
            </p>
            <p className={BODY_MUTED}>
              Google Calendar is the fast path. Outlook works too.
            </p>
          </div>
        </div>
        <div>
          <Link href={`/s/${slug}/integrations`} className={PRIMARY_PILL}>
            <Plug className="h-4 w-4" />
            Connect calendar
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Add event modal ────────────────────────────────────────────────── */

function dateInputValue(d: Date): string {
  return localDayKey(d);
}

function timeInputValue(hour: number, minute = 0): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function AddEventModal({
  open,
  onClose,
  prefill,
  slug,
  onCreated,
  isMobile,
}: {
  open: boolean;
  onClose: () => void;
  prefill: { date: Date; hour?: number } | null;
  slug: string;
  onCreated: (ev: CalendarEventOut) => void;
  isMobile: boolean;
}) {
  // Initial values rebuild each time the modal opens so prefill applies.
  const initialDate = useMemo(() => prefill?.date ?? new Date(), [prefill]);
  const initialHour = prefill?.hour ?? 9; // sensible default for new events
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(dateInputValue(initialDate));
  const [endDate, setEndDate] = useState(dateInputValue(initialDate));
  const [startTime, setStartTime] = useState(timeInputValue(initialHour));
  const [endTime, setEndTime] = useState(timeInputValue(initialHour + 1));
  const [allDay, setAllDay] = useState(false);
  const [description, setDescription] = useState('');
  const [attendeesStr, setAttendeesStr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rehydrate fields when the modal re-opens with a new prefill.
  useEffect(() => {
    if (!open) return;
    const d = prefill?.date ?? new Date();
    const h = prefill?.hour ?? 9;
    setTitle('');
    setStartDate(dateInputValue(d));
    setEndDate(dateInputValue(d));
    setStartTime(timeInputValue(h));
    setEndTime(timeInputValue(h + 1));
    setAllDay(false);
    setDescription('');
    setAttendeesStr('');
    setError(null);
  }, [open, prefill]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError(null);

      const attendees = attendeesStr
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        slug,
        title,
        description: description.trim() || undefined,
        allDay,
        startDate,
        endDate,
        startTime: allDay ? undefined : startTime,
        endTime: allDay ? undefined : endTime,
        attendees,
      };

      setSubmitting(true);
      try {
        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data: { event?: CalendarEventOut; error?: string } = await res
          .json()
          .catch(() => ({}));
        if (!res.ok || !data.event) {
          const msg = data.error || `Could not save (${res.status}).`;
          setError(msg);
          toastError(msg);
          return;
        }
        onCreated(data.event);
        toastSuccess('Added to your calendar.');
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Network error.';
        setError(msg);
        toastError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      attendeesStr,
      slug,
      title,
      description,
      allDay,
      startDate,
      endDate,
      startTime,
      endTime,
      onCreated,
      onClose,
    ],
  );

  // Two entrances, one modal.
  // Mobile: slide up from below (220ms). The realtor's thumb just tapped
  // the bottom-anchored "+ New" — the surface arrives from where they
  // touched. We layer the slide on top of the base zoom; net effect reads
  // as a slide with a subtle settle.
  // Desktop: scale 0.98 → 1 + fade-in at 220ms. The `!` overrides the
  // base `zoom-in-95` from `components/ui/dialog.tsx` — both set the
  // same custom property, so cascade order isn't reliable.
  const dialogMotionClass = isMobile
    ? 'data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8 ' +
      'duration-[220ms]'
    : 'data-[state=open]:!zoom-in-98 data-[state=closed]:!zoom-out-98 duration-[220ms]';
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn('sm:max-w-md', dialogMotionClass)}>
        <DialogHeader>
          <DialogTitle>New event</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Tour @ 456 Oak"
              autoFocus
              required
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="event-allday"
              type="checkbox"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="event-allday" className="cursor-pointer">
              All day
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-startdate">Start date</Label>
              <Input
                id="event-startdate"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-enddate">End date</Label>
              <Input
                id="event-enddate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
            {!allDay && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="event-starttime">Start time</Label>
                  <Input
                    id="event-starttime"
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="event-endtime">End time</Label>
                  <Input
                    id="event-endtime"
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                  />
                </div>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-attendees">Attendees</Label>
            <Input
              id="event-attendees"
              value={attendeesStr}
              onChange={(e) => setAttendeesStr(e.target.value)}
              placeholder="sam@example.com, jordan@example.com"
            />
            <p className={CAPTION}>Comma-separated emails. Optional.</p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              className={GHOST_PILL}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className={PRIMARY_PILL} disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
