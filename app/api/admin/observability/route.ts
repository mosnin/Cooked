/**
 * GET /api/admin/observability
 *
 * Admin-guarded endpoint that returns fresh Sentry issues + event stats
 * as JSON. Used by ObservabilityClient's refresh button.
 *
 * Security: requireAdmin() throws a redirect on non-admin callers.
 * No Sentry credentials reach the response — only the processed output.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { listIssues, getEventStats, sentryConfigured } from '@/lib/sentry-api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configured = sentryConfigured();
  const [issues, stats] = configured
    ? await Promise.all([listIssues(), getEventStats()])
    : [[], null];

  return NextResponse.json({
    issues,
    stats,
    fetchedAt: new Date().toISOString(),
  });
}
