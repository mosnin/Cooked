'use client';

/**
 * DailyBrief — the 7am focal surface.
 *
 * Lives in three states (see use-brief-lifecycle.ts):
 *
 *   live     full brief is the focal element of the workspace
 *   settled  collapses to a one-line receipt above the composer
 *   carried  same-day return visit, same as settled
 *
 * Reads from /api/agent/briefing on mount. Fires 'seen' PATCH the first
 * time it renders, 'acted' the first time a card is tapped. Auto-
 * collapses 60 seconds after 'seen'; manual Open re-expands.
 *
 * Visual language (post-redesign): a sectioned command center, not a
 * narrative h1. Each section has a small-caps SECTION_LABEL header and
 * renders only when its underlying data is present — calm silence beats
 * filler. The composed `brief.headline` still exists (email + SMS
 * templates consume it) but the surface no longer renders it; the
 * "Today." greeting from ChippiPageShell orients without competing.
 *
 * Sections:
 *   ON DECK   the realtor's action cards (reuses brief.cards)
 *   YOUR DAY  today's events from /api/calendar/events (when connected)
 *   PIPELINE  active · closing this week · at risk (from /api/agent/brief/sections)
 *   OVERNIGHT what Chippi did in the last 12h (from the same endpoint)
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { BODY_MUTED, PRIMARY_PILL, GHOST_PILL, SECTION_LABEL } from '@/lib/typography';
import { FOCUS_CARD_MAX } from '@/lib/geometry';
import { DURATION_BASE, EASE_OUT, CHAT_STAGGER_DELAY } from '@/lib/motion';
import type { Brief, BriefCard, SignalKind, SignalSource } from '@/lib/briefing/types';
import type { PipelineSummary, OvernightSummary } from '@/lib/briefing/sections';
import {
  useBriefLifecycle,
  formatProgress,
  formatLastOpened,
} from './use-brief-lifecycle';
import { ShimmerText } from './shimmer-text';

interface Props {
  slug: string;
  /** When set, render this brief directly instead of fetching. Used for
   *  preview surfaces (settings page mock) and tests. */
  initialBrief?: Brief;
  /** When true, suppress the auto-collapse → settled lifecycle. The
   *  brief stays in the live state regardless of seenAt / actedAt. Used
   *  by the dedicated /chippi/brief page where the realtor navigated
   *  here intentionally — they want the full brief, not the receipt. */
  alwaysLive?: boolean;
}

interface ApiResponse {
  id: string | null;
  status: 'pending' | 'seen' | 'acted' | 'failed';
  brief: Brief;
  createdAt: string;
  seenAt: string | null;
  actedAt: string | null;
  showIntro: boolean;
}

const ACTION_LABEL: Record<SignalKind, string> = {
  reply: 'REPLY',
  call: 'CALL',
  prep: 'PREP',
  review: 'REVIEW',
  sign: 'SIGN',
  celebrate: 'NOTED',
  tip: 'TIP',
};

const VERB: Record<SignalKind, string> = {
  reply: 'Open',
  call: 'Call',
  prep: 'Open',
  review: 'Open',
  sign: 'Open',
  celebrate: 'Open',
  tip: 'Open',
};

/** Loading status that swaps in at 1.2s — calmer than a spinner. */
const SLOW_STATUS_MS = 1200;
const TIMEOUT_FALLBACK_MS = 4000;

function deepLink(slug: string, href: string): string {
  if (href.startsWith('http')) return href;
  return `/s/${slug}${href}`;
}

export function DailyBrief({ slug, initialBrief, alwaysLive = false }: Props) {
  const [data, setData] = useState<ApiResponse | null>(
    initialBrief
      ? {
          id: null,
          status: 'pending',
          brief: initialBrief,
          createdAt: new Date().toISOString(),
          seenAt: null,
          actedAt: null,
          showIntro: false,
        }
      : null,
  );
  const [loading, setLoading] = useState(!initialBrief);
  const [slow, setSlow] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [forceExpanded, setForceExpanded] = useState(false);
  const [showYesterday, setShowYesterday] = useState(false);

  useEffect(() => {
    if (initialBrief) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setSlow(false);
    setTimedOut(false);
    const slowTimer = setTimeout(() => !cancelled && setSlow(true), SLOW_STATUS_MS);
    const timeoutTimer = setTimeout(() => !cancelled && setTimedOut(true), TIMEOUT_FALLBACK_MS);

    (async () => {
      try {
        const res = await fetch('/api/agent/briefing');
        if (!res.ok) {
          if (!cancelled) {
            setLoading(false);
            setFailed(true);
          }
          return;
        }
        const json = (await res.json()) as ApiResponse;
        if (!cancelled) {
          setData(json);
          setLoading(false);
          setTimedOut(false);
          // Fire 'seen' on first render — best-effort, never blocks UI.
          if (json.status === 'pending') {
            void fetch('/api/agent/briefing', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ event: 'seen' }),
            }).catch(() => {});
            // Optimistically reflect the new state so the lifecycle hook
            // starts ticking from this exact moment, not from a later
            // refetch that we never do.
            setData((prev) =>
              prev ? { ...prev, status: 'seen', seenAt: new Date().toISOString() } : prev,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
          setFailed(true);
        }
      } finally {
        clearTimeout(slowTimer);
        clearTimeout(timeoutTimer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
    };
  }, [initialBrief, retryNonce]);

  const lifecycle = useBriefLifecycle({
    status: data?.status ?? 'pending',
    seenAt: data?.seenAt ?? null,
    forceExpanded: alwaysLive || forceExpanded,
    forceCollapsed: false,
  });

  function recordActed(cardIndex: number, source: SignalSource, kind: SignalKind): void;
  function recordActed(): void;
  function recordActed(cardIndex?: number, source?: SignalSource, kind?: SignalKind) {
    // Body shape depends on whether this came from a card tap (B5
    // telemetry) or from the empty-state "Tell Chippi" button (which
    // has no card identity).
    const body =
      typeof cardIndex === 'number' && source && kind
        ? { event: 'acted' as const, cardIndex, source, kind }
        : { event: 'acted' as const };
    void fetch('/api/agent/briefing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
    // Optimistically flip status — the lifecycle hook collapses on next tick.
    setData((prev) =>
      prev ? { ...prev, status: 'acted', actedAt: prev.actedAt ?? new Date().toISOString() } : prev,
    );
  }

  if (loading) {
    return (
      <div className={cn(FOCUS_CARD_MAX, 'mx-auto')}>
        <p className={cn(BODY_MUTED, 'mb-4')}>
          <ShimmerText
            messages={
              timedOut
                ? ['Still reading…']
                : slow
                  ? ['Reading your morning.', 'Catching up on overnight.', 'Putting it together.']
                  : ['Reading your morning.', 'Catching up on overnight.']
            }
          />
        </p>
        <div className="space-y-2 animate-pulse">
          <div className="h-3 w-full rounded bg-muted/40" />
          <div className="h-3 w-5/6 rounded bg-muted/40" />
        </div>
        {timedOut && (
          <p className={cn(BODY_MUTED, 'mt-4 text-xs')}>
            I&apos;ll have your brief in a moment.
          </p>
        )}
      </div>
    );
  }

  // Fetch failed — calm sentence + inline recovery. Norman-grade error
  // handling: the realtor never stares at a blank surface wondering
  // whether the page is broken or just empty.
  if (failed || !data) {
    return (
      <div className={cn(FOCUS_CARD_MAX, 'mx-auto')}>
        <p className={cn(BODY_MUTED, 'mb-4')}>
          I couldn&apos;t pull your brief just now.
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className={cn(GHOST_PILL, 'min-h-[44px] sm:min-h-0')}
        >
          Try again
        </button>
      </div>
    );
  }

  // Settled / carried — render the collapsed receipt above the composer
  // and yield the screen back to the chat surface as the focal element.
  // Yesterday's brief renders from THIS parent in both lifecycle states
  // so the "Yesterday →" toggle works whether the realtor is in the live
  // brief OR the collapsed receipt — the bug used to be that the toggle
  // lived on the receipt but the rendered surface lived only inside the
  // live brief, so tapping the receipt's button did nothing.
  return (
    <>
      {lifecycle === 'settled' ? (
        <CollapsedBrief
          data={data}
          showYesterday={showYesterday}
          onExpand={() => setForceExpanded(true)}
          onToggleYesterday={() => setShowYesterday((v) => !v)}
        />
      ) : (
        <LiveBrief data={data} slug={slug} onAct={recordActed} />
      )}
      {showYesterday && (
        <div className="mt-6 opacity-80">
          <YesterdayBrief slug={slug} onCollapse={() => setShowYesterday(false)} />
        </div>
      )}
    </>
  );
}

// ── Live state ────────────────────────────────────────────────────────────────

/**
 * Sectioned command-center layout. ChippiPageShell already provides the
 * "Today." greeting; we render the four sections directly. Each section
 * renders only when its data is present — calm silence over filler.
 */
function LiveBrief({
  data,
  slug,
  onAct,
}: {
  data: ApiResponse;
  slug: string;
  onAct: (cardIndex?: number, source?: SignalSource, kind?: SignalKind) => void;
}) {
  const { brief } = data;
  const sections = useBriefSections(slug);
  const events = useTodaysCalendarEvents(slug);

  const hasOnDeck = brief.cards.length > 0 || brief.tip != null;
  const hasYourDay = events.length > 0;
  const hasPipeline = sections?.pipeline != null && sections.pipeline.active > 0;
  const hasOvernight = sections?.overnight != null;

  const anySection = hasOnDeck || hasYourDay || hasPipeline || hasOvernight;

  // Compute a sequential index ONLY for the sections we actually render,
  // so a missing ON DECK doesn't leave YOUR DAY waiting on an empty
  // stagger slot. 40ms between siblings is the Apple cadence — present
  // enough to read as "settling in", invisible enough to not feel
  // animated. First paint only; section data arriving later (overnight
  // /pipeline arrive after the calendar fetch resolves) animates in
  // independently from index 0 since it's its own mount.
  let sectionIndex = 0;
  const nextDelay = () => 0.04 + sectionIndex++ * CHAT_STAGGER_DELAY;

  return (
    <div className={cn(FOCUS_CARD_MAX, 'mx-auto space-y-12')}>
      {hasOnDeck && (
        <BriefSection label="ON DECK" delay={nextDelay()}>
          <ul className="divide-y divide-border/60">
            {brief.cards.map((card, idx) => (
              <BriefCardRow
                key={`${card.subject.id}-${idx}`}
                slug={slug}
                card={card}
                cardIndex={idx}
                onAct={onAct}
              />
            ))}
            {brief.tip && (
              <BriefCardRow
                key={`tip-${brief.tip.subject.id}`}
                slug={slug}
                card={brief.tip}
                cardIndex={brief.cards.length}
                onAct={onAct}
              />
            )}
          </ul>
        </BriefSection>
      )}

      {hasYourDay && (
        <BriefSection label="YOUR DAY" delay={nextDelay()}>
          <YourDayList events={events} />
        </BriefSection>
      )}

      {hasPipeline && sections?.pipeline && (
        <BriefSection label="PIPELINE" delay={nextDelay()}>
          <PipelineLine summary={sections.pipeline} tomorrow={brief.tomorrow} />
        </BriefSection>
      )}

      {hasOvernight && sections?.overnight && (
        <BriefSection label="OVERNIGHT" delay={nextDelay()}>
          <OvernightLine summary={sections.overnight} momentum={brief.momentum} />
        </BriefSection>
      )}

      {!anySection && <QuietMorning slug={slug} onAct={onAct} />}
    </div>
  );
}

// ── Section primitive ────────────────────────────────────────────────────────

function BriefSection({
  label,
  children,
  delay = 0,
}: {
  label: string;
  children: React.ReactNode;
  /** Stagger offset for first-paint section reveal. Defaults to 0 so
   *  surfaces that don't use the brief's four-up cascade get a plain
   *  fade-in. */
  delay?: number;
}) {
  return (
    <motion.section
      className="space-y-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION_BASE, ease: EASE_OUT, delay }}
    >
      <h2 className={SECTION_LABEL}>{label}</h2>
      {children}
    </motion.section>
  );
}

// ── ON DECK card row — mobile stacks tag above content, button drops to a second row ──

function BriefCardRow({
  slug,
  card,
  cardIndex,
  onAct,
}: {
  slug: string;
  card: BriefCard;
  cardIndex: number;
  onAct: (cardIndex: number, source: SignalSource, kind: SignalKind) => void;
}) {
  const tag = ACTION_LABEL[card.kind];
  const verb = VERB[card.kind];
  const href = deepLink(
    slug,
    card.draftedAction?.kind === 'open' ? card.draftedAction.href : card.subject.href,
  );

  return (
    <li className="flex flex-col sm:flex-row sm:items-start sm:gap-6 py-4 gap-2">
      <span className={cn(SECTION_LABEL, 'sm:pt-0.5 sm:w-14 sm:shrink-0 tabular-nums')}>{tag}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{card.subject.name}</p>
        <p className={cn(BODY_MUTED, 'mt-0.5')}>{card.evidence}</p>
      </div>
      <div className="flex justify-end sm:contents">
        <Link
          href={href}
          onClick={() => onAct(cardIndex, card.source, card.kind)}
          className={cn(GHOST_PILL, 'shrink-0 min-h-[44px] sm:min-h-0')}
        >
          {verb}
        </Link>
      </div>
    </li>
  );
}

// ── YOUR DAY ─────────────────────────────────────────────────────────────────

interface CalEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink: string | null;
}

function YourDayList({ events }: { events: CalEvent[] }) {
  return (
    <ul className="space-y-2">
      {events.map((e) => {
        const time = e.allDay ? 'All day' : formatEventTime(e.start);
        const Row = (
          <>
            <span className="text-sm tabular-nums text-muted-foreground w-16 shrink-0">{time}</span>
            <span className="text-sm text-foreground truncate">{e.title}</span>
          </>
        );
        return (
          <li key={e.id} className="flex items-baseline gap-4">
            {e.htmlLink ? (
              <a
                href={e.htmlLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-baseline gap-4 hover:opacity-80 transition-opacity flex-1 min-w-0"
              >
                {Row}
              </a>
            ) : (
              Row
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  // "9:00a" / "2:30p" — same compact form the design spec calls for, half
  // the width of "9:00 AM" so the time column stays a quiet vertical rail.
  const h = date.getHours();
  const m = date.getMinutes();
  const meridiem = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${meridiem}` : `${h12}:${m.toString().padStart(2, '0')}${meridiem}`;
}

// ── PIPELINE ─────────────────────────────────────────────────────────────────

function PipelineLine({
  summary,
  tomorrow,
}: {
  summary: PipelineSummary;
  tomorrow: string | null;
}) {
  // active · closing this week · at risk — middot separated, tabular nums.
  const parts: string[] = [`${summary.active} active`];
  if (summary.closingThisWeek > 0) {
    parts.push(`${summary.closingThisWeek} closing this week`);
  }
  if (summary.atRisk > 0) {
    parts.push(`${summary.atRisk} at risk`);
  }
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-foreground tabular-nums">{parts.join(' · ')}</p>
      {tomorrow && <p className={BODY_MUTED}>{tomorrow}</p>}
    </div>
  );
}

// ── OVERNIGHT ────────────────────────────────────────────────────────────────

function OvernightLine({
  summary,
  momentum,
}: {
  summary: OvernightSummary;
  momentum: string | null;
}) {
  // Buckets render as "3 drafts ready · 1 deal advanced · 2 contacts updated".
  // The labels are already plural; if a count is 1 we trim the trailing "s"
  // from the noun (drafts → draft, contacts → contact, etc.). "ready" stays.
  const parts = summary.buckets.map((b) => `${b.count} ${singularize(b.label, b.count)}`);
  return (
    <div className="space-y-1.5">
      <p className="text-sm text-foreground tabular-nums">{parts.join(' · ')}</p>
      {momentum && <p className={BODY_MUTED}>{momentum}</p>}
    </div>
  );
}

/**
 * Trim "s" from the noun in a plural-bucket label when count is 1.
 * Labels are shapes like "drafts ready", "deals advanced", "contacts updated",
 * "messages sent", "reminders set", "tasks done", "updates".
 * We trim the FIRST word's trailing s; the past-tense verb stays.
 */
function singularize(label: string, count: number): string {
  if (count !== 1) return label;
  const [head, ...rest] = label.split(' ');
  if (head.endsWith('s')) {
    return [head.slice(0, -1), ...rest].join(' ');
  }
  return label;
}

// ── QUIET MORNING ────────────────────────────────────────────────────────────

/**
 * Day-one realtor: no cards, no calendar events, no pipeline, no overnight
 * activity. Single quiet sentence + the same "Tell Chippi" CTA the empty-
 * state used to surface, so the brief stays actionable on a quiet morning.
 */
function QuietMorning({
  slug,
  onAct,
}: {
  slug: string;
  onAct: (cardIndex?: number, source?: SignalSource, kind?: SignalKind) => void;
}) {
  return (
    <div>
      <p className={cn(BODY_MUTED, 'max-w-md')}>
        Quiet morning. Nothing pulling at you.
      </p>
      <div className="mt-6">
        <Link
          href={`/s/${slug}/chippi`}
          onClick={() => onAct()}
          className={cn(PRIMARY_PILL, 'min-h-[44px] sm:min-h-0')}
        >
          Tell Chippi
        </Link>
      </div>
    </div>
  );
}

// ── Data hooks ───────────────────────────────────────────────────────────────

interface SectionsPayload {
  pipeline: PipelineSummary | null;
  overnight: OvernightSummary | null;
}

/**
 * Fetch PIPELINE + OVERNIGHT in one round-trip. Returns null while loading
 * and on failure — the surface omits the corresponding sections silently
 * rather than rendering an error chrome. The brief still shows ON DECK + the
 * greeting; pipeline + overnight just don't appear that morning.
 */
function useBriefSections(slug: string): SectionsPayload | null {
  const [payload, setPayload] = useState<SectionsPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agent/brief/sections?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const json = (await res.json()) as SectionsPayload;
        if (!cancelled) setPayload(json);
      } catch {
        // silent — surface omits the sections
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return payload;
}

/**
 * Pull today's events from the connected external calendar. Returns [] when
 * not connected OR when no events fall in today's window. The surface omits
 * the YOUR DAY section in both cases — no nag to connect, no empty header.
 */
function useTodaysCalendarEvents(slug: string): CalEvent[] {
  const [events, setEvents] = useState<CalEvent[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/calendar/events?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const json = (await res.json()) as
          | { connected: false }
          | { connected: true; events: CalEvent[] };
        if (cancelled) return;
        if (!json.connected) return;
        const today = filterToToday(json.events);
        setEvents(today);
      } catch {
        // silent — surface omits the section
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return events;
}

function filterToToday(events: CalEvent[]): CalEvent[] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return events
    .filter((e) => {
      const t = new Date(e.start).getTime();
      return !isNaN(t) && t >= start.getTime() && t < end.getTime();
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

// ── Collapsed state ──────────────────────────────────────────────────────────

function CollapsedBrief({
  data,
  showYesterday,
  onExpand,
  onToggleYesterday,
}: {
  data: ApiResponse;
  showYesterday: boolean;
  onExpand: () => void;
  onToggleYesterday: () => void;
}) {
  const { brief, seenAt, actedAt } = data;
  const progress = formatProgress(brief.cards.length, actedAt);
  const lastOpened = formatLastOpened(seenAt);

  return (
    <div className={cn(FOCUS_CARD_MAX, 'mx-auto')}>
      <div className="flex items-center justify-between gap-3 py-2 border-y border-border/40">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Open today's brief"
          className="flex items-baseline gap-3 min-w-0 flex-1 text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 rounded-sm"
        >
          <span className={cn(SECTION_LABEL, 'shrink-0')}>Today&apos;s brief</span>
          <span className={cn(BODY_MUTED, 'text-xs truncate group-hover:text-foreground transition-colors')}>
            {progress}
            {lastOpened && ` · last opened ${lastOpened}`}
          </span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onExpand}
            className={cn(GHOST_PILL, 'h-7 px-3 text-xs')}
          >
            Open
          </button>
          <button
            type="button"
            onClick={onToggleYesterday}
            aria-expanded={showYesterday}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2"
          >
            {showYesterday ? 'Hide yesterday' : 'Yesterday →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Yesterday's brief — one-day window, muted treatment ──────────────────────

function YesterdayBrief({ slug, onCollapse }: { slug: string; onCollapse: () => void }) {
  const [yBrief, setYBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/agent/briefing?day=yesterday');
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setYBrief(json.brief);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className={cn(FOCUS_CARD_MAX, 'mx-auto')}>
        <p className={cn(SECTION_LABEL, 'mb-2')}>Yesterday</p>
        <p className={cn(BODY_MUTED, 'text-xs')}>
          <ShimmerText messages="Reading yesterday." />
        </p>
      </div>
    );
  }

  if (!yBrief) {
    return (
      <div className={cn(FOCUS_CARD_MAX, 'mx-auto')}>
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <p className={SECTION_LABEL}>Yesterday</p>
          <button
            type="button"
            onClick={onCollapse}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Hide
          </button>
        </div>
        <p className={BODY_MUTED}>No brief for yesterday.</p>
      </div>
    );
  }

  // Yesterday's brief is a read-only echo. We collapse it to the same
  // sectioned treatment minus PIPELINE/OVERNIGHT (those are state-of-now,
  // not yesterday's snapshot). If there were ON DECK cards, name them
  // briefly; otherwise quiet.
  const hadCards = yBrief.cards.length > 0;
  return (
    <div className={cn(FOCUS_CARD_MAX, 'mx-auto')}>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <p className={SECTION_LABEL}>Yesterday</p>
        <button
          type="button"
          onClick={onCollapse}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Hide
        </button>
      </div>
      <div className="rounded-lg border border-border/40 bg-card px-6 py-5 space-y-2">
        {hadCards ? (
          <ul className="space-y-1.5">
            {yBrief.cards.slice(0, 3).map((c, i) => (
              <li key={i} className="text-sm text-muted-foreground truncate">
                <span className={cn(SECTION_LABEL, 'mr-2')}>{ACTION_LABEL[c.kind]}</span>
                {c.subject.name}
              </li>
            ))}
          </ul>
        ) : (
          <p className={BODY_MUTED}>Quiet day.</p>
        )}
        {yBrief.momentum && <p className={cn(BODY_MUTED, 'text-xs')}>{yBrief.momentum}</p>}
      </div>
    </div>
  );
}
