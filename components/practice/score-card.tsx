'use client';

/**
 * ScoreCard — the post-call coaching payoff.
 *
 * After a mock call ends, Axil's grade lands here: a headline overall score,
 * five rubric bars, 2-3 coaching tips, the best and worst moments quoted from
 * the call, and a quiet transcript replay beneath. When grading failed, the
 * card degrades to an honest "couldn't grade" state with a re-grade affordance
 * and still shows the transcript so nothing is lost.
 *
 * Paper-flat, hairline-divided, calm copy — the same lens as the call log.
 */

import { Award, ThumbsUp, ThumbsDown, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  H2,
  TITLE_FONT,
  BODY,
  BODY_MUTED,
  SECTION_LABEL,
  CAPTION,
  STAT_NUMBER,
} from '@/lib/typography';
import {
  RUBRIC_DIMENSIONS,
  RUBRIC_LABELS,
  type MockCall,
} from './types';

// Score → tone. Three bands keep the read instant without a rainbow.
function scoreTone(score: number): string {
  if (score >= 75) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function barTone(score: number): string {
  if (score >= 75) return 'bg-emerald-500/80';
  if (score >= 50) return 'bg-amber-500/80';
  return 'bg-rose-500/80';
}

function RubricBar({ label, score }: { label: string; score: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn(BODY, 'font-medium')}>{label}</span>
        <span className={cn('text-sm font-semibold tabular-nums', scoreTone(score))}>{score}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-foreground/[0.06] overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barTone(score))}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
    </div>
  );
}

export function ScoreCard({
  call,
  scoreError,
  onRegrade,
  regrading,
}: {
  call: MockCall;
  scoreError?: string | null;
  onRegrade?: () => void;
  regrading?: boolean;
}) {
  const feedback = call.feedback;

  return (
    <div className="space-y-10">
      {/* ── Headline ─────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border/70 bg-card px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className={cn(SECTION_LABEL)}>Call graded</p>
            <h2 className={cn(H2)} style={TITLE_FONT}>
              {feedback ? 'How that call went' : 'Your call is saved'}
            </h2>
          </div>
          {feedback && (
            <div className="text-right">
              <p className={cn(STAT_NUMBER, scoreTone(feedback.overall))}>{feedback.overall}</p>
              <p className={cn(CAPTION)}>overall</p>
            </div>
          )}
        </div>

        {!feedback && (
          <div className="mt-4 space-y-3">
            <p className={cn(BODY_MUTED)}>
              {scoreError ??
                'This call wasn’t graded. The transcript is saved below — you can grade it again.'}
            </p>
            {onRegrade && (
              <Button variant="outline" size="sm" onClick={onRegrade} disabled={regrading}>
                <Award size={14} strokeWidth={2} className="mr-1.5" />
                {regrading ? 'Grading…' : 'Grade this call'}
              </Button>
            )}
          </div>
        )}
      </section>

      {feedback && (
        <>
          {/* ── Rubric ─────────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <p className={cn(SECTION_LABEL)}>The rubric</p>
            <div className="space-y-4">
              {RUBRIC_DIMENSIONS.map((dim) => (
                <RubricBar key={dim} label={RUBRIC_LABELS[dim]} score={feedback.rubric[dim]} />
              ))}
            </div>
          </section>

          {/* ── Coaching tips ──────────────────────────────────────────────── */}
          {feedback.tips.length > 0 && (
            <section className="space-y-3">
              <p className={cn(SECTION_LABEL)}>What to work on</p>
              <ul className="space-y-2.5">
                {feedback.tips.map((tip, i) => (
                  <li key={i} className="flex gap-2.5">
                    <Lightbulb
                      size={15}
                      strokeWidth={1.75}
                      className="mt-0.5 shrink-0 text-amber-500"
                    />
                    <span className={cn(BODY)}>{tip}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Best / worst moments ──────────────────────────────────────── */}
          {(feedback.best_moment || feedback.worst_moment) && (
            <section className="grid gap-3 sm:grid-cols-2">
              {feedback.best_moment && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-4 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <ThumbsUp size={13} strokeWidth={2} className="text-emerald-600 dark:text-emerald-400" />
                    <p className={cn(SECTION_LABEL, 'text-emerald-700 dark:text-emerald-400')}>
                      Best moment
                    </p>
                  </div>
                  <p className={cn(BODY)}>{feedback.best_moment}</p>
                </div>
              )}
              {feedback.worst_moment && (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] px-4 py-4 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <ThumbsDown size={13} strokeWidth={2} className="text-rose-600 dark:text-rose-400" />
                    <p className={cn(SECTION_LABEL, 'text-rose-700 dark:text-rose-400')}>
                      Missed opportunity
                    </p>
                  </div>
                  <p className={cn(BODY)}>{feedback.worst_moment}</p>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* ── Transcript replay ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <p className={cn(SECTION_LABEL)}>Call replay</p>
        {call.transcript.length === 0 ? (
          <p className={cn(CAPTION)}>No turns were exchanged.</p>
        ) : (
          <div className="space-y-3">
            {call.transcript.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  'flex',
                  turn.role === 'rep' ? 'justify-end' : 'justify-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[80%] rounded-2xl px-3.5 py-2',
                    turn.role === 'rep'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-foreground/[0.05] text-foreground rounded-bl-sm',
                  )}
                >
                  <p className={cn(CAPTION, 'mb-0.5 opacity-70')}>
                    {turn.role === 'rep' ? 'You' : 'Prospect'}
                  </p>
                  <p className={cn(BODY, 'whitespace-pre-wrap leading-relaxed')}>{turn.content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
