/**
 * Cron dead-man monitoring.
 *
 * The 10 Vercel crons run unattended. The failure mode that actually hurts is
 * SILENT: a sweep stops firing, or starts returning 500s, and nobody notices
 * until the data is stale and a customer complains. This wrapper closes that
 * gap with the cheapest mechanism that works — Sentry Cron Monitoring
 * (check-ins).
 *
 * For each wrapped handler we:
 *   1. Open an "in_progress" check-in against a per-cron monitor slug, passing
 *      the cron's crontab schedule. Sentry now knows when the job SHOULD run,
 *      so a MISSED run (the job never starts) alerts on its own — no code on
 *      our side can detect "I didn't run", only Sentry's server-side scheduler
 *      can, and this is how we hand it the schedule.
 *   2. Run the real handler.
 *   3. Close the check-in "ok" or "error". We treat BOTH a thrown error AND a
 *      returned 5xx as a failure — most of these handlers catch their own
 *      errors and return `NextResponse.json(..., { status: 500 })` WITHOUT
 *      throwing, so a status-blind wrapper would mark a broken run "ok". That
 *      silent-500 case is the exact thing we're guarding against.
 *   4. On a thrown error, also `captureException` tagged with the cron name so
 *      it lands as a normal Sentry issue (with stack) in addition to the
 *      check-in, then re-throw so the route still surfaces the 500.
 *
 * DSN-gated: with no Sentry DSN the SDK is dormant and every call here is a
 * cheap no-op, so local dev and CI never phone home. Business logic is never
 * touched — the wrapper only observes.
 */
import * as Sentry from '@sentry/nextjs';

/** A Next.js route handler. Kept loose so it fits every cron's GET signature
 *  (some take `req`, some take none) without per-route generics. */
type CronHandler = (...args: never[]) => Promise<Response>;

/** Schedule for one cron — the same crontab string that's in vercel.json.
 *  Vercel crons evaluate in UTC, so the monitor is pinned to UTC too. */
export interface CronSchedule {
  /** Crontab expression, e.g. '*\/15 * * * *'. Must match vercel.json. */
  crontab: string;
  /** Grace window (minutes) before a late/missed run is flagged. Defaults to
   *  5; override for jobs with bursty runtime. */
  checkinMarginMinutes?: number;
  /** Max expected runtime (minutes) before a still-open check-in is treated
   *  as a timeout. Defaults to 10; the long sweeps cap at maxDuration 300s
   *  (≈5 min), so 10 is comfortable headroom. */
  maxRuntimeMinutes?: number;
}

/**
 * Wrap a cron route handler with a Sentry dead-man check-in.
 *
 * @param slug    Stable monitor slug — this is the identity Sentry tracks the
 *                schedule against, so it must stay constant across deploys.
 *                Convention: the cron's path segment, e.g. 'lead-sla'.
 * @param schedule The cron's crontab + margins (see CronSchedule).
 * @param handler The real route handler. Its logic is never modified.
 */
export function monitorCron<H extends CronHandler>(
  slug: string,
  schedule: CronSchedule,
  handler: H,
): H {
  const monitorConfig = {
    schedule: { type: 'crontab' as const, value: schedule.crontab },
    checkinMargin: schedule.checkinMarginMinutes ?? 5,
    maxRuntime: schedule.maxRuntimeMinutes ?? 10,
    timezone: 'Etc/UTC',
  };

  const wrapped = async (...args: Parameters<H>): Promise<Response> => {
    const checkInId = Sentry.captureCheckIn(
      { monitorSlug: slug, status: 'in_progress' },
      monitorConfig,
    );

    try {
      const res = await handler(...(args as never[]));
      // A returned 5xx is a failure even though nothing threw — these handlers
      // mostly catch their own errors and return 500. Don't lie to the monitor.
      const failed = res.status >= 500;
      Sentry.captureCheckIn({
        checkInId,
        monitorSlug: slug,
        status: failed ? 'error' : 'ok',
      });
      return res;
    } catch (err) {
      Sentry.captureCheckIn({ checkInId, monitorSlug: slug, status: 'error' });
      Sentry.captureException(err, { tags: { cron: slug } });
      throw err;
    }
  };

  return wrapped as H;
}
