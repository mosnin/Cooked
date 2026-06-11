'use client';

/**
 * `<InboxDiagram />` — the unified inbox, in here.
 *
 * One beat: the inbox rows settle in, then a Chippi "Draft ready" badge
 * arrives on the top thread — the realtor sees that the moment a lead
 * emails, the reply is already waiting. Same paper-flat vocabulary as the
 * product's communication surface.
 *
 * Motion contract: rows reveal in sequence (opacity + 6px y), the draft
 * badge lands after the last row, hold, fade all out, restart. Reduced
 * motion renders the end state with no timer.
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

interface InboxDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

const ROWS = [
  { from: 'Marcus Chen', subject: 'Re: 415 Lexington tour', time: '2m', unread: true },
  { from: 'Priya Nair', subject: 'Mortgage pre-approval letter', time: '18m', unread: true },
  { from: 'Dani Alvarez', subject: 'Thinking about listing in spring', time: '1h', unread: false },
  { from: 'Tom Whitfield', subject: 'Closing docs for 88 Pine', time: '3h', unread: false },
];

const ROW_INTERVAL = 220;
const BADGE_DELAY = 360;
const HOLD = 1500;
const PAUSE = 700;

export function InboxDiagram({ aspect = 'video', className }: InboxDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <InboxContent />
    </ChippiDiagramShell>
  );
}

function InboxContent() {
  const { reduced } = useDiagramMotion();
  // -1 nothing, 0..3 rows visible, 4 = draft badge on row 0.
  const [phase, setPhase] = useState<number>(reduced ? 4 : -1);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function run() {
      ROWS.forEach((_, i) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled) setPhase(i);
          }, i * ROW_INTERVAL + 300),
        );
      });
      timers.push(
        setTimeout(() => {
          if (!cancelled) setPhase(4);
        }, ROWS.length * ROW_INTERVAL + BADGE_DELAY + 300),
      );
      timers.push(
        setTimeout(
          () => {
            if (cancelled) return;
            setPhase(-1);
            timers.push(setTimeout(run, PAUSE));
          },
          ROWS.length * ROW_INTERVAL + BADGE_DELAY + HOLD + 300,
        ),
      );
    }

    run();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  return (
    <div className="w-full h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 rounded-xl border border-border/70 bg-background overflow-hidden flex flex-col">
        {/* Header strip */}
        <div className="shrink-0 px-4 sm:px-5 pt-3.5 pb-3 border-b border-border/60 flex items-center justify-between">
          <p
            className="text-[14px] sm:text-[15px] tracking-tight text-foreground leading-snug"
            style={{ fontFamily: 'var(--font-title)' }}
          >
            Inbox
          </p>
          <span className="text-[11px] text-muted-foreground">Gmail · Outlook</span>
        </div>

        {/* Rows */}
        <div className="flex-1 min-h-0 divide-y divide-border/60">
          {ROWS.map((row, i) => {
            const visible = phase >= i;
            return (
              <motion.div
                key={i}
                className="px-4 sm:px-5 py-2.5 flex items-center gap-3"
                initial={false}
                animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                transition={{ duration: 0.22, ease: EASE_APPLE }}
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-1.5 w-1.5 rounded-full shrink-0',
                    row.unread ? 'bg-foreground' : 'bg-transparent',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-[12px] sm:text-[13px] truncate',
                        row.unread ? 'text-foreground font-medium' : 'text-foreground/80',
                      )}
                    >
                      {row.from}
                    </span>
                    {/* Draft-ready badge lands on the top thread last. */}
                    {i === 0 && (
                      <motion.span
                        initial={false}
                        animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                        transition={{ duration: 0.22, ease: EASE_APPLE }}
                      >
                        <DiagramChippiBadge label="Draft ready" />
                      </motion.span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {row.subject}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/80">
                  {row.time}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
