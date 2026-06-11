/**
 * Support tickets (admin-facing) — GET / PATCH
 *
 *   GET  ?status=<status>  → { tickets }  all tickets, newest first, optional filter
 *   PATCH { id, status?, priority?, adminNote? }  → { ticket }  triage an update
 *
 * Auth: requirePlatformAdmin() — same gate as every other /api/admin/* route.
 */

import { NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { logAdminAction } from '@/lib/admin';
import { checkRateLimit } from '@/lib/rate-limit';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'normal', 'high'] as const;
type Status = (typeof STATUSES)[number];
type Priority = (typeof PRIORITIES)[number];

const ADMIN_NOTE_MAX = 5000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TICKET_COLUMNS =
  'id, spaceId, userId, email, name, subject, message, category, status, priority, adminNote, createdAt, updatedAt';

// ── GET — list all tickets (optional ?status= filter) ───────────────────────

export async function GET(req: Request) {
  let admin: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    admin = await requirePlatformAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { allowed } = await checkRateLimit(`admin:read:${admin.clerkUserId}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const status = new URL(req.url).searchParams.get('status');

  let query = supabase
    .from('SupportTicket')
    .select(TICKET_COLUMNS)
    .order('createdAt', { ascending: false })
    .limit(500);

  if (status && (STATUSES as readonly string[]).includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[admin/support] list failed', error);
    return NextResponse.json({ error: 'Query failed' }, { status: 500 });
  }
  return NextResponse.json({ tickets: data ?? [] });
}

// ── PATCH — update status / priority / adminNote ────────────────────────────

export async function PATCH(req: Request) {
  let admin: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    admin = await requirePlatformAdmin();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { allowed } = await checkRateLimit(`admin:${admin.clerkUserId}`, 30, 60);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  let body: { id?: string; status?: string; priority?: string; adminNote?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = body.id;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    update.status = body.status as Status;
  }

  if (body.priority !== undefined) {
    if (!(PRIORITIES as readonly string[]).includes(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 });
    }
    update.priority = body.priority as Priority;
  }

  if (body.adminNote !== undefined) {
    const note = body.adminNote === null ? null : String(body.adminNote).trim();
    if (note && note.length > ADMIN_NOTE_MAX) {
      return NextResponse.json({ error: 'Note too long' }, { status: 400 });
    }
    update.adminNote = note || null;
  }

  // Nothing to change beyond the timestamp — reject so we don't log a no-op.
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('SupportTicket')
    .update(update)
    .eq('id', id)
    .select(TICKET_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error('[admin/support] update failed', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
  }

  await logAdminAction({
    actor: admin.clerkUserId,
    action: 'update_support_ticket',
    target: id,
    details: {
      status: update.status,
      priority: update.priority,
      noteChanged: update.adminNote !== undefined,
    },
  });

  return NextResponse.json({ ticket: data });
}
