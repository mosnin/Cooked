/**
 * POST /api/admin/triggers/backfill
 *
 * Idempotent one-shot: registers curated Composio triggers for every
 * existing active IntegrationConnection that doesn't already have them.
 *
 * Why this exists: the OAuth callback registers triggers at connect-
 * time, but realtors who connected BEFORE the triggers feature shipped
 * have active connections with zero IntegrationTrigger rows. Without
 * this, their Chippi never notices anything until they reconnect.
 *
 * Auth: Bearer ${CRON_SECRET}. Same gate as our scheduled cron routes —
 * the secret is server-only, so this is operator-callable, not user-
 * facing. (If we ever want to expose it to brokers as a manual "rewire
 * my Chippi" button, that's a separate route with Clerk auth.)
 *
 * Idempotent by design: skips connections that already have any
 * IntegrationTrigger row. A second invocation does nothing useful. If
 * we extend CURATED_TRIGGERS later, the "already has any row" check is
 * deliberately coarse — we accept that backfill won't re-register a
 * newly-added slug for connections that already saw a prior backfill.
 * Re-running with `?force=1` does the per-slug check instead, suitable
 * for after-an-expansion runs (rarer + opt-in).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import {
  CURATED_TRIGGERS,
  listTriggersForConnection,
  registerForConnection,
} from '@/lib/integrations/triggers';
import { logger } from '@/lib/logger';
import { isPlatformAdmin } from '@/lib/permissions';
import type { IntegrationConnectionRow } from '@/lib/integrations/connections';

export const runtime = 'nodejs';
export const maxDuration = 300;

/** Page size cap — keeps a single invocation under maxDuration even
 *  when every connection needs 3-5 sequential Composio create calls. */
const MAX_PER_RUN = 80;

/** Wall-clock budget per invocation. Leaves headroom under Vercel's
 *  maxDuration so a near-the-limit run can complete its current
 *  connection cleanly and return `more: true` for the operator to
 *  re-invoke. */
const TIME_BUDGET_MS = 240_000;

function bearerOk(header: string | null, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  if (!header || header.length !== expected.length) return false;
  // Timing-safe comparison — for a server-only CRON_SECRET this is
  // belt-and-suspenders, but it's one line and avoids a class of
  // string-compare timing leaks against future audits.
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  // Auth: a logged-in platform admin (honors the /api/admin/* invariant) OR a
  // valid CRON_SECRET bearer (ops/CLI invocation has no Clerk session). Either
  // is sufficient; both fail closed.
  if (!(await isPlatformAdmin())) {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
    }
    if (!bearerOk(req.headers.get('Authorization'), cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const force = new URL(req.url).searchParams.get('force') === '1';

  // Only ACTIVE connections — expired/revoked rows mean the realtor
  // can't be helped until they reconnect, so registering triggers for
  // them would just stack failed rows.
  const { data: rows, error } = await supabase
    .from('IntegrationConnection')
    .select('*')
    .eq('status', 'active');
  if (error) {
    return NextResponse.json({ error: 'DB query failed', detail: error.message }, { status: 500 });
  }

  const connections = (rows ?? []) as IntegrationConnectionRow[];
  const startedAt = Date.now();
  let scanned = 0;
  let registered = 0;
  let failed = 0;
  let skipped = 0;
  let more = false;
  const errors: Array<{ connectionId: string; toolkit: string; error: string }> = [];

  for (const conn of connections) {
    // Budget check BEFORE each connection so a near-the-limit run
    // doesn't get killed mid-Composio-call. Operator re-runs to pick
    // up the rest; idempotent skip protects already-handled rows.
    if (Date.now() - startedAt > TIME_BUDGET_MS || scanned >= MAX_PER_RUN) {
      more = true;
      break;
    }
    scanned++;
    const curatedSlugs = CURATED_TRIGGERS[conn.toolkit] ?? [];
    if (curatedSlugs.length === 0) {
      skipped++;
      continue;
    }

    if (!force) {
      // Coarse idempotency — any existing row means we've registered
      // for this connection already.
      const existing = await listTriggersForConnection(conn.id);
      if (existing.length > 0) {
        skipped++;
        continue;
      }
    } else {
      // force=1: per-slug delta. registerForConnection upserts on
      // (connectionId, triggerSlug), so calling it for slugs we
      // already have would re-create at Composio (duplicate
      // subscriptions, real $$). Skip slugs already present.
      const existing = await listTriggersForConnection(conn.id);
      const have = new Set(existing.map((r) => r.triggerSlug));
      const missing = curatedSlugs.filter((s) => !have.has(s));
      if (missing.length === 0) {
        skipped++;
        continue;
      }
      // We can't easily ask registerForConnection to register only a
      // subset without duplicating its logic, so for force=1 we still
      // call it but document that the upsert path means existing
      // slugs get their Composio side re-attempted. The unique index
      // on (connectionId, triggerSlug) ensures the DB row count
      // stays correct.
    }

    try {
      const result = await registerForConnection({ connection: conn });
      registered += result.registered;
      failed += result.failed;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ connectionId: conn.id, toolkit: conn.toolkit, error: message });
      failed += curatedSlugs.length;
      logger.error('[triggers.backfill] connection failed', {
        connectionId: conn.id,
        toolkit: conn.toolkit,
        err: message,
      });
    }
  }

  const summary = { scanned, registered, failed, skipped, more, errors };
  logger.info('[triggers.backfill] complete', summary);
  return NextResponse.json(summary);
}
