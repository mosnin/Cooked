/**
 * Sentry — server runtime init. Loaded by instrumentation.ts on the Node
 * runtime. DSN-gated: with no DSN the SDK stays dormant, so local dev and
 * CI never phone home or warn. Vercel injects the env (the Sentry↔Vercel
 * integration); locally, set NEXT_PUBLIC_SENTRY_DSN to exercise it.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    // Performance tracing. Full sampling in dev, light in prod (tune via env).
    tracesSampleRate: Number(
      process.env.SENTRY_TRACES_SAMPLE_RATE ??
        (process.env.NODE_ENV === 'production' ? '0.1' : '1.0'),
    ),
    // Structured logs (logger.* → Sentry) so the admin Observability view and
    // Sentry both have the full event stream, not just exceptions.
    enableLogs: true,
    // PII is already redacted in lib/logger.ts; never let the SDK add more.
    sendDefaultPii: false,
    debug: false,
  });
}
