'use client';

/**
 * /s/[slug]/calls — Call log.
 *
 * One intent: a quiet record of who you called and what Chippi heard. Each row
 * is a call with a status pill, the contact (or number), and how long it ran.
 * Tap a row to expand its Chippi summary and full transcript.
 *
 * Design: Jobs lens — paper-flat, hairline-divided rows, calm copy. The
 * summary is the focal payoff inside an expanded row; the transcript sits
 * quietly beneath it. No configuration the realtor operates here — placing a
 * call happens from a contact; this surface is the memory.
 */

import { useCallback, useEffect, useState } from 'react';
import { Phone, PhoneOff, ChevronDown } from 'lucide-react';
import { StaggerList, StaggerItem } from '@/components/motion/stagger-list';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  SECTION_LABEL,
  CAPTION,
  META,
} from '@/lib/typography';

// ── Types ───────────────────────────────────────────────────────────────────

type CallStatus =
  | 'initiated'
  | 'ringing'
  | 'answered'
  | 'completed'
  | 'failed'
  | 'no_answer';

interface Call {
  id: string;
  contactId: string | null;
  contactName: string | null;
  direction: 'outbound' | 'inbound';
  fromNumber: string;
  toNumber: string;
  status: CallStatus;
  recordingUrl: string | null;
  transcript: string | null;
  summary: string | null;
  durationSec: number | null;
  createdAt: string;
}

// Status pill tones — the canonical status palette from STYLESHEET.md.
const STATUS_STYLES: Record<CallStatus, string> = {
  initiated: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  ringing: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  answered: 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15',
  completed: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15',
  no_answer: 'text-muted-foreground bg-muted',
  failed: 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-500/15',
};

const STATUS_LABELS: Record<CallStatus, string> = {
  initiated: 'Calling',
  ringing: 'Ringing',
  answered: 'Connected',
  completed: 'Completed',
  no_answer: 'No answer',
  failed: 'Failed',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusSentence(calls: Call[]): string {
  if (calls.length === 0) return 'Your calls land here, recorded and summarized.';
  const last = calls[0];
  const who = last.contactName ?? last.toNumber;
  return `Last call: ${who}.`;
}

// ── Main view ────────────────────────────────────────────────────────────────

export function CallsView({ slug }: { slug: string }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [number, setNumber] = useState('');
  const [placing, setPlacing] = useState(false);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch(`/api/calls?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setCalls([]);
        return;
      }
      const data = (await res.json()) as { calls?: Call[] };
      setCalls(data.calls ?? []);
    } catch {
      setCalls([]);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  const placeCall = async () => {
    const to = number.trim();
    if (!to) {
      toastError('Enter a number to call.');
      return;
    }
    setPlacing(true);
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, toNumber: to }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        configured?: boolean;
        message?: string;
      };
      // Validation / auth / rate-limit failures are non-2xx.
      if (!res.ok) {
        toastError(data.error ?? 'Could not place the call.');
        return;
      }
      // The route returns 200 even when voice isn't set up; the signal is
      // `configured: false`. Show the reason and refresh the log either way.
      if (data.configured === false) {
        toastError(data.message ?? 'Calling is not set up for this workspace yet.');
        fetchCalls();
        return;
      }
      setNumber('');
      toastSuccess('Calling — your phone rings first, then we connect you.');
      fetchCalls();
    } catch {
      toastError('Could not place the call.');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-12 space-y-12">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Calls.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Your call log
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence(calls)}</p>
      </header>

      {/* ── Start a call ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border/70 bg-card px-5 py-5 space-y-3">
        <p className={cn(SECTION_LABEL)}>Start a call</p>
        <div className="flex items-center gap-2">
          <Input
            type="tel"
            inputMode="tel"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !placing) placeCall();
            }}
            placeholder="+1 (555) 123-4567"
            className="flex-1"
            disabled={placing}
          />
          <Button onClick={placeCall} disabled={placing || !number.trim()}>
            <Phone size={14} strokeWidth={2} className="mr-1.5" />
            {placing ? 'Calling…' : 'Call'}
          </Button>
        </div>
        <p className={cn(CAPTION)}>
          Your phone rings first; once you pick up, we connect you to the contact and record the
          call. Chippi summarizes it when it ends.
        </p>
      </section>

      {/* ── List ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <p className={cn(SECTION_LABEL)}>Recent calls</p>

        {loading ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className={cn(BODY, 'text-muted-foreground')}>Loading&hellip;</p>
          </div>
        ) : calls.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
            <p className={cn(BODY)}>No calls yet.</p>
            <p className={cn(CAPTION, 'mt-1')}>
              Call a contact and the recording, transcript, and summary show up here.
            </p>
          </div>
        ) : (
          <StaggerList key={calls.length} className="divide-y divide-border/60">
            {calls.map((c) => {
              const isOpen = expanded === c.id;
              const duration = formatDuration(c.durationSec);
              const hasDetail = Boolean(c.summary || c.transcript);
              return (
                <StaggerItem key={c.id}>
                  <div className="py-3">
                    <button
                      type="button"
                      onClick={() => hasDetail && setExpanded(isOpen ? null : c.id)}
                      className={cn(
                        'w-full flex items-start gap-3 text-left rounded-lg -mx-2 px-2 py-1',
                        hasDetail && 'hover:bg-foreground/[0.04] transition-colors',
                      )}
                      aria-expanded={isOpen}
                    >
                      <div className="mt-0.5 w-7 h-7 shrink-0 rounded-lg bg-foreground/[0.04] flex items-center justify-center">
                        {c.status === 'failed' || c.status === 'no_answer' ? (
                          <PhoneOff size={13} strokeWidth={1.75} className="text-muted-foreground" />
                        ) : (
                          <Phone size={13} strokeWidth={1.75} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn(BODY, 'font-medium truncate')}>
                          {c.contactName ?? c.toNumber}
                        </p>
                        <p className={cn(META, 'mt-1')}>
                          {formatDate(c.createdAt)}
                          {duration ? ` · ${duration}` : ''}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex shrink-0 text-xs font-medium rounded-full px-2.5 py-0.5',
                          STATUS_STYLES[c.status],
                        )}
                      >
                        {STATUS_LABELS[c.status]}
                      </span>
                      {hasDetail && (
                        <ChevronDown
                          size={14}
                          strokeWidth={1.75}
                          className={cn(
                            'mt-1.5 shrink-0 text-muted-foreground transition-transform',
                            isOpen && 'rotate-180',
                          )}
                        />
                      )}
                    </button>

                    {isOpen && hasDetail && (
                      <div className="mt-3 ml-10 space-y-4">
                        {c.summary && (
                          <div className="space-y-1.5">
                            <p className={cn(SECTION_LABEL)}>Chippi summary</p>
                            <p className={cn(BODY)}>{c.summary}</p>
                          </div>
                        )}
                        {c.transcript && (
                          <div className="space-y-1.5">
                            <p className={cn(SECTION_LABEL)}>Transcript</p>
                            <p className={cn(CAPTION, 'whitespace-pre-wrap leading-relaxed')}>
                              {c.transcript}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerList>
        )}
      </section>
    </main>
  );
}
