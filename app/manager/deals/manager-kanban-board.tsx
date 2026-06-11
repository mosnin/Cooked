'use client';

/**
 * ManagerKanbanBoard
 *
 * Client shell for the manager-scoped deals kanban. Mirrors the rep
 * KanbanBoard look exactly: horizontal-scroll desktop columns + mobile
 * snap-to-stage. Read-only: no drag, no quick-add, no stage mutation.
 *
 * Drill-in: clicking a card redirects to manager Koala prefilled with an
 * audit prompt — "Audit the deal '<title>' owned by <rep>. What stage
 * is it at and what needs attention?" The manager stays on the read surface
 * they know.
 *
 * Mobile: one stage at a time, horizontal snap with a pill nav above
 * (mirrors the rep board pattern verbatim).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ManagerKanbanColumn } from './manager-kanban-column';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TITLE_FONT } from '@/lib/typography';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatting';
import type { ManagerDealItem } from './manager-deal-card';

export interface ManagerKanbanColumn {
  id: string;
  name: string;
  color: string;
  deals: ManagerDealItem[];
}

interface ManagerKanbanBoardProps {
  columns: ManagerKanbanColumn[];
}

/**
 * Mobile kanban — one stage column visible at a time, swipe between them.
 * Mirrors the rep MobileKanban structure verbatim.
 */
function MobileKanban({
  columns,
  onOpenDeal,
}: {
  columns: ManagerKanbanColumn[];
  onOpenDeal: (deal: ManagerDealItem) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeColumnId, setActiveColumnId] = useState<string | null>(
    columns[0]?.id ?? null,
  );

  useEffect(() => {
    if (columns.length === 0) {
      setActiveColumnId(null);
      return;
    }
    if (!columns.some((c) => c.id === activeColumnId)) {
      setActiveColumnId(columns[0].id);
    }
  }, [columns, activeColumnId]);

  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const best = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (best) {
          const id = (best.target as HTMLElement).dataset.columnId;
          if (id) setActiveColumnId(id);
        }
      },
      { root, threshold: [0.5, 0.75, 1] },
    );
    panelRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [columns]);

  function scrollToColumn(colId: string) {
    const el = panelRefs.current.get(colId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      setActiveColumnId(colId);
    }
  }

  if (columns.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Stage pill nav */}
      <div
        role="tablist"
        aria-label="Pipeline stages"
        className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1"
      >
        {columns.map((col) => {
          const isActive = col.id === activeColumnId;
          return (
            <button
              key={col.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`manager-mobile-panel-${col.id}`}
              onClick={() => scrollToColumn(col.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors duration-150 flex-shrink-0',
                isActive
                  ? 'bg-foreground text-background'
                  : 'bg-muted/50 text-muted-foreground hover:text-foreground',
              )}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: col.color }}
                aria-hidden
              />
              <span>{col.name}</span>
              <span className="tabular-nums opacity-70">{col.deals.length}</span>
            </button>
          );
        })}
      </div>

      {/* Snap scroller */}
      <div
        ref={scrollerRef}
        className="flex overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-4 px-4 gap-4 pb-2"
      >
        {columns.map((col) => (
          <div
            key={col.id}
            ref={(el) => {
              if (el) panelRefs.current.set(col.id, el);
              else panelRefs.current.delete(col.id);
            }}
            data-column-id={col.id}
            id={`manager-mobile-panel-${col.id}`}
            role="tabpanel"
            aria-label={col.name}
            className="snap-center snap-always flex-shrink-0 w-full rounded-xl border border-border/70 bg-background overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2.5 bg-foreground/[0.02] border-b border-border/70">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: col.color }}
                aria-hidden
              />
              <span className="text-sm font-semibold text-foreground truncate">
                {col.name}
              </span>
              <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
                {col.deals.length}
              </span>
            </div>
            {col.deals.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-xs text-muted-foreground">Nothing in this stage yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {col.deals.map((deal) => (
                  <button
                    key={deal.id}
                    type="button"
                    onClick={() => onOpenDeal(deal)}
                    className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-foreground/[0.04] transition-colors duration-150"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-foreground">
                        {deal.title}
                      </p>
                      {deal.address && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {deal.address}
                        </p>
                      )}
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {deal.repName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {deal.value != null && (
                        <span
                          className="text-sm tabular-nums text-foreground"
                          style={TITLE_FONT}
                        >
                          {formatCurrency(deal.value)}
                        </span>
                      )}
                      <ArrowRight size={12} className="text-muted-foreground/50" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ManagerKanbanBoard({ columns }: ManagerKanbanBoardProps) {
  const router = useRouter();
  const [rep, setRep] = useState<string>('all');

  function handleOpenDeal(deal: ManagerDealItem) {
    const prompt = `Audit the deal "${deal.title}" owned by ${deal.repName}. What stage is it at and what needs attention?`;
    router.push(`/manager?prompt=${encodeURIComponent(prompt)}`);
  }

  // Distinct rep names present in the board, sorted for a stable menu.
  const repNames = useMemo(() => {
    const set = new Set<string>();
    for (const col of columns) {
      for (const deal of col.deals) set.add(deal.repName);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [columns]);

  // Narrow cards within each column to the selected rep, then drop the
  // columns that empty out — same "no empty columns" rule the server applies.
  const visibleColumns = useMemo(() => {
    if (rep === 'all') return columns;
    return columns
      .map((col) => ({
        ...col,
        deals: col.deals.filter((d) => d.repName === rep),
      }))
      .filter((col) => col.deals.length > 0);
  }, [columns, rep]);

  if (columns.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
        <p className="text-sm text-foreground">No active deals across your team.</p>
        <p className="text-xs text-muted-foreground mt-1">
          Deals created by your member reps will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* By-rep filter — mirrors the manager activity filter idiom. Only
          shown when more than one rep has deals; with one rep it's a
          control that can't do anything. */}
      {repNames.length > 1 && (
        <div className="flex items-center gap-2">
          <Select value={rep} onValueChange={setRep}>
            <SelectTrigger className="w-[200px]" aria-label="Filter by rep">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All reps</SelectItem>
              {repNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {visibleColumns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className="text-sm text-foreground">No active deals for {rep}.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Switch back to all reps to see the full pipeline.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile: snap-to-stage */}
          <div className="md:hidden">
            <MobileKanban columns={visibleColumns} onOpenDeal={handleOpenDeal} />
          </div>

          {/* Desktop: horizontal-scroll kanban, matches rep board layout */}
          <div className="hidden md:block overflow-x-auto pb-4">
            <StaggerList key={rep} className="flex gap-4 min-w-max items-start">
              {visibleColumns.map((col) => (
                <StaggerItem key={col.id}>
                  <ManagerKanbanColumn
                    stageId={col.id}
                    stageName={col.name}
                    stageColor={col.color}
                    deals={col.deals}
                    onOpenDeal={handleOpenDeal}
                  />
                </StaggerItem>
              ))}
            </StaggerList>
          </div>
        </>
      )}
    </div>
  );
}
