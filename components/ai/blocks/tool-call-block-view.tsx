'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  XCircle,
  MinusCircle,
  Lock,
  Users,
  Briefcase,
  Building2,
  CalendarDays,
  FileText,
  BarChart3,
  Mail,
  MessageSquare,
  Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ToolCallBlock } from '@/lib/ai-tools/blocks';
import { ContactsResult } from './tool-results/contacts-result';
import { DealsResult } from './tool-results/deals-result';
import { ToursResult } from './tool-results/tours-result';
import { PropertiesResult } from './tool-results/properties-result';
import { AvailabilityPickerCard } from './tool-results/availability-picker-card';

/**
 * Row-level shimmer styles for the running state. A gentle gradient sweep
 * across the row, paper-flat in tone. STYLESHEET.md "premium" voice:
 * subtle, expensive-feeling, opacity capped low so the row never feels
 * busy. Injected on first mount and dedup'd by id so the second mount
 * doesn't re-add the stylesheet.
 *
 * The existing `an-tg-shimmer` class in tool-group.tsx is text-only
 * (background-clip: text). Tool-call-row shimmer needs to sweep across
 * the entire row, so the gradient lives on a pseudo-element overlay
 * sized to 200% of the row width and animated via background-position.
 */
const ROW_SHIMMER_KEY = 'an-tool-call-row-shimmer';

function ensureRowShimmerStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ROW_SHIMMER_KEY)) return;
  const style = document.createElement('style');
  style.id = ROW_SHIMMER_KEY;
  style.textContent = `
@keyframes an-tool-call-row-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.an-tool-call-row-shimmer {
  background-image: linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.18) 50%, transparent 100%);
  background-size: 200% 100%;
  background-repeat: no-repeat;
  animation: an-tool-call-row-shimmer 1.8s ease-in-out infinite;
}
.dark .an-tool-call-row-shimmer {
  background-image: linear-gradient(110deg, transparent 0%, rgba(255, 255, 255, 0.10) 50%, transparent 100%);
}
@media (prefers-reduced-motion: reduce) {
  .an-tool-call-row-shimmer { animation: none; }
}
`;
  document.head.appendChild(style);
}

/** Per-tool icon map. Generic Wrench fallback keeps unknown tools readable. */
const TOOL_ICONS: Record<string, typeof Users> = {
  search_contacts: Users,
  get_contact: Users,
  search_deals: Briefcase,
  pipeline_summary: BarChart3,
  search_tours: CalendarDays,
  get_note: FileText,
  send_email: Mail,
  send_sms: MessageSquare,
  send_email_now: Mail,
  send_sms_now: MessageSquare,
  draft_message: Mail,
  add_property: Building2,
  find_property: Building2,
  search_properties: Building2,
};

/**
 * Tool-specific running verb. Realtors don't think in developer words like
 * "Running" — they think in actions. Each verb maps to what the tool is
 * actually doing from the user's perspective.
 */
const TOOL_RUNNING_LABEL: Record<string, string> = {
  search_contacts: 'Searching…',
  find_person: 'Searching…',
  get_contact: 'Searching…',
  pipeline_summary: 'Analyzing…',
  find_stuck_deals: 'Analyzing…',
  find_quiet_hot_persons: 'Analyzing…',
  find_deal: 'Looking up…',
  find_overdue_followups: 'Looking up…',
  schedule_tour: 'Checking calendar…',
  reschedule_tour: 'Checking calendar…',
  check_availability: 'Checking calendar…',
  find_tours: 'Checking calendar…',
  send_email: 'Drafting…',
  draft_email: 'Drafting…',
  draft_message: 'Drafting…',
  send_email_now: 'Sending…',
  send_sms_now: 'Texting…',
  send_sms: 'Writing…',
  draft_sms: 'Writing…',
  recall_history: 'Checking history…',
  create_plan: 'Planning…',
  planner: 'Planning…',
  note_on_person: 'Saving note…',
  note_on_deal: 'Saving note…',
  note_on_property: 'Saving note…',
  find_property: 'Looking up…',
  search_properties: 'Searching…',
  add_property: 'Saving…',
  create_deal: 'Updating deal…',
  mark_deal_won: 'Updating deal…',
  mark_deal_lost: 'Updating deal…',
  move_deal_stage: 'Updating deal…',
  set_followup: 'Updating…',
  clear_followup: 'Updating…',
};

/** Friendly title — the tool's name is snake_case, UI wants "Search contacts". */
function friendlyName(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Keep failure messages short enough to fit the transcript column. The full
 *  text stays in the expandable detail pane. */
function truncateErrorMessage(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Produce a short prose hint from the tool args that a realtor can read at
 * a glance. UUID fields (contactId, dealId) are meaningless to realtors so
 * we skip them. Returns null when nothing useful can be shown.
 */
function argsProseHint(args: Record<string, unknown> | undefined | null): string | null {
  if (!args) return null;

  // UUIDs: skip entirely — they mean nothing to a realtor.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUUID = (v: unknown): boolean =>
    typeof v === 'string' && UUID_RE.test(v);

  if (typeof args.name === 'string' && args.name && !isUUID(args.name)) {
    return `for ${args.name}`;
  }
  if (typeof args.query === 'string' && args.query) {
    return `for ${args.query}`;
  }
  if (typeof args.subject === 'string' && args.subject) {
    return `re: ${args.subject}`;
  }
  if (typeof args.stage === 'string' && args.stage) {
    return `→ ${args.stage}`;
  }

  // Skip if the only fields are UUIDs or known-useless ids.
  const UUID_KEYS = new Set(['contactId', 'dealId', 'tourId', 'propertyId', 'id']);
  const meaningful = Object.entries(args).filter(
    ([k, v]) => !UUID_KEYS.has(k) && !isUUID(v) && typeof v !== 'object',
  );
  if (meaningful.length === 0) return null;

  // Fall back to first meaningful string value.
  const [, val] = meaningful[0];
  if (typeof val === 'string' && val) return val.slice(0, 60);
  if (typeof val === 'number') return String(val);

  return null;
}

interface ToolCallBlockViewProps {
  block: ToolCallBlock;
  /** Is this call currently running? Overrides persisted status for live turns. */
  live?: boolean;
  /**
   * When true a subtle left accent timeline bar is rendered, signalling this
   * tool call is part of a multi-step sequence. Wire from the parent once
   * sequence detection is implemented; default false today.
   */
  isPartOfSequence?: boolean;
  /** Interactive cards (availability picker) bubble user intents back up
   *  through this prop. The workspace forwards them as the next user
   *  message. Omitted on read-only history surfaces. */
  onUserIntent?: (text: string) => void;
  className?: string;
}

export function ToolCallBlockView({
  block,
  live,
  isPartOfSequence = false,
  onUserIntent,
  className,
}: ToolCallBlockViewProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[block.name] ?? Wrench;

  // Inject the row-shimmer keyframes once per process. Cheap — the early
  // return inside ensureRowShimmerStyles dedupes via the stylesheet id.
  useEffect(() => {
    ensureRowShimmerStyles();
  }, []);

  const status: 'running' | ToolCallBlock['status'] = live ? 'running' : block.status;

  const {
    label,
    iconEl,
    tint,
  }: { label: string; iconEl: React.ReactNode; tint: string } = (() => {
    switch (status) {
      case 'running':
        // The row-level shimmer IS the running indicator now — a single
        // calm signal across the row. Dropping the spinner glyph next to
        // the label keeps the running pill as one quiet line; double
        // motion (spinner + shimmer) reads as busy. Apple-style: pick.
        return {
          label: TOOL_RUNNING_LABEL[block.name] ?? 'Working…',
          iconEl: null,
          tint: 'text-muted-foreground',
        };
      case 'complete':
        return {
          label: 'Complete',
          iconEl: <CheckCircle2 size={12} />,
          tint: 'text-emerald-600 dark:text-emerald-400',
        };
      case 'error':
        return {
          label: 'Failed',
          iconEl: <XCircle size={12} />,
          tint: 'text-rose-600 dark:text-rose-400',
        };
      case 'denied':
        return {
          label: 'Denied',
          iconEl: <Lock size={12} />,
          tint: 'text-muted-foreground',
        };
      case 'skipped':
        return {
          label: 'Skipped',
          iconEl: <MinusCircle size={12} />,
          tint: 'text-muted-foreground',
        };
      default:
        return { label: status, iconEl: null, tint: 'text-muted-foreground' };
    }
  })();

  // Phase 5 — rich inline result rendering. Tools opt in via the `display`
  // hint on their handler return. When the result resolves successfully and
  // the data shape is one we know how to render, we show the rich card stack
  // BELOW the compact row by default (no expand-click needed).
  const richResult: React.ReactNode = (() => {
    if (status !== 'complete' || !block.result?.ok) return null;
    const data = block.result.data as Record<string, unknown> | undefined;
    if (!data) return null;
    if (block.display === 'contacts' && Array.isArray((data as { contacts?: unknown[] }).contacts)) {
      return <ContactsResult data={data as { contacts: never[] }} />;
    }
    if (block.display === 'deals' && Array.isArray((data as { deals?: unknown[] }).deals)) {
      return <DealsResult data={data as { deals: never[] }} />;
    }
    if (block.display === 'tours' && Array.isArray((data as { tours?: unknown[] }).tours)) {
      return <ToursResult data={data as { tours: never[] }} />;
    }
    if (block.display === 'properties' && Array.isArray((data as { properties?: unknown[] }).properties)) {
      return <PropertiesResult data={data as { properties: never[] }} />;
    }
    if (
      block.display === 'availability-picker' &&
      Array.isArray((data as { slots?: unknown[] }).slots)
    ) {
      const d = data as {
        slots: Array<{ startsAt: string; endsAt: string; label: string }>;
        contactId?: string;
        propertyAddress?: string;
        durationMinutes?: number;
      };
      return (
        <AvailabilityPickerCard
          slots={d.slots}
          contactId={d.contactId}
          propertyAddress={d.propertyAddress}
          durationMinutes={d.durationMinutes ?? 60}
          onSelectSlot={onUserIntent}
        />
      );
    }
    return null;
  })();

  // Inline error breadcrumb. On failure the realtor needs to know WHY without
  // hunting for the expand chevron — Stream C's status-honesty pattern
  // (commit 4859066). Truncated to keep the transcript scannable; the full
  // text remains in the expandable details pane.
  //
  // Inline textual SUCCESS summary used to render here too, but that
  // duplicated whatever the LLM already said in the following text block —
  // a row of redundant copy below every read. Removed in this pass; the
  // collapsed row is now icon + label + status, with the rich result card
  // (when present) carrying the substance below.
  const inlineError =
    status === 'error' && (block.result?.error || block.result?.summary)
      ? truncateErrorMessage(block.result?.error ?? block.result?.summary ?? '', 160)
      : null;

  // Prose hint derived from args — non-monospace, human readable.
  const argsHint = argsProseHint(block.args);

  // Colored left-edge bar carries the status semantic so the row stays
  // scannable without a card border. The body of the row is borderless
  // and transparent — see STYLESHEET.md "paper-flat" principle.
  const accentBar =
    status === 'running'
      ? 'bg-muted-foreground/30'
      : block.display === 'error' || status === 'error'
        ? 'bg-rose-500/60'
        : block.display === 'warning'
          ? 'bg-amber-500/60'
          : block.display === 'success' && status === 'complete'
            ? 'bg-emerald-500/60'
            : 'bg-muted-foreground/20';

  // Expand is only useful when there are args or a result summary to show in
  // the collapsible detail pane (not the same as the inline summary).
  const argsEntries = Object.entries(block.args ?? {});
  const hasDetails = argsEntries.length > 0 || !!block.result?.summary || !!block.result?.error;

  return (
    <motion.div
      className={cn(
        'group relative flex flex-col',
        isPartOfSequence && 'border-l border-border/40 ml-1 pl-2',
        className,
      )}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Compact step row. Collapsed by default — args, summary, and full
          result detail live behind the expand chevron. Three pieces stay
          visible without an expand-click: (1) the rich result card below,
          since it IS the realtor's answer; (2) the rose-tone error
          breadcrumb on failure (Stream C status-honesty pattern); and
          (3) a subtle row-shimmer while running, replacing the spinner-
          only signal with a calm, paper-flat sweep. */}
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => hasDetails && setExpanded((v) => !v)}
        className={cn(
          'relative flex items-center gap-2 pl-3 pr-2.5 py-1.5 rounded-lg text-left min-h-[36px]',
          'transition-colors overflow-hidden',
          hasDetails && 'hover:bg-muted/20 cursor-pointer',
          !hasDetails && 'cursor-default',
          status === 'running' && 'an-tool-call-row-shimmer',
        )}
      >
        {/* Left accent bar */}
        <span
          aria-hidden
          className={cn('absolute left-0 inset-y-0 w-[3px] rounded-l-lg flex-shrink-0', accentBar)}
        />

        {/* Tool icon */}
        <span className={cn('flex-shrink-0', tint)}>
          <Icon size={13} />
        </span>

        {/* Tool name */}
        <span className="text-[12px] font-medium text-foreground flex-shrink-0">
          {friendlyName(block.name)}
        </span>

        {/* Args hint — only when expanded. Collapsed view stays minimal
            (icon + label + status); the realtor expands to see context. */}
        {argsHint && expanded && (
          <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">
            {argsHint}
          </span>
        )}

        {/* Spacer */}
        {(!argsHint || !expanded) && <span className="flex-1" />}

        {/* Status badge */}
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] font-medium flex-shrink-0 ml-1',
            tint,
          )}
        >
          {iconEl}
          {label}
        </span>

        {/* Expand chevron — only shown when there's something to expand */}
        {hasDetails && (
          <span className="text-muted-foreground/50 flex-shrink-0 ml-0.5">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>

      {/* Inline error breadcrumb for failed tools. Always visible — this
          is Stream C's status-honesty pattern (commit 4859066): the realtor
          must not have to hunt for the expand chevron to see WHY a call
          failed. Tone token matches STYLESHEET.md status-pill failed tone. */}
      {inlineError && (
        <p
          role="status"
          className="text-[12px] text-rose-700 dark:text-rose-400 mt-1 px-1 leading-snug"
        >
          {inlineError}
        </p>
      )}

      {/* Rich inline result rendering — visible by default for known data
          shapes (contacts, deals, tours) so the realtor doesn't have to expand. */}
      {richResult}

      {/* Collapsible details — rendered below the row, slightly indented.
          Height + opacity transition on expand/collapse keeps the tool row
          from snapping; `overflow-hidden` on the outer wrapper clips the
          content while height animates from 0 → auto. 220ms is the iOS
          disclosure cadence — fast enough to feel direct, slow enough that
          the detail pane reads as "opened" rather than "appeared". */}
      <AnimatePresence initial={false}>
        {expanded && hasDetails && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-1 ml-3 pl-3 border-l-2 border-border space-y-2.5 py-2">
              {argsEntries.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Arguments
                  </p>
                  <pre className="text-[11px] bg-muted/30 border border-border rounded-md px-2 py-1.5 overflow-x-auto font-mono text-foreground/80">
                    {JSON.stringify(block.args, null, 2)}
                  </pre>
                </div>
              )}
              {block.result?.summary && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Result
                  </p>
                  <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                    {block.result.summary}
                  </p>
                </div>
              )}
              {block.result?.error && block.result.ok === false && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-1">
                    Error
                  </p>
                  <p className="text-xs text-rose-700 dark:text-rose-300">{block.result.error}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
