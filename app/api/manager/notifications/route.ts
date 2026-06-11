import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/manager/notifications
 * Returns the latest manager notifications.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: notifications } = await supabase
    .from('ManagerNotification')
    .select('*')
    .eq('teamId', ctx.team.id)
    .order('createdAt', { ascending: false })
    .limit(20);

  return NextResponse.json({ notifications: notifications ?? [] });
}

/**
 * PATCH /api/manager/notifications
 * Mark all unread notifications as read.
 */
export async function PATCH() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase
    .from('ManagerNotification')
    .update({ read: true })
    .eq('teamId', ctx.team.id)
    .eq('read', false);

  return NextResponse.json({ success: true });
}
