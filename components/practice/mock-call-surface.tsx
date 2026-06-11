'use client';

/**
 * MockCallSurface — the live practice call.
 *
 * A text chat where the rep sells and Axil replies in character as the prospect.
 * The rep types a line, it appends optimistically, and the prospect's reply
 * streams back into the thread. "End call" grades the transcript and swaps the
 * surface for the ScoreCard.
 *
 * Failure handling mirrors the server contract: if the prospect LLM fails, the
 * call stays live, the rep's optimistic turn is rolled back, and they can resend
 * the same line. No dependency on chat primitives outside this feature — this is
 * a deliberately small, self-contained composer + bubble list.
 */

import { useEffect, useRef, useState } from 'react';
import { PhoneOff, Send, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toastError } from '@/lib/toast-helpers';
import { BODY, BODY_MUTED, CAPTION, SECTION_LABEL, H2, TITLE_FONT } from '@/lib/typography';
import { ScoreCard } from './score-card';
import type { Icp, MockCall, Turn } from './types';

interface Props {
  slug: string;
  call: MockCall;
  icp: Icp | null;
  onExit: () => void;
}

export function MockCallSurface({ slug, call: initialCall, icp, onExit }: Props) {
  const [call, setCall] = useState<MockCall>(initialCall);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [scoreError, setScoreError] = useState<string | null>(null);
  // Optimistic rep turn shown while waiting for the prospect reply.
  const [pending, setPending] = useState<Turn | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const ended = call.status === 'completed' || call.status === 'abandoned';

  // Keep the thread pinned to the newest turn.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [call.transcript.length, pending]);

  const send = async () => {
    const message = draft.trim();
    if (!message || sending || ended) return;
    setSending(true);
    setDraft('');
    setPending({ role: 'rep', content: message, at: new Date().toISOString() });
    try {
      const res = await fetch(`/api/mock-calls/${call.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, action: 'turn', message }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session?: MockCall;
        error?: string;
      };
      if (!res.ok || !data.session) {
        // Roll back: put the line back in the box so the rep can resend.
        toastError(data.error ?? 'The prospect went quiet — try again.');
        setDraft(message);
        return;
      }
      setCall(data.session);
    } catch {
      toastError('Could not reach the prospect. Try again.');
      setDraft(message);
    } finally {
      setPending(null);
      setSending(false);
    }
  };

  const endCall = async () => {
    if (ending) return;
    setEnding(true);
    setScoreError(null);
    try {
      const res = await fetch(`/api/mock-calls/${call.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, action: 'end' }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        session?: MockCall;
        scoreError?: string;
        error?: string;
      };
      if (!res.ok || !data.session) {
        toastError(data.error ?? 'Could not end the call.');
        return;
      }
      setCall(data.session);
      if (data.scoreError) setScoreError(data.scoreError);
    } catch {
      toastError('Could not end the call.');
    } finally {
      setEnding(false);
    }
  };

  // ── Ended → score card ──────────────────────────────────────────────────
  if (ended) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-12 space-y-8">
        <button
          type="button"
          onClick={onExit}
          className={cn(BODY_MUTED, 'inline-flex items-center gap-1.5 hover:text-foreground')}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back to practice
        </button>
        <ScoreCard
          call={call}
          scoreError={scoreError}
          onRegrade={endCall}
          regrading={ending}
        />
      </main>
    );
  }

  // ── Live call ───────────────────────────────────────────────────────────
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 flex flex-col h-[calc(100vh-7rem)]">
      {/* Header */}
      <header className="flex items-start justify-between gap-4 pb-4 border-b border-border/60">
        <div className="space-y-0.5">
          <p className={cn(SECTION_LABEL)}>Live practice call</p>
          <h2 className={cn(H2)} style={TITLE_FONT}>
            {icp ? icp.name : 'Mock call'}
          </h2>
          {call.scenario && <p className={cn(CAPTION)}>{call.scenario}</p>}
        </div>
        <Button variant="outline" size="sm" onClick={endCall} disabled={ending}>
          <PhoneOff size={14} strokeWidth={2} className="mr-1.5" />
          {ending ? 'Ending…' : 'End & grade'}
        </Button>
      </header>

      {/* Thread */}
      <div ref={threadRef} className="flex-1 overflow-y-auto py-5 space-y-3">
        {call.transcript.length === 0 && !pending ? (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div className="space-y-1.5 max-w-sm">
              <p className={cn(BODY, 'font-medium')}>The prospect is on the line.</p>
              <p className={cn(BODY_MUTED)}>
                Open the call. Build rapport, run your discovery, and handle whatever they throw
                at you.
              </p>
            </div>
          </div>
        ) : (
          <>
            {call.transcript.map((turn, i) => (
              <Bubble key={i} turn={turn} />
            ))}
            {pending && <Bubble turn={pending} />}
            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-foreground/[0.05] px-3.5 py-2.5">
                  <span className="flex gap-1">
                    <Dot /> <Dot /> <Dot />
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Composer */}
      <div className="pt-3 border-t border-border/60">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="What do you say to the prospect?"
            rows={2}
            className="flex-1 resize-none"
            disabled={sending}
          />
          <Button onClick={send} disabled={sending || !draft.trim()} className="shrink-0">
            <Send size={14} strokeWidth={2} />
          </Button>
        </div>
        <p className={cn(CAPTION, 'mt-1.5')}>
          Enter to send, Shift+Enter for a new line. Axil plays the prospect.
        </p>
      </div>
    </main>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const isRep = turn.role === 'rep';
  return (
    <div className={cn('flex', isRep ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3.5 py-2',
          isRep
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-foreground/[0.05] text-foreground rounded-bl-sm',
        )}
      >
        <p className={cn(CAPTION, 'mb-0.5 opacity-70')}>{isRep ? 'You' : 'Prospect'}</p>
        <p className={cn(BODY, 'whitespace-pre-wrap leading-relaxed')}>{turn.content}</p>
      </div>
    </div>
  );
}

function Dot() {
  return (
    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 animate-pulse" />
  );
}
