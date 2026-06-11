/**
 * Observability helpers — the one wrapper the app uses to talk to Sentry.
 *
 * Everything here is a safe no-op when Sentry has no DSN (the SDK functions
 * short-circuit with no active client), so callers never need to guard. PII
 * is the caller's responsibility — prefer passing already-redacted context
 * (lib/logger.ts redacts before it forwards here).
 */
import * as Sentry from '@sentry/nextjs';

export type Severity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/** Capture an exception with structured extra context and tags. */
export function captureError(
  err: unknown,
  context?: Record<string, unknown>,
  tags?: Record<string, string>,
): void {
  try {
    Sentry.captureException(err, (scope) => {
      if (context) scope.setExtras(context);
      if (tags) scope.setTags(tags);
      return scope;
    });
  } catch {
    // Never let telemetry throw into a request path.
  }
}

/** Capture a message (no Error object) at a given severity. */
export function captureMessage(
  message: string,
  level: Severity = 'info',
  context?: Record<string, unknown>,
): void {
  try {
    Sentry.captureMessage(message, (scope) => {
      scope.setLevel(level);
      if (context) scope.setExtras(context);
      return scope;
    });
  } catch {
    /* swallow */
  }
}

/** Leave a breadcrumb — the trail that shows up on the next captured event. */
export function breadcrumb(
  message: string,
  level: Severity = 'info',
  category = 'app',
  data?: Record<string, unknown>,
): void {
  try {
    Sentry.addBreadcrumb({ message, level, category, data });
  } catch {
    /* swallow */
  }
}

/** Attach the current user to the Sentry scope (id only — no PII). */
export function setUserContext(user: { id: string } | null): void {
  try {
    Sentry.setUser(user);
  } catch {
    /* swallow */
  }
}

/** Run an async unit of work inside a named Sentry span for tracing. */
export function withSpan<T>(name: string, op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return Sentry.startSpan({ name, op }, fn);
  } catch {
    return fn();
  }
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Bridge from lib/logger.ts → Sentry. Every log line becomes a Sentry Log
 * (the lightweight, searchable event stream powering the admin Observability
 * view), and errors additionally surface as Issues so they page someone.
 * Context arrives already PII-redacted from the logger.
 */
export function reportLog(
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
  err?: unknown,
): void {
  // 1. The full log stream (Sentry Logs).
  try {
    const sentryLogger = (
      Sentry as unknown as {
        logger?: Record<string, (m: string, a?: Record<string, unknown>) => void>;
      }
    ).logger;
    sentryLogger?.[level]?.(message, context ?? {});
  } catch {
    /* swallow */
  }

  // 2. Errors (and warns carrying an Error) also become Issues + breadcrumbs.
  if (level === 'error') {
    if (err !== undefined) captureError(err, { message, ...(context ?? {}) }, { source: 'logger' });
    else captureMessage(message, 'error', context);
  } else if (level === 'warn') {
    breadcrumb(message, 'warning', 'log', context);
    if (err !== undefined) captureError(err, { message, ...(context ?? {}) }, { source: 'logger' });
  } else {
    breadcrumb(message, level === 'debug' ? 'debug' : 'info', 'log', context);
  }
}
