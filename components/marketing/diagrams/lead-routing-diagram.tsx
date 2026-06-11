'use client';

/**
 * `<LeadRoutingDiagram />` — every lead, the right realtor.
 *
 * One beat: a new-lead card; a hairline draws to a center routing-engine
 * card; a second hairline draws to one of three realtor pills; the chosen
 * realtor's pill firms up (border darkens a hairline) and reads "assigned".
 * That's it.
 *
 * Motion contract (≈8s cycle):
 *   - Phase 0 (700ms): connectors empty, lead pill quiet.
 *   - Phase 1 (≈320ms): first connector draws (lead → engine) via stroke-dashoffset.
 *   - Phase 2 (≈320ms, after a beat): second connector draws (engine → realtor).
 *   - Phase 3 (≈220ms): assigned realtor pill's border firms + "assigned" fades in.
 *   - hold, then everything fades to empty, a pause, restart.
 *
 * Reduced-motion: connectors drawn full, assigned realtor highlighted.
 *
 * FLUID-FIT — the layout is orientation-aware and the connectors live IN
 * the flex gaps:
 *   - Landscape aspects (wide / video / tall) run the flow on the X axis:
 *     lead → engine → realtors, left to right.
 *   - The square aspect runs the SAME flow on the Y axis (lead on top,
 *     engine in the middle, realtors at the bottom) so a horizontal flow
 *     never gets crushed into a square box.
 *   - Each connector is its OWN `flex-1` SVG that fills the gap cell between
 *     two real nodes (`w-full h-full`, `preserveAspectRatio="none"`, a line
 *     drawn edge-to-edge). Because the SVG physically IS the gap, the line
 *     always touches both neighbors at every width — there is no shared
 *     coordinate space to drift. The draw itself is the sanctioned
 *     stroke-dashoffset animation, rendered as a 1px non-scaling stroke in
 *     `currentColor` (foreground/35) so it reads as line-art.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  useDiagramMotion,
} from './chippi-diagram-shell';

type Aspect = 'video' | 'square' | 'wide' | 'tall';

interface LeadRoutingDiagramProps {
  aspect?: Aspect;
  className?: string;
}

const REALTORS = [
  { id: 'k', name: 'Kira', initials: 'KW', load: '5 in flight' },
  { id: 'd', name: 'Dom', initials: 'DM', load: '3 in flight · 2 today' },
  { id: 't', name: 'Theo', initials: 'TL', load: '5 in flight' },
];
const ASSIGNED_REALTOR_ID = 'd';

const P1_AT = 700;
const P2_AT = 1250;
const P3_AT = 1700;
const HOLD_END = 4600;
const CYCLE_TOTAL = 5400;

export function LeadRoutingDiagram({
  aspect = 'wide',
  className,
}: LeadRoutingDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={8} className={className}>
      <LeadRoutingContent aspect={aspect} />
    </ChippiDiagramShell>
  );
}

function LeadRoutingContent({ aspect }: { aspect: Aspect }) {
  const { reduced } = useDiagramMotion();
  // 0 = nothing drawn; 1 = path 1 drawn; 2 = path 2 drawn; 3 = realtor pill firmed.
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(reduced ? 3 : 0);

  // Square reads top→down; every other aspect reads left→right. Same flow,
  // rotated to fit the box so nothing is crushed.
  const vertical = aspect === 'square';

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runCycle() {
      timers.push(setTimeout(() => !cancelled && setPhase(1), P1_AT));
      timers.push(setTimeout(() => !cancelled && setPhase(2), P2_AT));
      timers.push(setTimeout(() => !cancelled && setPhase(3), P3_AT));
      timers.push(setTimeout(() => !cancelled && setPhase(0), HOLD_END));
      timers.push(setTimeout(() => !cancelled && runCycle(), CYCLE_TOTAL));
    }
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  return (
    <div
      className={cn(
        'w-full h-full min-h-0 flex items-stretch',
        vertical ? 'flex-col' : 'flex-row',
      )}
    >
      <LeadCard vertical={vertical} />

      <Connector vertical={vertical} drawn={phase >= 1} />

      <EngineCard vertical={vertical} />

      <Connector vertical={vertical} drawn={phase >= 2} />

      <RealtorGroup vertical={vertical} firmed={phase >= 3} />
    </div>
  );
}

/**
 * The connector lives in a `flex-1` cell that occupies the gap between two
 * nodes. The SVG fills the cell (`preserveAspectRatio="none"`) and draws a
 * straight line from edge to edge along the flow axis, centered on the cross
 * axis. Because the cell IS the gap, the line always lands on both nodes —
 * no shared coordinate space to drift.
 */
function Connector({ vertical, drawn }: { vertical: boolean; drawn: boolean }) {
  // Fixed 100×100 viewBox + preserveAspectRatio="none" stretches the line to
  // whatever size the gap cell renders at. Endpoints pull 6 units in from
  // each edge so the line breathes off the card borders.
  const d = vertical ? 'M 50,6 L 50,94' : 'M 6,50 L 94,50';
  return (
    <div
      aria-hidden
      className={cn(
        'flex-1 self-stretch min-w-0 min-h-0 flex items-center justify-center',
        // Floor on the gap so the line is always visible even when the box is
        // tight; flex-1 lets it grow with the frame.
        vertical ? 'min-h-[16px]' : 'min-w-[16px]',
      )}
    >
      <svg
        className="w-full h-full text-foreground/35"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {/* pathLength=1 normalizes the path so dasharray "1 1" + dashoffset
            0→1 reads as a percent draw regardless of the real (stretched)
            length. non-scaling-stroke keeps the hairline 1px at any scale. */}
        <motion.path
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          initial={false}
          animate={{ strokeDashoffset: drawn ? 0 : 1 }}
          transition={{ duration: 0.32, ease: EASE_APPLE }}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

function LeadCard({ vertical }: { vertical: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col justify-center min-h-0',
        vertical
          ? 'w-full flex-shrink-0'
          : 'flex-shrink-0 basis-[34%] max-w-[200px]',
      )}
    >
      <div className="rounded-xl border border-border/70 bg-background px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
          New lead
        </p>
        <p className="mt-1.5 text-[13px] font-medium text-foreground leading-tight truncate">
          Sandra Liu
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          Zillow intake · Brooklyn
        </p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/15">
          <span className="w-1.5 h-1.5 rounded-full bg-lead-cold flex-shrink-0" />
          cold · just now
        </div>
      </div>
    </div>
  );
}

function EngineCard({ vertical }: { vertical: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col justify-center min-h-0',
        vertical
          ? 'w-full flex-shrink-0'
          : 'flex-shrink-0 basis-[30%] max-w-[180px]',
      )}
    >
      <div className="rounded-xl border border-border/70 bg-background px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
          auto-assignment
        </p>
        <p className="mt-1.5 text-[12px] text-foreground leading-tight">
          Brooklyn · weighted by load
        </p>
      </div>
    </div>
  );
}

function RealtorGroup({
  vertical,
  firmed,
}: {
  vertical: boolean;
  firmed: boolean;
}) {
  return (
    <div
      className={cn(
        'min-h-0 min-w-0 flex',
        // Horizontal flow: realtors stack in a right rail and the column
        // distributes them. Vertical flow: realtors sit in a row of three
        // at the bottom.
        vertical
          ? 'w-full flex-shrink-0 flex-row gap-2'
          : 'flex-shrink-0 basis-[34%] max-w-[200px] flex-col justify-center gap-2',
      )}
    >
      {REALTORS.map((r) => {
        const isAssigned = r.id === ASSIGNED_REALTOR_ID;
        const highlight = isAssigned && firmed;
        return (
          <motion.div
            key={r.id}
            initial={false}
            animate={{ opacity: highlight ? 1 : isAssigned ? 0.92 : 0.62 }}
            transition={{ duration: 0.22, ease: EASE_APPLE }}
            className={cn(
              'flex items-center rounded-xl border bg-background transition-colors duration-300 min-w-0',
              vertical
                ? 'flex-1 flex-col text-center gap-1 px-2 py-2'
                : 'gap-2.5 px-2.5 py-2',
              highlight ? 'border-foreground/45' : 'border-border/70',
            )}
          >
            <div className="w-7 h-7 rounded-full bg-foreground/[0.06] flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-medium text-foreground/80">
                {r.initials}
              </span>
            </div>
            <div className={cn('min-w-0', vertical ? 'w-full' : 'flex-1')}>
              <p className="text-[12px] font-medium text-foreground leading-tight truncate">
                {r.name}
              </p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5 truncate">
                {highlight ? 'assigned' : r.load}
              </p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
