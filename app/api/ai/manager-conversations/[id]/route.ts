/**
 * Rename / delete a single manager Koala conversation.
 *
 * The manager analogue of `app/api/ai/conversations/[id]/route.ts`. Gated on
 * manager access via `resolveManagerContext()` (defense layer 2), and every
 * mutation is scoped to the caller's team: the row must belong to THIS
 * team or it 404s. Operates on the separate "ManagerConversation" /
 * "ManagerMessage" tables — never the rep "Conversation"/"Message" tables.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const rateLimited = () =>
  NextResponse.json(
    { error: 'too many requests. try again shortly.' },
    { status: 429, headers: { 'Retry-After': '60' } },
  );

/** Resolve the conversation only if it belongs to the caller's team. */
async function ownedConversation(conversationId: string, teamId: string) {
  const { data } = await supabase
    .from('ManagerConversation')
    .select('id, teamId')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.teamId !== teamId) return null;
  return data;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const managerCtx = await resolveManagerContext();
  if (!managerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:manager-conversations:${managerCtx.team.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { id } = await params;
  const conv = await ownedConversation(id, managerCtx.team.id);
  if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

  const { title } = await req.json();
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('ManagerConversation')
    .update({ title: title.trim(), updatedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('teamId', managerCtx.team.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: 'Failed to rename conversation' }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const managerCtx = await resolveManagerContext();
  if (!managerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:manager-conversations:${managerCtx.team.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { id } = await params;
  const conv = await ownedConversation(id, managerCtx.team.id);
  if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

  // "ManagerMessage" rows cascade on the conversation FK, so deleting the
  // conversation row removes its messages too.
  const { error } = await supabase
    .from('ManagerConversation')
    .delete()
    .eq('id', id)
    .eq('teamId', managerCtx.team.id);
  if (error) return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });

  return NextResponse.json({ success: true });
}
