'use client';

/**
 * `<TemplateAdaptDiagram />` — Chippi makes a template sound like you.
 *
 * One beat: a template skeleton on the left with placeholder slots; the same
 * template on the right with the slots filling in one at a time. When all
 * slots are filled, the small Chippi badge signs the draft ("Adapted by
 * Chippi") in the draft pane's corner.
 *
 * Layout: split-pane (skeleton left, adapted right). Naturally wide, so it
 * holds at the video hero and the 21:9 section alike. The panes flex to fill
 * the shell at any height; the message body is the focal element and takes
 * the remaining space, so nothing overflows the shorter wide box. The badge
 * floats in the draft pane's corner rather than a fixed footer row, so it
 * never adds height that could push the body out of frame.
 *
 * Motion contract:
 *   - ~8s cycle.
 *   - 800ms hold on the unfilled state.
 *   - Slot fill-ins: 4 slots, 420ms apart. Each: opacity 0 → 1 + 4px y
 *     translate, 220ms, EASE_APPLE.
 *   - 240ms after the last slot, the Chippi badge fades in.
 *   - 1.6s hold. Reset, 700ms pause, restart.
 *
 * Reduced-motion: all slots filled + Chippi badge visible.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  DiagramChippiBadge,
  useDiagramMotion,
} from './chippi-diagram-shell';

interface TemplateAdaptDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

interface Slot {
  placeholder: string;
  filled: string;
}

const TEMPLATE_LINES: ({ type: 'text'; text: string } | { type: 'slot'; slot: Slot })[] = [
  { type: 'text', text: 'Hi ' },
  { type: 'slot', slot: { placeholder: '{first_name}', filled: 'Marcus' } },
  { type: 'text', text: ', thanks for the note about ' },
  { type: 'slot', slot: { placeholder: '{property}', filled: '415 Lexington' } },
  { type: 'text', text: '. I have a slot ' },
  { type: 'slot', slot: { placeholder: '{tour_time}', filled: 'Saturday at 2pm' } },
  { type: 'text', text: ' if that works. I’ll bring ' },
  { type: 'slot', slot: { placeholder: '{packet}', filled: 'comparable sales for the block' } },
  { type: 'text', text: '.' },
];

const SLOT_COUNT = TEMPLATE_LINES.filter((l) => l.type === 'slot').length;

const SLOT_AT = (i: number) => 800 + i * 420;
const BADGE_AT = SLOT_AT(SLOT_COUNT - 1) + 240;
const HOLD_END = BADGE_AT + 1600;
const CYCLE_TOTAL = HOLD_END + 700;

export function TemplateAdaptDiagram({
  aspect = 'wide',
  className,
}: TemplateAdaptDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <TemplateAdaptContent />
    </ChippiDiagramShell>
  );
}

function PaneHeader({ label, title }: { label: string; title: string }) {
  return (
    <div className="px-3.5 py-2 border-b border-border/60 flex-shrink-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
        {label}
      </p>
      <p
        className="mt-0.5 text-[13px] tracking-tight text-foreground leading-snug truncate"
        style={{ fontFamily: 'var(--font-title)' }}
      >
        {title}
      </p>
    </div>
  );
}

function TemplateAdaptContent() {
  const { reduced } = useDiagramMotion();
  const [slotsFilled, setSlotsFilled] = useState(reduced ? SLOT_COUNT : 0);
  const [badgeVisible, setBadgeVisible] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runCycle() {
      for (let i = 0; i < SLOT_COUNT; i++) {
        timers.push(
          setTimeout(() => {
            if (!cancelled) setSlotsFilled(i + 1);
          }, SLOT_AT(i)),
        );
      }
      timers.push(setTimeout(() => !cancelled && setBadgeVisible(true), BADGE_AT));
      timers.push(
        setTimeout(() => {
          if (cancelled) return;
          setSlotsFilled(0);
          setBadgeVisible(false);
        }, HOLD_END),
      );
      timers.push(setTimeout(() => !cancelled && runCycle(), CYCLE_TOTAL));
    }
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  return (
    <div className="w-full h-full grid grid-cols-2 gap-3 min-h-0">
      {/* LEFT — the template skeleton */}
      <div className="flex flex-col min-h-0 min-w-0 rounded-xl border border-border/70 bg-card overflow-hidden">
        <PaneHeader label="Template" title="Tour reply · Brooklyn" />
        <div className="flex-1 min-h-0 overflow-hidden px-3.5 py-3 text-[12px] text-foreground/80 leading-relaxed">
          {TEMPLATE_LINES.map((line, i) =>
            line.type === 'text' ? (
              <span key={i}>{line.text}</span>
            ) : (
              <span
                key={i}
                className="inline-block rounded px-1 py-0.5 mx-0.5 text-[11px] font-mono bg-foreground/[0.04] text-muted-foreground"
              >
                {line.slot.placeholder}
              </span>
            ),
          )}
        </div>
      </div>

      {/* RIGHT — the adapted draft. The Chippi badge floats in the corner so
          it signs the draft without a fixed footer row that would steal
          height from the body in the short wide box. */}
      <div className="relative flex flex-col min-h-0 min-w-0 rounded-xl border border-border/70 bg-card overflow-hidden">
        <PaneHeader label="Draft for Marcus" title="Re: 415 Lexington" />
        <div className="flex-1 min-h-0 overflow-hidden px-3.5 py-3 pb-8 text-[12px] text-foreground leading-relaxed">
          {TEMPLATE_LINES.map((line, i) => {
            if (line.type === 'text') return <span key={i}>{line.text}</span>;
            // count which slot index this is in source order
            const slotIndex = TEMPLATE_LINES.slice(0, i).filter(
              (l) => l.type === 'slot',
            ).length;
            const filled = slotsFilled > slotIndex;
            return (
              <motion.span
                key={i}
                initial={false}
                animate={filled ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                transition={{ duration: 0.22, ease: EASE_APPLE }}
                className={cn(
                  'inline-block font-medium',
                  // Until filled, occupy the same horizontal space as the
                  // placeholder so the text doesn't reflow mid-cycle. We
                  // do this with a transparent span of the placeholder text.
                  !filled && 'text-transparent',
                )}
              >
                {filled ? line.slot.filled : line.slot.placeholder}
              </motion.span>
            );
          })}
        </div>
        <motion.span
          initial={false}
          animate={badgeVisible ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
          transition={{ duration: 0.22, ease: EASE_APPLE }}
          className="absolute bottom-2.5 right-3 z-10"
        >
          <DiagramChippiBadge label="Adapted by Chippi" />
        </motion.span>
      </div>
    </div>
  );
}
