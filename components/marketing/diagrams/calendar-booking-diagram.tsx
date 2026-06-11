'use client';

/**
 * `<CalendarBookingDiagram />` — booked from the reply.
 *
 * One beat: an empty calendar week view; a TOUR block fades into the
 * Wednesday 2pm slot; a small "Confirmed with M. Chen" row appears
 * below the grid, anchored by the Chippi badge.
 *
 * Layout is fully fluid: the grid is the single flex-1 region and splits its
 * height into equal `grid-rows-4` fractions, so it fills the shell at every
 * aspect (`video`, `wide` 21:9, `square`) with no clipping. Four hours, not
 * six, so each row stays tall enough to hold the tour block's three lines at
 * the shortest (`wide`) box. The confirmation row is shrink-0 and truncates.
 *
 * Motion contract:
 *   - 7.5s cycle.
 *   - 800ms hold on empty grid.
 *   - Tour block: opacity 0 → 1 + 6px y-translate up, 280ms, EASE_APPLE.
 *   - 600ms after block lands, confirmation row fades in (220ms).
 *   - 2.2s hold. Then 200ms fade-out across both, 700ms pause, restart.
 *
 * Reduced-motion: render tour block + confirmation row visible.
 *
 * Visual vocabulary matches the product calendar:
 *   - Hairline border around the whole grid (`border-border/60`).
 *   - Header row with day labels (`bg-muted/20`).
 *   - Hour rows separated by `border-t border-border/60`.
 *   - Tour block: hairline-bordered tile, `text-[10px] font-medium`.
 *   - Time-of-day labels: `text-[10px] tabular-nums text-muted-foreground`.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  DiagramChippiBadge,
  useDiagramMotion,
} from './chippi-diagram-shell';

interface CalendarBookingDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
// Four hours, not six: enough to stage a 2pm tour with context above (12, 1)
// and below (3) while leaving each row tall enough to hold the tour block's
// three lines at the shortest aspect (`wide`, ~56px/row at the md 2-col width).
const HOURS = ['12', '1', '2', '3'];

// Phase: 0 empty, 1 tour visible, 2 tour + confirm visible, 3 fade-out.
const TOUR_AT = 900;
const CONFIRM_AT = 1500;
const HOLD_END = 4000;
const CYCLE_TOTAL = 4600;

export function CalendarBookingDiagram({
  aspect = 'video',
  className,
}: CalendarBookingDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <CalendarBookingContent />
    </ChippiDiagramShell>
  );
}

function CalendarBookingContent() {
  const { reduced } = useDiagramMotion();
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(reduced ? 2 : 0);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runCycle() {
      timers.push(setTimeout(() => !cancelled && setPhase(1), TOUR_AT));
      timers.push(setTimeout(() => !cancelled && setPhase(2), CONFIRM_AT));
      timers.push(setTimeout(() => !cancelled && setPhase(3), HOLD_END));
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setPhase(0);
        }, HOLD_END + 250),
      );
      timers.push(setTimeout(() => !cancelled && runCycle(), CYCLE_TOTAL));
    }
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  const tourVisible = phase === 1 || phase === 2;
  const confirmVisible = phase === 2;

  return (
    <div className="w-full h-full flex flex-col gap-2.5 min-h-0">
      {/* Calendar week grid — matches product calendar vocabulary. Fills all
          available height; rows distribute as equal fractions so the tour
          block always has room at every aspect. */}
      <div className="flex-1 min-h-0 border border-border/60 rounded-md overflow-hidden bg-background flex flex-col">
        {/* Header row: time-column gutter + day labels. shrink-0. */}
        <div className="shrink-0 grid grid-cols-[36px_repeat(5,minmax(0,1fr))] border-b border-border/60 bg-muted/20">
          <div />
          {DAYS.map((d, i) => (
            <div
              key={d}
              className="px-1.5 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              {d}
              <span className="block text-[11px] tabular-nums text-foreground/80 leading-tight mt-0.5">
                {i + 4}
              </span>
            </div>
          ))}
        </div>

        {/* Hour grid — flex-1 fills the card; grid-rows-4 splits the height
            into equal fractions so each hour row grows/shrinks with the box. */}
        <div className="flex-1 min-h-0 grid grid-cols-[36px_repeat(5,minmax(0,1fr))] grid-rows-4">
          {HOURS.map((h, rowIdx) => (
            <div key={h} className="contents">
              {/* Time gutter cell */}
              <div
                className={cn(
                  'px-1 py-1 text-[10px] tabular-nums text-muted-foreground/80 text-right',
                  rowIdx > 0 && 'border-t border-border/60',
                )}
              >
                {h}
              </div>
              {DAYS.map((d) => {
                const isTourCell = d === 'Wed' && h === '2';
                return (
                  <div
                    key={`${d}-${h}`}
                    className={cn(
                      'relative min-h-0 border-l border-border/60',
                      rowIdx > 0 && 'border-t border-border/60',
                    )}
                  >
                    {isTourCell && (
                      <motion.div
                        initial={false}
                        animate={
                          tourVisible
                            ? { opacity: 1, y: 0 }
                            : { opacity: 0, y: 6 }
                        }
                        transition={{ duration: 0.28, ease: EASE_APPLE }}
                        className={cn(
                          'absolute inset-x-1 top-1 bottom-1 rounded overflow-hidden',
                          'bg-foreground/[0.06] border border-foreground/15',
                          'px-1.5 py-1 flex flex-col justify-between gap-0.5',
                        )}
                      >
                        <div className="min-w-0">
                          <p className="text-[9px] uppercase tracking-wider text-foreground/70 leading-none">
                            Tour
                          </p>
                          <p className="text-[10px] font-medium text-foreground leading-tight mt-0.5 truncate">
                            415 Lexington
                          </p>
                        </div>
                        <p className="text-[9px] tabular-nums text-muted-foreground leading-none truncate">
                          2 – 2:45p
                        </p>
                      </motion.div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Confirmation strip — quiet row below the grid; the Chippi badge
          anchors the authorship. shrink-0 so the grid above stays fluid.
          The day + time live on the grid block already, so the strip says
          one thing — Chippi booked it — and truncates rather than wrapping
          at the narrowest (`wide`) width. */}
      <motion.div
        initial={false}
        animate={confirmVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
        transition={{ duration: 0.24, ease: EASE_APPLE }}
        className="shrink-0 flex items-center gap-2 text-[11px]"
      >
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-foreground/[0.04] flex-shrink-0">
          <CalendarCheck size={12} strokeWidth={1.75} className="text-foreground/80" />
        </span>
        <span className="min-w-0 truncate text-foreground">Confirmed with M. Chen</span>
        <span className="ml-auto shrink-0">
          <DiagramChippiBadge label="Chippi" />
        </span>
      </motion.div>
    </div>
  );
}
