/**
 * Conversation CRUD for the manager Koala surface.
 *
 * Parallel to `app/api/ai/conversations/route.ts` (the rep route) but
 * gated on manager access via `resolveManagerContext()` (defense layer 2).
 *
 * STORAGE IS STRUCTURALLY SEPARATE. Manager conversations live in their OWN
 * "ManagerConversation" table, keyed by `teamId` — NOT on a Space, NOT with
 * a title prefix. The teamId column is the boundary, so a rep surface
 * can never enumerate a manager conversation: the rows are not in its table.
 *
 * Phase 1 scope: create + list conversations the manager has had with Koala.
 */

import crypto from 'crypto';
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

export async function GET(_req: NextRequest) {
  const managerCtx = await resolveManagerContext();
  if (!managerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:manager-conversations:${managerCtx.team.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { data, error } = await supabase
    .from('ManagerConversation')
    .select('*')
    .eq('teamId', managerCtx.team.id)
    .order('updatedAt', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 });

  const conversations = data ?? [];

  // Preview line per conversation = the latest message's content. PostgREST
  // has no GROUP BY, so fetch recent rows for this set and keep the first
  // (latest) one we see per conversationId.
  const ids = conversations.map((c) => c.id);
  const previewMap: Record<string, string> = {};
  if (ids.length > 0) {
    const { data: msgs } = await supabase
      .from('ManagerMessage')
      .select('conversationId, content')
      .in('conversationId', ids)
      .order('createdAt', { ascending: false })
      .limit(ids.length * 20);
    if (msgs) {
      for (const msg of msgs) {
        if (msg.conversationId && !(msg.conversationId in previewMap)) {
          const text = (msg.content ?? '').replace(/\s+/g, ' ').trim();
          previewMap[msg.conversationId] = text.length > 60 ? text.slice(0, 59) + '…' : text;
        }
      }
    }
  }

  const result = conversations.map((c) => ({ ...c, preview: previewMap[c.id] ?? null }));
  return NextResponse.json(result);
}

export async function POST(_req: NextRequest) {
  const managerCtx = await resolveManagerContext();
  if (!managerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:manager-conversations:${managerCtx.team.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('ManagerConversation')
    .insert({
      id: crypto.randomUUID(),
      teamId: managerCtx.team.id,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}
