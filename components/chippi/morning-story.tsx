'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';
import { SECTION_LABEL } from '@/lib/typography';
import type { MorningResponse, MorningSummary } from '@/app/api/agent/morning/route';
import { composeMorningStory, countMorningCandidates } from '@/lib/morning-story';
import { buildMorningActions, type MorningAction } from './morning-actions';
import { MorningActionSheet } from './morning-action-sheet';

interface Props {
  /** Workspace slug — needed to deep-link the inline actions. */
  slug: string;
  /**
   * True only on day one — zero contacts, zero deals, nothing in the
   * pipeline. MorningStory shows a different sentence so the space is never
   * blank for a first-time user.
   */
  isFresh?: boolean;
}

type LoadState = 'loading' | 'ok' | 'error';

/**
 * Chippi-voiced fallback sentences. Called when the API is unavailable or
 * when the data is empty/null. The sentences are direct, useful, one idea.
 */
function getFallback(state: LoadState, isFresh: boolean): string {
  if (isFresh) return "Ready to get to work. Add your first lead and I'll start tracking.";
  if (state === 'error') return "Ready when you are.";
  return "Pipeline looks clear today. A good day to reach out cold.";
}

/**
 * The /chippi home's one sentence. Phase 5 made it expand into an action
 * panel; Phase 7 made the panel actually do work — compose actions now
 * draft, preview, and send inline. The realtor never leaves the home.
 */
export function MorningStory({ slug, isFresh = false }: Props) {
  const [summary, setSummary] = useState<MorningSummary | null>(null);
  const [agentSentence, setAgentSentence] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [open, setOpen] = useState(false);
  /** Which compose action is currently expanded into a draft sheet. */
  const [activeCompose, setActiveCompose] = useState<MorningAction | null>(null);
  /**
   * In-memory cycle index for the "Next" pill. Resets on page load — tomorrow
   * morning is a new morning, no persistence. The pill increments this; the
   * ladder picks the Nth named subject down.
   */
  const [skip, setSkip] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch('/api/agent/morning', { signal: controller.signal });
        if (res.ok) {
          const data = (await res.json()) as MorningResponse;
          setSummary(data);
          setAgentSentence(data.composedSentence ?? null);
          setLoadState('ok');
        } else {
          setLoadState('error');
        }
      } catch (err) {
        // AbortError fires on unmount — don't transition to error state for that
        if (err instanceof Error && err.name !== 'AbortError') {
          setLoadState('error');
        }
      }
    })();
    return () => controller.abort();
  }, []);

  // Collapse on outside click + escape. Both matter on desktop; on mobile
  // tapping outside (e.g. on TodayFeed) is the natural close gesture too.
  // While the action sheet is firing a send, we ignore outside taps so a
  // stray click can't dismiss the panel mid-send.
  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent | TouchEvent) {
      if (!containerRef.current) return;
      const target = e.target as Node | null;
      if (target && !containerRef.current.contains(target)) {
        setOpen(false);
        setActiveCompose(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setActiveCompose(null);
      }
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // Section frame matching WhatIDid / TodayFocus / GoalsPanel — same
  // SECTION_LABEL header + divide-y row vocabulary, so the morning story
  // sits as one more list among the day's sections rather than as a
  // separate hero treatment.
  function Frame({ children }: { children: ReactNode }) {
    return (
      <section>
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>What&apos;s new</h2>
        </div>
        <div className="divide-y divide-border/60">{children}</div>
      </section>
    );
  }

  if (loadState === 'loading') {
    return (
      <Frame>
        <div className="flex items-center gap-3 py-3">
          <div className="w-7 h-7 rounded-full bg-muted/40 animate-pulse" />
          <div className="flex-1 h-4 rounded bg-muted/30 animate-pulse" />
        </div>
      </Frame>
    );
  }

  if (!summary) {
    const displaySentence = getFallback(loadState, isFresh);
    return (
      <Frame>
        <p className="py-3 text-sm text-foreground">{displaySentence}</p>
      </Frame>
    );
  }

  const candidateCount = countMorningCandidates(summary);
  const effectiveSkip = Math.min(skip, Math.max(0, candidateCount - 1));
  const story = composeMorningStory(summary, agentSentence, { skip: effectiveSkip });
  // Guard: never render a blank or whitespace-only heading. composeMorningStory
  // always returns a non-empty string for valid data, but a corrupted API
  // response could produce an empty composedSentence that slips through.
  const displaySentence = story.text?.trim() || getFallback(loadState, isFresh);
  const actions = buildMorningActions(story.doorway, summary, slug);
  const isInteractive = actions.length > 0;
  // Pill renders only when there's actually a next subject to cycle to. Once
  // we've reached the last candidate, the pill disappears — no greyed-out,
  // no "no more" copy, headline stays where it is.
  const hasNext = candidateCount > effectiveSkip + 1;

  function handleNext() {
    setSkip((n) => n + 1);
    setOpen(false);
    setActiveCompose(null);
  }

  function handleActionTap(a: MorningAction) {
    if (a.kind === 'compose') {
      setActiveCompose(a);
    }
    // 'navigate' actions are <Link>s and self-close via onClick below.
  }

  function handleSent() {
    // Roll the home back to the un-expanded sentence on success.
    setActiveCompose(null);
    setOpen(false);
  }

  function handleCancel() {
    setActiveCompose(null);
  }

  // Row treatment: small emerald check icon (matches WhatIDid's
  // success rows) + the morning sentence as body copy. Interactive
  // variant wraps the whole row in a button that expands the action
  // sheet below; non-interactive variant is a plain row.
  const rowInner = (
    <div className="flex items-start gap-3 py-3">
      <span
        aria-hidden
        className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5"
      >
        <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
      </span>
      <span className="flex-1 text-sm text-foreground leading-relaxed">
        {displaySentence}
      </span>
    </div>
  );

  return (
    <div ref={containerRef} className="relative">
      <section>
        <div className="flex items-center gap-3 pb-3 border-b border-border/60">
          <h2 className={SECTION_LABEL}>What&apos;s new</h2>
          {hasNext && (
            <button
              type="button"
              onClick={handleNext}
              className="ml-auto inline-flex items-center h-7 px-2 rounded-full text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              aria-label="Show next subject"
            >
              Next →
            </button>
          )}
        </div>

        <div className="divide-y divide-border/60">
          {isInteractive ? (
            <motion.button
              type="button"
              onClick={() => {
                setOpen((v) => !v);
                setActiveCompose(null);
              }}
              aria-expanded={open}
              key={displaySentence}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
              className="block w-full text-left hover:bg-muted/30 transition-colors cursor-pointer rounded-md -mx-2 px-2"
            >
              {rowInner}
            </motion.button>
          ) : (
            <motion.div
              key={displaySentence}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
            >
              {rowInner}
            </motion.div>
          )}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {open && isInteractive && (
          <motion.div
            key="actions"
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: { duration: DURATION_BASE, ease: EASE_OUT },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: DURATION_BASE, ease: EASE_OUT },
            }}
            className="overflow-hidden"
          >
            {activeCompose && activeCompose.kind === 'compose' ? (
              <MorningActionSheet
                slug={slug}
                intent={activeCompose.intent}
                context={activeCompose.context}
                onSent={handleSent}
                onCancel={handleCancel}
              />
            ) : (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {actions.map((a) =>
                  a.kind === 'navigate' ? (
                    <Link
                      key={a.id}
                      href={a.href}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'inline-flex items-center h-9 rounded-full px-4 text-sm transition-colors',
                        'border border-border/70 bg-background text-foreground hover:bg-muted/40',
                      )}
                    >
                      {a.label}
                    </Link>
                  ) : (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleActionTap(a)}
                      className={cn(
                        'inline-flex items-center h-9 rounded-full px-4 text-sm transition-colors',
                        'border border-border/70 bg-foreground text-background hover:bg-foreground/90',
                      )}
                    >
                      {a.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
