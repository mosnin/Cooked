/**
 * Message persistence for the broker Chippi surface.
 *
 * The broker analogue of `lib/ai-tools/persistence.ts`. Broker conversations
 * and messages live in their OWN tables — "BrokerConversation" / "BrokerMessage"
 * — keyed by `brokerageId`, NOT by `spaceId`. That keeps brokerage-private chat
 * structurally isolated from the realtor "Conversation"/"Message" tables: a
 * realtor surface cannot read a broker row because the rows are not even in the
 * same table, never mind the same space.
 *
 * Same content-coalescing + content-derivation rules as the realtor helpers so
 * a broker message row reads identically (blocks for the renderer, content as
 * the joined text for legacy readers).
 */

import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { coalesceTextBlocks, type MessageBlock } from '@/lib/ai-tools/blocks';

/** Bump the parent conversation's updatedAt so the sidebar orders by recency. */
async function touchConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('BrokerConversation')
    .update({ updatedAt: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) {
    // Non-fatal — the message already saved; ordering is cosmetic.
    logger.warn('[broker-persistence] touch conversation failed', { conversationId }, error);
  }
}

export interface SaveBrokerUserMessageInput {
  brokerageId: string;
  conversationId: string;
  content: string;
}

export async function saveBrokerUserMessage(
  input: SaveBrokerUserMessageInput,
): Promise<{ messageId: string }> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('BrokerMessage').insert({
    id,
    brokerageId: input.brokerageId,
    conversationId: input.conversationId,
    role: 'user',
    content: input.content,
    // User messages are always plain text — no blocks.
  });
  if (error) {
    logger.error('[broker-persistence] saveBrokerUserMessage failed', { brokerageId: input.brokerageId }, error);
    throw new Error(`Failed to save broker user message: ${error.message}`);
  }
  await touchConversation(input.conversationId);
  return { messageId: id };
}

export interface SaveBrokerAssistantMessageInput {
  brokerageId: string;
  conversationId: string;
  blocks: MessageBlock[];
}

export async function saveBrokerAssistantMessage(
  input: SaveBrokerAssistantMessageInput,
): Promise<{ messageId: string }> {
  const merged = coalesceTextBlocks(input.blocks);
  const content = merged
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
    .trim();

  const id = crypto.randomUUID();
  const { error } = await supabase.from('BrokerMessage').insert({
    id,
    brokerageId: input.brokerageId,
    conversationId: input.conversationId,
    role: 'assistant',
    // A pure tool-only turn has no text — store a short placeholder so legacy
    // readers don't render a blank row.
    content: content || '(tool-only turn)',
    blocks: merged as unknown as Record<string, unknown>[],
  });
  if (error) {
    logger.error('[broker-persistence] saveBrokerAssistantMessage failed', { brokerageId: input.brokerageId }, error);
    throw new Error(`Failed to save broker assistant message: ${error.message}`);
  }
  await touchConversation(input.conversationId);
  return { messageId: id };
}
