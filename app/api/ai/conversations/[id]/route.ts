import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { isReservedConversationTitle } from '@/lib/chat/conversation-access';

const rateLimited = () =>
  NextResponse.json(
    { error: 'too many requests. try again shortly.' },
    { status: 429, headers: { 'Retry-After': '60' } },
  );

async function getConversationAndVerifyOwner(conversationId: string, userId: string) {
  const { data: conv, error } = await supabase
    .from('Conversation')
    .select('id, spaceId, title, Space(ownerId)')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!conv) return null;

  const { data: user } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', (conv as any).Space.ownerId)
    .maybeSingle();
  if (!user) return null;

  // Surface guard: broker-Chippi and team conversations have their own
  // broker-gated routes. A broker_owner also owns their personal realtor
  // space, so ownership alone is not isolation. Refuse to rename/delete a
  // broker conversation through the realtor endpoint. The reserved-title
  // check lives in lib/chat/conversation-access.
  if (isReservedConversationTitle((conv as { title?: string }).title)) {
    return null;
  }

  return conv;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { allowed } = await checkRateLimit(`ai:conversations:${userId}`, 20, 60);
    if (!allowed) return rateLimited();

    const { id } = await params;
    const conv = await getConversationAndVerifyOwner(id, userId);
    if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

    const { title } = await req.json();
    if (!title || typeof title !== 'string') {
      return NextResponse.json({ error: 'title required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('Conversation')
      .update({ title: title.trim(), updatedAt: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: 'Failed to rename conversation' }, { status: 500 });

    return NextResponse.json(data);
  } catch (err) {
    console.error('[conversations/[id]] PATCH error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { allowed } = await checkRateLimit(`ai:conversations:${userId}`, 20, 60);
    if (!allowed) return rateLimited();

    const { id } = await params;
    const conv = await getConversationAndVerifyOwner(id, userId);
    if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

    const { error } = await supabase.from('Conversation').delete().eq('id', id).eq('spaceId', conv.spaceId);
    if (error) return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[conversations/[id]] DELETE error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
