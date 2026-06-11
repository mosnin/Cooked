/**
 * Sentry — browser init. Runs once on the client. DSN-gated so a build
 * without NEXT_PUBLIC_SENTRY_DSN ships an inert SDK (no network, no noise).
 *
 * Replay is intentionally omitted for now to keep the client bundle lean;
 * errors + tracing + logs are the priority. Enable replay later if needed.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: Number(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ??
        (process.env.NODE_ENV === 'production' ? '0.1' : '1.0'),
    ),
    enableLogs: true,
    sendDefaultPii: false,
    debug: false,
  });
}

// Instrument client-side navigations (App Router) for tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
