/**
 * lib/sentry-api.ts — server-only Sentry REST API client.
 *
 * Reads from https://sentry.io/api/0/ using SENTRY_AUTH_TOKEN (Bearer),
 * SENTRY_ORG, and SENTRY_PROJECT. Never exposes credentials or raw API
 * data to the client. All fetch errors are swallowed — callers receive
 * empty/null and render an honest "not configured / couldn't load" state.
 *
 * No new dependencies — uses native fetch with AbortController (10s timeout).
 */

// Prevent client bundles from including this module.
import 'server-only';

// ── Types ───────────────────────────────────────────────────────────────────

export interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  status: string;
}

export interface SentryEventStats {
  points: { ts: number; count: number }[];
}

// ── Config ──────────────────────────────────────────────────────────────────

const SENTRY_BASE = 'https://sentry.io/api/0';

function org(): string {
  return process.env.SENTRY_ORG ?? '';
}

function project(): string {
  return process.env.SENTRY_PROJECT ?? '';
}

function token(): string {
  return process.env.SENTRY_AUTH_TOKEN ?? '';
}

/** True only when all three required env vars are present. */
export function sentryConfigured(): boolean {
  return Boolean(
    process.env.SENTRY_AUTH_TOKEN &&
    process.env.SENTRY_ORG &&
    process.env.SENTRY_PROJECT,
  );
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function sentryFetch(path: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${SENTRY_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      // Don't cache — we want fresh data on each server render / refresh.
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[sentry-api] HTTP ${res.status} for ${path}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    // AbortError (timeout) or network failure — swallow, return null.
    console.error('[sentry-api] fetch failed:', err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── listIssues ───────────────────────────────────────────────────────────────

export interface ListIssuesOptions {
  /** Sentry query string (default: `is:unresolved`). */
  query?: string;
  /** Sentry stats period string (default: `14d`). */
  statsPeriod?: string;
}

/**
 * Returns up to 25 recent unresolved issues for the configured project.
 * Returns an empty array on any failure.
 */
export async function listIssues(opts: ListIssuesOptions = {}): Promise<SentryIssue[]> {
  if (!sentryConfigured()) return [];

  const q = encodeURIComponent(opts.query ?? 'is:unresolved');
  const period = encodeURIComponent(opts.statsPeriod ?? '14d');
  const path = `/projects/${org()}/${project()}/issues/?query=${q}&statsPeriod=${period}&limit=25`;

  const raw = await sentryFetch(path);
  if (!raw || !Array.isArray(raw)) return [];

  return (raw as Record<string, unknown>[]).map((item) => ({
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    culprit: String(item.culprit ?? ''),
    level: (item.level as SentryIssue['level']) ?? 'error',
    count: Number(item.count ?? item.times_seen ?? 0),
    userCount: Number(item.userCount ?? 0),
    firstSeen: String(item.firstSeen ?? ''),
    lastSeen: String(item.lastSeen ?? ''),
    permalink: String(item.permalink ?? ''),
    status: String(item.status ?? 'unresolved'),
  }));
}

// ── getEventStats ─────────────────────────────────────────────────────────────

export interface GetEventStatsOptions {
  /** Sentry stats period string (default: `14d`). */
  statsPeriod?: string;
}

/**
 * Returns daily received-event counts for the configured project.
 * Returns null on any failure.
 */
export async function getEventStats(
  opts: GetEventStatsOptions = {},
): Promise<SentryEventStats | null> {
  if (!sentryConfigured()) return null;

  const period = encodeURIComponent(opts.statsPeriod ?? '14d');
  const path = `/projects/${org()}/${project()}/stats/?stat=received&resolution=1d&statsPeriod=${period}`;

  const raw = await sentryFetch(path);
  if (!raw || !Array.isArray(raw)) return null;

  // Sentry stats format: [[timestamp_seconds, count], ...]
  const points = (raw as [number, number][]).map(([ts, count]) => ({
    ts: ts * 1000, // convert to ms
    count,
  }));

  return { points };
}
