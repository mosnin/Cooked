/**
 * Next.js instrumentation hook. Boots Sentry for whichever server runtime is
 * active, and forwards nested React Server Component request errors to Sentry
 * via onRequestError (Next 15).
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Validate required server env at boot. Importing the module runs the
    // zod check at module-eval time and throws (fail fast) on missing vars.
    // Node runtime only — the edge runtime doesn't carry the full server env.
    await import('./lib/env');
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
