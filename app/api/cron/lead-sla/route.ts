import { NextRequest, NextResponse } from 'next/server';
import { sweepAllBrokerages } from '@/lib/broker-sla';
import { logger } from '@/lib/logger';
import { monitorCron } from '@/lib/cron-monitor';

/**
 * GET /api/cron/lead-sla — the speed-to-lead enforcement sweep.
 *
 * Runs every 15 minutes (see vercel.json). For each brokerage with SLA
 * enforcement on, it finds routed leads sitting un-worked past the first-
 * response window and acts: nudges the assigned realtor, then escalates to the
 * broker if the lead stays cold. Idempotent via per-contact tags, so a lead is
 * never double-pinged.
 *
 * Auth: Vercel cron sends `Authorization: Bearer ${CRON_SECRET}`.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

async function handler(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/lead-sla] CRON_SECRET is not set — rejecting request');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await sweepAllBrokerages();
    const totals = results.reduce(
      (acc, r) => ({
        breached: acc.breached + r.breached,
        nudged: acc.nudged + r.nudged,
        escalated: acc.escalated + r.escalated,
      }),
      { breached: 0, nudged: 0, escalated: 0 },
    );
    logger.info('[cron/lead-sla] sweep complete', { brokerages: results.length, ...totals });
    return NextResponse.json({ ok: true, brokerages: results.length, ...totals });
  } catch (err) {
    logger.error('[cron/lead-sla] sweep failed', {}, err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}

export const GET = monitorCron('lead-sla', { crontab: '*/15 * * * *' }, handler);
