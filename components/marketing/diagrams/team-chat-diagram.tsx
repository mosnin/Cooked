'use client';

/**
 * `<TeamChatDiagram />` — the room that knows the deal.
 *
 * One beat: a left channel rail (# 415-lexington, # general, # agents) and
 * a conversation pane. A teammate's message appears, then a "@chippi"
 * mention, then a Chippi reply bubble carrying the `DiagramChippiBadge` —
 * the one sanctioned orange moment. Then it resets. The pitch in one
 * breath: the conversation lives with the deal, and Chippi joins when
 * you call it.
 *
 * Bubble vocabulary mirrors the real product (`team-chat-client.tsx`):
 *   - incoming bubble: rounded-lg border border-border/60 bg-background
 *   - @mentions: font-semibold text-foreground
 *   - Chippi reply: "Chippi" name in orange above a paper-flat bubble
 * Brand orange appears ONLY on the Chippi reply — nowhere else.
 *
 * Motion contract:
 *   - ~8.2s cycle.
 *   - 600ms pre-roll.
 *   - Teammate message in (240ms), 900ms beat.
 *   - @chippi mention message in (240ms), 700ms beat.
 *   - Chippi reply bubble in (260ms), 3.0s hold.
 *   - Fade out together, 700ms pause, restart.
 *
 * Fit: the channel rail is `hidden md:flex` — on short/narrow boxes the
 * conversation pane carries the beat alone, full width.
 *
 * Reduced-motion: render the END state — all three messages present.
 */

import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EASE_APPLE } from '@/lib/motion';
import {
  ChippiDiagramShell,
  DiagramChippiBadge,
  useDiagramMotion,
} from './chippi-diagram-shell';

interface TeamChatDiagramProps {
  aspect?: 'video' | 'square' | 'wide' | 'tall';
  className?: string;
}

const CHANNELS = [
  { id: 'lexington', name: '415-lexington', active: true },
  { id: 'general', name: 'general', active: false },
  { id: 'agents', name: 'agents', active: false },
];

// 0 = pre-roll, 1 = teammate msg, 2 = @chippi mention, 3 = Chippi reply, 4 = hold.
type Phase = 0 | 1 | 2 | 3 | 4;

const PHASE_TIMINGS_MS: { phase: Phase; at: number }[] = [
  { phase: 0, at: 0 },
  { phase: 1, at: 600 },
  { phase: 2, at: 1740 },
  { phase: 3, at: 2680 },
  { phase: 4, at: 2940 },
];
const CYCLE_RESET_AT = 6200;
const PAUSE_AFTER_RESET = 700;

/** Render content with a single @mention highlighted (foreground bold),
 *  matching the product's `renderContent` treatment. */
function withMention(text: string, mention: string) {
  const idx = text.indexOf(mention);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold text-foreground">{mention}</span>
      {text.slice(idx + mention.length)}
    </>
  );
}

function IncomingBubble({
  sender,
  time,
  children,
  visible,
}: {
  sender: string;
  time: string;
  children: React.ReactNode;
  visible: boolean;
}) {
  return (
    <motion.div
      className="flex flex-col items-start"
      initial={false}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
      transition={{ duration: 0.24, ease: EASE_APPLE }}
    >
      <p className="text-[11px] mb-0.5 ml-1 tabular-nums">
        <span className="font-medium text-foreground">{sender}</span>{' '}
        <span className="text-muted-foreground">{time}</span>
      </p>
      <div className="max-w-[88%] rounded-lg border border-border/60 bg-background px-3 py-1.5">
        <p className="text-[13px] text-foreground leading-snug">{children}</p>
      </div>
    </motion.div>
  );
}

export function TeamChatDiagram({
  aspect = 'video',
  className,
}: TeamChatDiagramProps) {
  return (
    <ChippiDiagramShell aspect={aspect} pad={6} className={className}>
      <TeamChatContent />
    </ChippiDiagramShell>
  );
}

function TeamChatContent() {
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
          timers.push(setTimeout(runCycle, PAUSE_AFTER_RESET));
        }, CYCLE_RESET_AT),
      );
    }
    runCycle();
    return () => {
      cancelled = true;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [reduced]);

  return (
    <div className="w-full h-full flex gap-4 min-h-0">
      {/* Channel rail — hidden on short/narrow boxes; the conversation
          carries the beat alone there. */}
      <div className="hidden md:flex w-[150px] shrink-0 flex-col min-h-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 pb-2">
          Channels
        </p>
        <ul className="space-y-0.5">
          {CHANNELS.map((c) => (
            <li
              key={c.id}
              className={cn(
                'relative flex items-center gap-1.5 h-7 pl-2 pr-2 rounded-md text-[12px]',
                c.active
                  ? 'bg-foreground/[0.05] text-foreground font-medium'
                  : 'text-muted-foreground',
              )}
            >
              {c.active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-foreground"
                />
              )}
              <Hash size={12} className="flex-shrink-0 opacity-60" />
              <span className="truncate">{c.name}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Conversation pane */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {/* Channel header — deal name + a quiet hairline rule, like a deal
            channel header in the product. */}
        <div className="flex items-center gap-1.5 pb-2.5 border-b border-border/60 flex-shrink-0">
          <Hash size={14} className="text-muted-foreground flex-shrink-0" />
          <span className="text-[13px] font-medium text-foreground truncate">
            415-lexington
          </span>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-border/70 bg-foreground/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 whitespace-nowrap">
            In contract
          </span>
        </div>

        {/* Messages — anchored to the bottom so the conversation reads as a
            live thread filling upward. flex-1 + justify-end + min-h-0. */}
        <div className="flex-1 min-h-0 flex flex-col justify-end gap-2.5 pt-3">
          <IncomingBubble sender="Devin" time="9:24" visible={phase >= 1}>
            offer&apos;s in on 415. buyer wants a Saturday walkthrough.
          </IncomingBubble>

          <IncomingBubble sender="Maya" time="9:25" visible={phase >= 2}>
            {withMention('@chippi where does this deal stand right now?', '@chippi')}
          </IncomingBubble>

          {/* Chippi reply — the one sanctioned orange moment. Name in orange
              above a paper-flat bubble, mirroring the product bot bubble. */}
          <motion.div
            className="flex flex-col items-start"
            initial={false}
            animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: 0.26, ease: EASE_APPLE }}
          >
            <div className="mb-1 ml-0.5">
              <DiagramChippiBadge />
            </div>
            <div className="max-w-[88%] rounded-lg border border-border/60 bg-background px-3 py-2">
              <p className="text-[13px] text-foreground leading-snug">
                in contract · $475,000. walkthrough booked Saturday 2pm.
                inspection clears Thursday.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
