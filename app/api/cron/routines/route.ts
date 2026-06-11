/**
 * GET /api/cron/routines
 *
 * Hourly tick. Finds every enabled Routine whose nextRunAt has passed and
 * fires the Modal autonomous run with the routine's instruction attached.
 *
 * IMPORTANT: This endpoint never sends email or SMS. It triggers the same
 * Modal agent path the manual "Run now" and the 4-hour sweep use — the run
 * produces AgentDraft rows with status 'pending'. Only the realtor approving
 * a draft fires an outbound channel.
 *
 * Auth: Bearer ${CRON_SECRET}. Disable: set CRON_ROUTINES_DISABLED=1.
 *
 * Advancing the schedule is not this route's job — stamping lastRunAt fires
 * the Routine table trigger, which recomputes nextRunAt to the next slot.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fireRoutineRun } from '@/lib/routines';
import { monitorCron } from '@/lib/cron-monitor';

export const runtime = 'nodejs';

// Don't let one tick fire an unbounded number of webhooks — the overflow
// is picked up on the next hourly tick.
const MAX_PER_TICK = 250;
// Parallel Modal dispatches in flight at once.
const MAX_CONCURRENCY = 8;

interface DueRoutine {
  id: string;
  spaceId: string;
  instruction: string;
}

async function handler(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/routines] CRON_SECRET is not set — rejecting request');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (process.env.CRON_ROUTINES_DISABLED) {
    console.log('[cron/routines] CRON_ROUTINES_DISABLED is set — skipping tick');
    return NextResponse.json({ status: 'disabled' });
  }

  const startedAt = Date.now();
  const nowIso = new Date().toISOString();

  // ── 1. Due routines ─────────────────────────────────────────────────────
  const { data: dueRows, error: dueErr } = await supabase
    .from('Routine')
    .select('id, spaceId, instruction')
    .eq('enabled', true)
    .lte('nextRunAt', nowIso)
    .order('nextRunAt', { ascending: true })
    .limit(MAX_PER_TICK);
  if (dueErr) {
    console.error('[cron/routines] Failed to load due routines', dueErr);
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
  }

  const due = (dueRows ?? []) as DueRoutine[];
  if (due.length === 0) {
    return NextResponse.json({ due: 0, fired: 0, skipped: 0, durationMs: Date.now() - startedAt });
  }

  // ── 2. Keep only routines in spaces with a live subscription ────────────
  //
  // While we're loading spaces, pull ownerId too — we'll resolve each owner's
  // Clerk userId and pass it to Modal so the autonomous run loads Composio
  // tools for the right entity. (The Modal side can resolve this itself but
  // a silent null breaks integrations; passing it explicitly removes that.)
  const spaceIds = [...new Set(due.map((r) => r.spaceId))];
  const { data: spaceRows, error: spaceErr } = await supabase
    .from('Space')
    .select('id, ownerId, stripeSubscriptionStatus')
    .in('id', spaceIds);
  if (spaceErr) {
    console.error('[cron/routines] Failed to load spaces', spaceErr);
    return NextResponse.json({ error: 'DB query failed' }, { status: 500 });
  }
  const activeSpaceRows = (spaceRows ?? []).filter((s) =>
    ['active', 'trialing'].includes(s.stripeSubscriptionStatus as string),
  );
  const activeSpaces = new Set(activeSpaceRows.map((s) => s.id as string));
  const ownerIdsBySpace = new Map<string, string>();
  for (const s of activeSpaceRows) {
    if (s.ownerId) ownerIdsBySpace.set(s.id as string, s.ownerId as string);
  }

  // Single batch lookup: owner DB ids → Clerk userIds.
  const clerkIdByOwner = new Map<string, string>();
  const ownerIds = [...new Set(ownerIdsBySpace.values())];
  if (ownerIds.length > 0) {
    const { data: userRows, error: userErr } = await supabase
      .from('User')
      .select('id, clerkId')
      .in('id', ownerIds);
    if (userErr) {
      console.warn('[cron/routines] Failed to load owners — running without userId', userErr);
    } else {
      for (const u of userRows ?? []) {
        if (u.clerkId) clerkIdByOwner.set(u.id as string, u.clerkId as string);
      }
    }
  }

  const runnable = due.filter((r) => activeSpaces.has(r.spaceId));
  const skippedInactive = due.length - runnable.length;

  // ── 3. Fire with bounded concurrency ────────────────────────────────────
  let fired = 0;
  let errored = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < runnable.length) {
      const routine = runnable[cursor++];
      const ownerId = ownerIdsBySpace.get(routine.spaceId);
      const ownerClerkId = ownerId ? clerkIdByOwner.get(ownerId) : undefined;
      let status: 'ok' | 'error';
      try {
        status = await fireRoutineRun(routine.spaceId, routine.instruction, ownerClerkId);
      } catch (err) {
        console.error('[cron/routines] dispatch threw', { id: routine.id }, err);
        status = 'error';
      }
      if (status === 'ok') fired++;
      else errored++;

      // Stamping lastRunAt fires the trigger that advances nextRunAt — even
      // on 'error', so a permanently failing dispatch can't jam the queue.
      await supabase
        .from('Routine')
        .update({ lastRunAt: new Date().toISOString(), lastRunStatus: status })
        .eq('id', routine.id);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, runnable.length) }, () => worker()),
  );

  const summary = {
    due: due.length,
    fired,
    errored,
    skipped: skippedInactive,
    durationMs: Date.now() - startedAt,
  };
  console.log('[cron/routines] Tick complete', summary);
  return NextResponse.json(summary);
}

export const GET = monitorCron('routines', { crontab: '0 * * * *' }, handler);
