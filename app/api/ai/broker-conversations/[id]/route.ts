/**
 * Rename / delete a single broker Chippi conversation.
 *
 * The broker analogue of `app/api/ai/conversations/[id]/route.ts`. Gated on
 * broker access via `resolveBrokerContext()` (defense layer 2), and every
 * mutation is scoped to the caller's brokerage: the row must belong to THIS
 * brokerage or it 404s. Operates on the separate "BrokerConversation" /
 * "BrokerMessage" tables — never the realtor "Conversation"/"Message" tables.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { resolveBrokerContext } from '@/lib/agent/broker-context';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const rateLimited = () =>
  NextResponse.json(
    { error: 'too many requests. try again shortly.' },
    { status: 429, headers: { 'Retry-After': '60' } },
  );

/** Resolve the conversation only if it belongs to the caller's brokerage. */
async function ownedConversation(conversationId: string, brokerageId: string) {
  const { data } = await supabase
    .from('BrokerConversation')
    .select('id, brokerageId')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || data.brokerageId !== brokerageId) return null;
  return data;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const brokerCtx = await resolveBrokerContext();
  if (!brokerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:broker-conversations:${brokerCtx.brokerage.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { id } = await params;
  const conv = await ownedConversation(id, brokerCtx.brokerage.id);
  if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

  const { title } = await req.json();
  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('BrokerConversation')
    .update({ title: title.trim(), updatedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('brokerageId', brokerCtx.brokerage.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: 'Failed to rename conversation' }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const brokerCtx = await resolveBrokerContext();
  if (!brokerCtx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`ai:broker-conversations:${brokerCtx.brokerage.ownerId}`, 20, 60);
  if (!allowed) return rateLimited();

  const { id } = await params;
  const conv = await ownedConversation(id, brokerCtx.brokerage.id);
  if (!conv) return NextResponse.json({ error: 'Not found or Forbidden' }, { status: 404 });

  // "BrokerMessage" rows cascade on the conversation FK, so deleting the
  // conversation row removes its messages too.
  const { error } = await supabase
    .from('BrokerConversation')
    .delete()
    .eq('id', id)
    .eq('brokerageId', brokerCtx.brokerage.id);
  if (error) return NextResponse.json({ error: 'Failed to delete conversation' }, { status: 500 });

  return NextResponse.json({ success: true });
}
