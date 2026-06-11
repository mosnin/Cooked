/**
 * GET /api/ai/manager-messages?conversationId= — messages for a manager Koala
 * conversation.
 *
 * The manager analogue of `app/api/ai/messages/route.ts`. Gated on manager
 * access via `resolveManagerContext()` (defense layer 2). The conversation is
 * verified to belong to the caller's team BEFORE any message is returned —
 * a conversationId from another team (or a rep conversation, which
 * won't even exist in "ManagerConversation") gets a 404, never another
 * team's history.
 *
 * Storage is structurally separate: messages come from "ManagerMessage", keyed
 * by teamId + conversationId. There is no path from here into the rep
 * "Message" table.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveManagerContext } from '@/lib/agent/manager-context';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const MESSAGE_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const managerCtx = await resolveManagerContext();
    if (!managerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { allowed } = await checkRateLimit(`ai:manager-messages:${managerCtx.team.ownerId}`, 20, 60);
    if (!allowed) {
      return NextResponse.json(
        { error: 'too many requests. try again shortly.' },
        { status: 429, headers: { 'Retry-After': '60' } },
      );
    }

    const conversationId = req.nextUrl.searchParams.get('conversationId');
    if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400 });

    // Verify the conversation belongs to THIS team before loading any
    // message. teamId is the boundary — ownership of the conversation row
    // is what gates access, not a title string.
    const { data: conv, error: convErr } = await supabase
      .from('ManagerConversation')
      .select('id, teamId')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) {
      console.error('[manager-messages] Conversation lookup failed:', convErr);
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
    }
    if (!conv || conv.teamId !== managerCtx.team.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('ManagerMessage')
      .select('id, role, content, blocks, createdAt')
      .eq('conversationId', conversationId)
      .order('createdAt', { ascending: true })
      .limit(MESSAGE_LIMIT);
    if (error) {
      console.error('[manager-messages] Message lookup failed:', error);
      return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error('[manager-messages] GET error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
