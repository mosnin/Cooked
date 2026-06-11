'use client';

/**
 * `<ComposerDraftDiagram />` — Chippi drafts the reply.
 *
 * One beat: a Chippi-authored draft fills in inside a real-looking email
 * composer, then a Send pill appears in the draft card's action row. The
 * realtor sees the agent writing the email they were going to type anyway.
 * That's the whole pitch in one card.
 *
 * Layout is fully fluid: the draft card is the single flex-1 region, so the
 * diagram fills the shell at `square` (tall) and stays inside it at `video`
 * (short) with no clipping. The header strip and the in-card action row are
 * the only fixed-height (shrink-0) chrome.
 *
 * Motion contract:
 *   - 6.8s cycle, ~1.3s tail hold before reset.
 *   - The draft body fills in 4 lines; each line lands 280ms after the
 *     prior, opacity + 6px y-translate, EASE_APPLE.
 *   - When the body has 4 lines, a Send pill fades in (220ms).
 *   - Reset: everything fades out together (180ms), 600ms hold, restart.
 *   - No character-by-character typing on the subject (slop tell).
 *   - No spinning, no pulsing, no fake cursors.
 *
 * Reduced-motion: render the END state — all 4 lines + Send pill visible,
 * no internal timer running.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { brandOrange } from '@/lib/colors';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  DiagramChippiBadge,
  useDiagramMotion,
} from './chippi-diagram-shell';

interface ComposerDraftDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

const DRAFT_LINES = [
  'Hi Marcus, happy to show you 415 Lexington on',
  'Saturday at 2pm. It’s a south-facing two-bed with',
  'the rooftop your wife asked about. I’ll bring the',
  'comparable sales for the block. See you then.',
];

// Phase budget. Each line lands 280ms after the prior; the Send pill
// arrives 360ms after the last line; we hold ~1.3s, then reset.
const LINE_INTERVAL = 280;
const SEND_DELAY_AFTER_LAST_LINE = 360;
const HOLD_BEFORE_RESET = 1300;
const FADE_OUT = 200;
const PAUSE_AFTER_RESET = 700;

export function ComposerDraftDiagram({
  aspect = 'square',
  className,
}: ComposerDraftDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <ComposerDraftContent />
    </ChippiDiagramShell>
  );
}

function ComposerDraftContent() {
  const { reduced } = useDiagramMotion();
  // -1 = nothing drafted yet, 0..3 = that many lines visible, 4 = all lines
  //  + Send pill visible. Reduced-motion lands at 4 immediately.
  const [phase, setPhase] = useState<number>(reduced ? 4 : -1);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    function runCycle() {
      // Step 0..3 — reveal each line in sequence.
      DRAFT_LINES.forEach((_, i) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled) setPhase(i);
          }, i * LINE_INTERVAL + 400),
        );
      });
      // Step 4 — Send pill arrives.
      timers.push(
        setTimeout(
          () => {
            if (!cancelled) setPhase(4);
          },
          DRAFT_LINES.length * LINE_INTERVAL + SEND_DELAY_AFTER_LAST_LINE + 400,
        ),
      );
      // Hold, then reset to -1 and re-arm.
      timers.push(
        setTimeout(
          () => {
            if (cancelled) return;
            setPhase(-1);
            timers.push(setTimeout(runCycle, PAUSE_AFTER_RESET));
          },
          DRAFT_LINES.length * LINE_INTERVAL +
            SEND_DELAY_AFTER_LAST_LINE +
            HOLD_BEFORE_RESET +
            FADE_OUT +
            400,
        ),
      );
    }

    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  return (
    // Root fills the shell. The composer card takes the whole box; inside it,
    // the Chippi draft is the one flex-1 region that absorbs the available
    // height — so the diagram grows tall at `square` and shrinks at the short
    // `video` aspect without ever summing past the box.
    <div className="w-full h-full flex flex-col min-h-0">
      {/* Composer card. Hairline border, paper-flat. Same vocabulary as
          the product's email read view (subject as headline, sender below). */}
      <div className="flex-1 min-h-0 rounded-xl border border-border/70 bg-background overflow-hidden flex flex-col">
        {/* Header strip: Re: subject + meta. Subject does NOT animate.
            Fixed-height chrome (shrink-0) — the only non-fluid block. */}
        <div className="shrink-0 px-4 sm:px-5 pt-3.5 pb-3 border-b border-border/60">
          <p
            className="text-[14px] sm:text-[15px] tracking-tight text-foreground leading-snug truncate"
            style={{ fontFamily: 'var(--font-title)' }}
          >
            Re: 415 Lexington, tour Saturday
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
            To <span className="text-foreground/80">Marcus Chen</span>
          </p>
        </div>

        {/* Body area — the draft card is the only thing the eye lands on and
            the only fluid region. It fills whatever height is left. */}
        <div className="flex-1 min-h-0 p-3 sm:p-4 flex">
          {/* Chippi draft card. Left rail tinted with the agent border
              treatment so the block reads as "this came from Chippi". */}
          <div className="flex-1 min-h-0 rounded-xl border border-border/70 bg-card overflow-hidden flex flex-col">
            {/* Card header: authorship + Draft tag. shrink-0. */}
            <div className="shrink-0 px-3.5 py-2.5 border-b border-border/60 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <DiagramChippiBadge />
                <span className="text-[11px] text-muted-foreground truncate">
                  Drafted just now.
                </span>
              </div>
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground/80">
                Draft
              </span>
            </div>

            {/* Draft body — fills the card. The orange left rail is the agent
                signature. Lines reveal in sequence; the region flexes so a
                tall box just adds breathing room above the action row. */}
            <div
              className={brandOrange(
                'AGENT_BADGE',
                'flex-1 min-h-0 px-3.5 py-3 border-l-2 border-orange-400 dark:border-orange-500/60 flex flex-col',
              )}
            >
              <div className="space-y-1.5">
                {DRAFT_LINES.map((line, i) => {
                  const visible = phase >= i;
                  return (
                    <motion.p
                      key={i}
                      className="text-[12px] sm:text-[13px] leading-snug text-foreground"
                      initial={false}
                      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                      transition={{ duration: 0.22, ease: EASE_APPLE }}
                    >
                      {line}
                    </motion.p>
                  );
                })}
              </div>
            </div>

            {/* Action row — lives INSIDE the draft card, hairline-divided,
                so the Send pill never stacks a separate row that overflows
                the box. Pill fades in once the draft has fully landed. */}
            <div className="shrink-0 px-3.5 py-2.5 border-t border-border/60 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground truncate">
                Drafted from the last thread.
              </span>
              <motion.span
                className={cn(
                  'shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-medium',
                  'bg-foreground text-background',
                )}
                initial={false}
                animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 4 }}
                transition={{ duration: 0.22, ease: EASE_APPLE }}
              >
                <Send size={11} strokeWidth={2} />
                Send
              </motion.span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
