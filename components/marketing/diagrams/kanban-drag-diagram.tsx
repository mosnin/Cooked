'use client';

/**
 * `<KanbanDragDiagram />` — a pipeline that updates itself.
 *
 * One beat: a deal card leaves Negotiating and lands in Closed Won, the
 * column counts tick (Negotiating 1→0, Closed won 0→1), and the card gains
 * a "closed · today" confirmation as Chippi back-fills the close date.
 * "Move a card, Chippi keeps the rest in sync" in one breath — told
 * entirely on the board so it reads at every aspect with no side rail to
 * overflow.
 *
 * Layout contract (the fluid-fit fix):
 *   - Root is `w-full h-full flex flex-col min-h-0`.
 *   - The 4 columns are a `grid-cols-4` that distributes width; each column
 *     body is `flex-1 min-h-0 overflow-hidden` so it fills the available
 *     height and never sums taller than the box.
 *   - No fixed-px heights anywhere. The densest frame (two cards stacked in
 *     Closed Won, the close confirmation expanded) fits the SHORTEST aspect
 *     used — `wide` (21:9), ~504×290px inner after the shell's p-6.
 *   - No secondary side panel: the field-sync story lives on the card, so
 *     there's nothing to hide or clip when the box is short.
 *
 * Motion contract:
 *   - ~6.9s cycle, EASE_APPLE throughout. One beat, then a long hold.
 *   - Pre-roll: board sits still.
 *   - Leave: source card fades + drifts right as it exits Negotiating.
 *   - Land: card fades in atop Closed Won; counts cross-fade; the column
 *     gets a restrained highlight that decays.
 *   - Confirm: "closed · today" + Chippi badge ticks in under the value.
 *   - Hold, then a calm fade-out across the diagram, then re-arm.
 *
 * Reduced-motion: card already in Closed Won, counts settled, confirmation
 * visible — the end state, no timers.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  DiagramChippiBadge,
  useDiagramMotion,
} from './chippi-diagram-shell';

interface KanbanDragDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

// 0 = pre-roll, 1 = card leaving, 2 = card landed + counts ticked,
// 3 = close confirmation in, 4 = hold, 5 = fade-out (then reset to 0).
type Phase = 0 | 1 | 2 | 3 | 4 | 5;

const PHASE_TIMINGS_MS: { phase: Phase; at: number }[] = [
  { phase: 0, at: 0 },
  { phase: 1, at: 900 },
  { phase: 2, at: 1240 },
  { phase: 3, at: 1660 },
  { phase: 4, at: 2360 },
  { phase: 5, at: 6000 },
];
const CYCLE_RESET_AT = 6400;
const CYCLE_GAP_MS = 500;

const COLUMNS = [
  { name: 'New', cards: [{ name: 'Daniels family' }] },
  { name: 'Qualifying', cards: [{ name: 'C. Park' }] },
  { name: 'Negotiating', cards: [] }, // the moving card lives here at phase 0
  { name: 'Closed won', cards: [] },
];

// Static "other" cards rendered as paper-flat tiles. The dot mirrors the
// real `DealCard` health dot (emerald = on-track), NOT a lead tier — a deal
// card communicates pipeline health, not lead temperature. These are calm
// active deals, so all on-track; the diagram isn't telling a health story.
function StaticCard({ name }: { name: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500" />
        <p className="text-[11px] font-medium leading-tight truncate text-foreground">
          {name}
        </p>
      </div>
    </div>
  );
}

export function KanbanDragDiagram({
  aspect = 'video',
  className,
}: KanbanDragDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <KanbanDragContent />
    </ChippiDiagramShell>
  );
}

function KanbanDragContent() {
  const { reduced } = useDiagramMotion();
  const [phase, setPhase] = useState<Phase>(reduced ? 4 : 0);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runCycle() {
      PHASE_TIMINGS_MS.forEach(({ phase: p, at }) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled) setPhase(p);
          }, at),
        );
      });
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setPhase(0);
          timers.push(setTimeout(runCycle, CYCLE_GAP_MS));
        }, CYCLE_RESET_AT),
      );
    }
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  const cardInCW = phase >= 2 && phase <= 4;
  const cardLeaving = phase === 1;
  const fadingOut = phase === 5;
  const confirmed = phase >= 3 && phase <= 4;

  return (
    <motion.div
      className="w-full h-full flex flex-col min-h-0"
      animate={{ opacity: fadingOut ? 0 : 1 }}
      transition={{ duration: 0.24, ease: EASE_APPLE }}
    >
      {/* Board — 4 columns. The grid distributes width; each column body
          fills the remaining height with `flex-1 min-h-0` so nothing sums
          taller than the box at any aspect. */}
      <div className="flex-1 grid grid-cols-4 gap-2 min-h-0">
        {COLUMNS.map((col, idx) => {
          const isNegotiating = idx === 2;
          const isCWCol = idx === 3;
          const showLanded = isCWCol && cardInCW;
          const showSource = isNegotiating && (phase === 0 || phase === 1);
          const isHighlight = isCWCol && (phase === 2 || phase === 3);
          // Count ticks the moment the card crosses over.
          const count =
            col.cards.length + (showLanded ? 1 : 0) + (showSource ? 1 : 0);
          return (
            <div
              key={col.name}
              className={cn(
                'flex flex-col min-h-0 rounded-lg transition-colors duration-300',
                isHighlight && 'bg-foreground/[0.03]',
              )}
            >
              <div className="px-1 pb-1.5 flex items-center justify-between gap-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                  {col.name}
                </p>
                <span className="text-[10px] tabular-nums text-muted-foreground/70 flex-shrink-0">
                  {count}
                </span>
              </div>
              <div
                className={cn(
                  'flex-1 min-h-0 rounded-md p-1.5 space-y-1.5 overflow-hidden',
                  'bg-foreground/[0.02] border border-border/70',
                )}
              >
                {col.cards.map((c) => (
                  <StaticCard key={c.name} name={c.name} />
                ))}

                {/* Negotiating starts with the moving deal card. */}
                {showSource && (
                  <motion.div
                    initial={false}
                    animate={
                      cardLeaving ? { opacity: 0, x: 10 } : { opacity: 1, x: 0 }
                    }
                    transition={{ duration: 0.3, ease: EASE_APPLE }}
                  >
                    <FocalDealCard confirmed={false} />
                  </motion.div>
                )}

                {/* Closed Won receives the card at phase 2+. */}
                {showLanded && (
                  <motion.div
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: EASE_APPLE }}
                  >
                    <FocalDealCard confirmed={confirmed} />
                  </motion.div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/**
 * The deal that moves. Carries the value (serif Times — the focal number).
 * When it lands in Closed Won a "closed · today" line ticks in beneath the
 * value with the Chippi badge: the field-sync consequence, told on the card
 * itself rather than in a side rail that would overflow a short box. The
 * row animates its own height so the card grows in place without nudging
 * the column layout.
 */
function FocalDealCard({ confirmed }: { confirmed: boolean }) {
  return (
    <div className="rounded-md border border-border/70 bg-background px-2 py-1.5">
      <div className="flex items-start gap-1">
        <GripVertical
          size={11}
          className="text-muted-foreground/40 mt-px flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {/* Health dot — emerald on-track, same vocabulary as the real
                DealCard. The deal is active and closing cleanly. */}
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500" />
            <p className="text-[11px] font-medium leading-tight truncate text-foreground">
              M. Chen · 415 Lex
            </p>
          </div>
          <p
            className="text-[15px] tabular-nums text-foreground mt-0.5 leading-none"
            style={{ fontFamily: 'var(--font-title)' }}
          >
            $475,000
          </p>
          <motion.div
            className="overflow-hidden"
            initial={false}
            animate={{
              height: confirmed ? 'auto' : 0,
              opacity: confirmed ? 1 : 0,
            }}
            transition={{ duration: 0.24, ease: EASE_APPLE }}
          >
            <div className="flex items-center gap-1.5 pt-1.5">
              <DiagramChippiBadge />
              <span className="text-[10px] text-muted-foreground tabular-nums truncate">
                closed · today
              </span>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
