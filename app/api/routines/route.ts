/**
 * GET  /api/routines — the space's routines, oldest first.
 * POST /api/routines — create a routine (instruction + cadence + hour
 *                     [+ dayOfMonth for 'monthly' / daysOfWeek for 'custom']).
 *
 * nextRunAt is never sent by the client — the Routine table's trigger
 * computes it from cadence + hour + (dayOfMonth | daysOfWeek). The client
 * owns the sentence and the time; the database owns the schedule.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  ROUTINE_CADENCES,
  ROUTINE_WEEKDAYS,
  ROUTINE_MAX_DAY_OF_MONTH,
  type RoutineWeekday,
} from '@/lib/routines';

export const runtime = 'nodejs';

const SELECT =
  'id, instruction, cadence, hour, dayOfMonth, daysOfWeek, enabled, lastRunAt, lastRunStatus, nextRunAt, createdAt';

const MAX_ROUTINES = 20;
const MAX_INSTRUCTION = 600;
const MIN_INSTRUCTION = 10;

function isCadence(v: unknown): v is (typeof ROUTINE_CADENCES)[number] {
  return typeof v === 'string' && (ROUTINE_CADENCES as readonly string[]).includes(v);
}

function isWeekday(v: unknown): v is RoutineWeekday {
  return typeof v === 'string' && (ROUTINE_WEEKDAYS as readonly string[]).includes(v);
}

/** Dedup + normalise the day-of-week array for 'custom' cadence. */
function sanitiseDaysOfWeek(v: unknown): RoutineWeekday[] | null {
  if (!Array.isArray(v)) return null;
  const set = new Set<RoutineWeekday>();
  for (const d of v) if (isWeekday(d)) set.add(d);
  if (set.size === 0) return null;
  // Preserve canonical order (mon→sun) so storage is stable across requests.
  return ROUTINE_WEEKDAYS.filter((d) => set.has(d));
}

function sanitiseDayOfMonth(v: unknown): number | null {
  if (typeof v !== 'number') return null;
  const n = Math.floor(v);
  if (n < 1 || n > ROUTINE_MAX_DAY_OF_MONTH) return null;
  return n;
}

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const space = await getSpaceForUser(authResult.userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data, error } = await supabase
    .from('Routine')
    .select(SELECT)
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: true });

  if (error) {
    logger.error('[routines] list failed', { spaceId: space.id }, error);
    return NextResponse.json({ error: 'Load failed' }, { status: 500 });
  }

  return NextResponse.json({ routines: data ?? [] });
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const space = await getSpaceForUser(authResult.userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const instruction =
    typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (instruction.length < MIN_INSTRUCTION) {
    return NextResponse.json(
      { error: 'Write a full sentence — what should Chippi do?' },
      { status: 400 },
    );
  }

  const cadence = isCadence(body.cadence) ? body.cadence : 'daily';
  let hour = typeof body.hour === 'number' ? Math.floor(body.hour) : 13;
  if (hour < 0 || hour > 23) hour = 13;

  // Only attach the cadence-specific field that's actually in play. Sending
  // dayOfMonth on a 'daily' routine, or daysOfWeek on a 'monthly' one, would
  // leave stale data in the DB the trigger would have to ignore. Send the
  // field that matches the cadence, or null it out.
  const dayOfMonth = cadence === 'monthly' ? sanitiseDayOfMonth(body.dayOfMonth) ?? 1 : null;
  const daysOfWeek = cadence === 'custom' ? sanitiseDaysOfWeek(body.daysOfWeek) : null;
  if (cadence === 'custom' && !daysOfWeek) {
    return NextResponse.json(
      { error: 'Pick at least one day for a custom routine.' },
      { status: 400 },
    );
  }

  // Cap routines per space — a wall of standing instructions is its own mess.
  const { count } = await supabase
    .from('Routine')
    .select('id', { count: 'exact', head: true })
    .eq('spaceId', space.id);
  if ((count ?? 0) >= MAX_ROUTINES) {
    return NextResponse.json(
      { error: `You've reached the limit of ${MAX_ROUTINES} routines.` },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('Routine')
    .insert({
      spaceId: space.id,
      instruction: instruction.slice(0, MAX_INSTRUCTION),
      cadence,
      hour,
      dayOfMonth,
      daysOfWeek,
    })
    .select(SELECT)
    .single();

  if (error) {
    logger.error('[routines] create failed', { spaceId: space.id }, error);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
