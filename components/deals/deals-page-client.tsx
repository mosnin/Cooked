'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Plus, Search, X } from 'lucide-react';
import { KanbanBoard } from './kanban-board';
import { PipelineSummary } from './pipeline-summary';
import { PipelineTabs } from './pipeline-tabs';
import { H1, TITLE_FONT, PRIMARY_PILL, BODY_MUTED, QUIET_LINK } from '@/lib/typography';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { Pipeline, DealStage, Deal } from '@/lib/types';

type StageWithDeals = DealStage & { deals: Deal[] };

/** What's visible on the board. Two states. Default 'active'. */
export type BoardStatus = 'active' | 'closed';

/**
 * The narrowing focus selected from the stat strip / narration line.
 * `null` means "show me everything in this status." A focus is a way for the
 * realtor to pull a specific story out of the data — "show me what's at
 * risk", "show me what's closing this month" — without configuring a popover.
 */
export type BoardFocus = 'at-risk' | 'closing-month' | null;

const STATUS_TABS: ReadonlyArray<{ key: BoardStatus; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'closed', label: 'Closed' },
];

interface DealsPageClientProps {
  slug: string;
  /** Pipelines pre-fetched on the server. Empty means first visit — the
   *  client will hit /api/pipelines which will bootstrap defaults. */
  initialPipelines?: Pipeline[];
  /** First pipeline's stages-with-deals, pre-computed server-side so
   *  KPI counters don't flash zero before the client round-trip. */
  initialStages?: StageWithDeals[];
  /** ID of the pipeline whose stages we pre-loaded. The client may
   *  override this with a localStorage pick after mount. */
  initialPipelineId?: string | null;
}

export function DealsPageClient({
  slug,
  initialPipelines = [],
  initialStages = [],
  initialPipelineId = null,
}: DealsPageClientProps) {
  const router = useRouter();
  const [pipelines, setPipelines] = useState<Pipeline[]>(initialPipelines);
  const [activePipelineId, setActivePipelineId] = useState<string>(initialPipelineId ?? '');
  // Skip the client bootstrap if the server already gave us pipelines —
  // showing a skeleton would be a lie when the data is already in hand.
  const [loading, setLoading] = useState(initialPipelines.length === 0);

  // Board filters live up here so the stat strip and the kanban share state.
  // The narration sentence and the stat cells double as filter triggers — when
  // you click "At risk: 3", the board narrows to those three. The page tells
  // one story instead of two.
  const [boardStatus, setBoardStatus] = useState<BoardStatus>('active');
  const [focus, setFocus] = useState<BoardFocus>(null);
  // Search is part of the page-level toolbar so the status toggle, search,
  // and focus chip share one row. Used to be in the kanban — but having three
  // separate rows of chrome was the whole problem.
  const [searchQuery, setSearchQuery] = useState('');
  // Bumped by the kanban after every mutation refetch so the stat strip
  // (`PipelineSummary`) re-fetches in lockstep. Without this the strip would
  // still say "0 active deals" right after the realtor created one.
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);

  // Load pipelines (triggers bootstrap if this is the first visit).
  // When the server already gave us pipelines we still want to restore the
  // last-active pipeline from localStorage on mount, but we skip the API
  // round-trip — pipelines barely change between renders, and the server's
  // payload is good for the realtor's first paint.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    // Fast path: server already shipped pipelines. Just sync the active
    // selection from localStorage if there is one.
    if (initialPipelines.length > 0) {
      try {
        const stored = localStorage.getItem(`chippi:deals:pipeline:${slug}`);
        const found = stored ? initialPipelines.find((p) => p.id === stored) : null;
        if (found && found.id !== activePipelineId) {
          setActivePipelineId(found.id);
        }
      } catch {
        // storage disabled — keep whatever the server picked
      }
      return;
    }

    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/pipelines?slug=${encodeURIComponent(slug)}`);
        if (!res.ok) return;
        const data: Pipeline[] = await res.json();
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setPipelines(data);
          // Restore last active pipeline from localStorage
          try {
            const stored = localStorage.getItem(`chippi:deals:pipeline:${slug}`);
            const found = stored ? data.find((p) => p.id === stored) : null;
            setActivePipelineId(found ? found.id : data[0].id);
          } catch {
            setActivePipelineId(data[0].id);
          }
        }
      } catch {
        // non-fatal — board will show empty state
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Persist active pipeline selection
  function handleSelectPipeline(id: string) {
    setActivePipelineId(id);
    try {
      localStorage.setItem(`chippi:deals:pipeline:${slug}`, id);
    } catch {
      // quota exceeded / storage disabled
    }
  }

  function handleAddDeal() {
    router.push(`/s/${slug}/deals/new`);
  }

  function handleStatusChange(next: BoardStatus) {
    if (next === boardStatus) return;
    setBoardStatus(next);
    // Switching status drops the focus filter — those filters are about
    // active deals; carrying them into the closed view is meaningless.
    if (next === 'closed') setFocus(null);
  }

  if (loading) {
    return (
      <div className="space-y-8 max-w-[1500px] mx-auto pb-12">
        <header className="flex items-end justify-between gap-4">
          <h1 className={H1} style={TITLE_FONT}>
            Deals
          </h1>
        </header>
        <div className="h-32 rounded-xl border border-border/70 bg-foreground/[0.02] animate-pulse" />
      </div>
    );
  }

  const hasPipelines = pipelines.length > 0;

  return (
    <div className="space-y-8 max-w-[1500px] mx-auto pb-12">
      {/* Page header — serif H1 + single primary pill. The H1 is the noun
          realtors use ("deals"); the URL, narration, and Add button all
          agree. */}
      <header className="flex items-end justify-between gap-4">
        <h1 className={H1} style={TITLE_FONT}>
          Deals
        </h1>
        {hasPipelines && (
          <div className="flex flex-col items-end gap-1">
            {/* The conversation is the front door. Saying it out loud is
                faster than any form, so it gets the primary pill. */}
            <Link
              href={`/s/${slug}/chippi?prefill=${encodeURIComponent("I'm adding a new deal — ")}`}
              className={PRIMARY_PILL}
            >
              Tell Chippi →
            </Link>
            {/* The form still exists for those who want it; offered quietly. */}
            <Link href={`/s/${slug}/deals/new`} className={QUIET_LINK}>
              or fill out the form
            </Link>
          </div>
        )}
      </header>

      {activePipelineId && boardStatus === 'active' && (
        <PipelineSummary
          slug={slug}
          pipelineId={activePipelineId}
          focus={focus}
          onFocusChange={setFocus}
          onAddDeal={handleAddDeal}
          refreshKey={summaryRefreshKey}
          // Hand the server-fetched stages to the summary only when the
          // displayed pipeline matches what we pre-loaded. Once the realtor
          // picks a different pipeline the prop falls through to undefined
          // and the summary falls back to its client fetch.
          initialStages={activePipelineId === initialPipelineId ? initialStages : undefined}
        />
      )}

      {/* Pipeline tabs — only when the realtor actually has more than one
          board to choose between. Most realtors have a single Sales pipeline;
          showing "[Sales] [+]" by itself was a row of chrome that paid no
          rent. The "+ new pipeline" affordance comes back when there are
          two or more — which is when it stops being a power-user feature. */}
      {pipelines.length > 1 && (
        <div className="flex items-center gap-2 border-b border-border/70">
          <PipelineTabs
            slug={slug}
            pipelines={pipelines}
            activePipelineId={activePipelineId}
            onSelect={handleSelectPipeline}
            onPipelinesChange={setPipelines}
          />
        </div>
      )}

      {/* One toolbar — the Active/Closed segmented toggle (sliding underline
          via motion.layoutId), search, and the focus chip when set. Was
          three separate rows; the audit said collapse, so collapsed. The
          underline track is the row's own bottom border so the indicator
          and the chrome ride the same line. */}
      {hasPipelines && (
        <div className="flex items-center gap-3 flex-wrap border-b border-border/70">
          <div role="tablist" aria-label="Deal status" className="flex items-center gap-0">
            {STATUS_TABS.map((t) => {
              const isActive = boardStatus === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleStatusChange(t.key)}
                  className={cn(
                    // 150ms text-color cross-fade pairs with the shared-
                    // layoutId underline so the toggle reads as one motion.
                    'relative inline-flex items-center px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out',
                    isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t.label}
                  {isActive && (
                    <motion.span
                      layoutId="deals-status-underline"
                      className="absolute bottom-[-1px] left-2 right-2 h-[2px] rounded-full bg-foreground"
                      transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap pb-2 sm:pb-0">
            <div className="relative min-w-[140px]">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search deals…"
                className="pl-9 pr-7 h-9 w-full sm:w-64 text-sm rounded-md border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-ring transition-all duration-150"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {focus && (
              <button
                type="button"
                onClick={() => setFocus(null)}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-foreground text-background text-xs font-medium hover:bg-foreground/90 transition-colors duration-150"
              >
                <span>{focus === 'at-risk' ? 'At risk' : 'Closing this month'}</span>
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {activePipelineId && (
        <KanbanBoard
          slug={slug}
          pipelineId={activePipelineId}
          boardStatus={boardStatus}
          focus={focus}
          searchQuery={searchQuery}
          onDataChanged={() => setSummaryRefreshKey((k) => k + 1)}
        />
      )}

      {/* Empty state — no decorative icon, serif H2 + primary pill */}
      {!hasPipelines && (
        <CreateFirstBoardCard
          slug={slug}
          onCreated={(p) => {
            setPipelines([p]);
            setActivePipelineId(p.id);
            try {
              localStorage.setItem(`chippi:deals:pipeline:${slug}`, p.id);
            } catch {}
          }}
        />
      )}
    </div>
  );
}

// First-run placeholder. Paper-flat. One click creates a default board.
function CreateFirstBoardCard({
  slug,
  onCreated,
}: {
  slug: string;
  onCreated: (p: Pipeline) => void;
}) {
  const [pending, setPending] = useState(false);
  async function handleCreate() {
    setPending(true);
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, name: 'Pipeline', color: '#6366f1' }),
      });
      if (!res.ok) return;
      const created: Pipeline = await res.json();
      onCreated(created);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2
        className="text-2xl tracking-tight text-foreground mb-2"
        style={TITLE_FONT}
      >
        No pipeline yet.
      </h2>
      <p className={cn(BODY_MUTED, 'max-w-sm mb-6')}>
        A board of stages — make one and I&apos;ll start tracking your deals.
      </p>
      <button
        type="button"
        onClick={handleCreate}
        disabled={pending}
        className={cn(PRIMARY_PILL, 'disabled:opacity-50')}
      >
        <Plus size={14} strokeWidth={2.25} />
        {pending ? 'One moment.' : 'Create your first board'}
      </button>
    </div>
  );
}
