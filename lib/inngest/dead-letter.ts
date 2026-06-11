/**
 * Dead-letter producer.
 *
 * The DeadLetterEvent table + admin DLQ UI existed, but nothing wrote to it —
 * so an Inngest job that exhausted all its retries just vanished. This is the
 * missing producer: an Inngest function's `onFailure` handler calls this once,
 * after the final retry, to persist the failure for an admin to inspect/replay.
 *
 * Fail-safe by construction: it never throws (a DLQ write failing must not
 * cascade) and always supplies a non-null spaceId (the column is NOT NULL),
 * defaulting to 'unknown' when the owning space can't be resolved — recording a
 * partially-attributed failure beats losing it.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface DeadLetterInput {
  /** Owning space, or 'unknown' when it can't be resolved. */
  spaceId: string;
  /** The Inngest event name that failed, e.g. 'studio/post.scheduled'. */
  eventType: string;
  /** A small, useful slice of the event for triage (NOT the whole payload). */
  eventPayload?: Record<string, unknown>;
  /** The final error after all retries were exhausted. */
  error: unknown;
  taskId?: string | null;
}

export async function recordDeadLetter(input: DeadLetterInput): Promise<void> {
  const err = input.error;
  const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
  const stack = err instanceof Error ? err.stack ?? null : null;

  try {
    const { error } = await supabase.from('DeadLetterEvent').insert({
      spaceId: input.spaceId || 'unknown',
      eventType: input.eventType,
      eventPayload: input.eventPayload ?? {},
      errorMessage: message.slice(0, 2000),
      errorStack: stack ? stack.slice(0, 8000) : null,
      taskId: input.taskId ?? null,
      status: 'pending',
    });
    if (error) {
      logger.error('[dead-letter] failed to record DLQ event', { eventType: input.eventType }, error);
    } else {
      logger.warn('[dead-letter] job dead-lettered after exhausting retries', {
        eventType: input.eventType,
        spaceId: input.spaceId,
      });
    }
  } catch (e) {
    // Never let a DLQ write failure escape — the job already failed; we don't
    // want to compound it.
    logger.error('[dead-letter] DLQ insert threw', { eventType: input.eventType }, e);
  }
}

/**
 * Pull the original event's `data` out of an Inngest `onFailure` argument.
 * Inngest hands the failure handler the original triggering event, but across
 * SDK shapes it can arrive either directly (`event.data`) or wrapped in an
 * `inngest/function.failed` envelope (`event.data.event.data`). Read both so
 * the producer attributes the failure correctly regardless.
 */
export function originalEventData(arg: unknown): Record<string, unknown> {
  const a = arg as { event?: { data?: Record<string, unknown> } } | undefined;
  const data = a?.event?.data;
  const wrapped = (data as { event?: { data?: Record<string, unknown> } } | undefined)?.event?.data;
  return (wrapped ?? data ?? {}) as Record<string, unknown>;
}
