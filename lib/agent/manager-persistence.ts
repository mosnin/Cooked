/**
 * Message persistence for the manager Koala surface.
 *
 * The manager analogue of `lib/ai-tools/persistence.ts`. Manager conversations
 * and messages live in their OWN tables — "ManagerConversation" / "ManagerMessage"
 * — keyed by `teamId`, NOT by `spaceId`. That keeps team-private chat
 * structurally isolated from the rep "Conversation"/"Message" tables: a
 * rep surface cannot read a manager row because the rows are not even in the
 * same table, never mind the same space.
 *
 * Same content-coalescing + content-derivation rules as the rep helpers so
 * a manager message row reads identically (blocks for the renderer, content as
 * the joined text for legacy readers).
 */

import crypto from 'crypto';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { coalesceTextBlocks, type MessageBlock } from '@/lib/ai-tools/blocks';

/** Bump the parent conversation's updatedAt so the sidebar orders by recency. */
async function touchConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('ManagerConversation')
    .update({ updatedAt: new Date().toISOString() })
    .eq('id', conversationId);
  if (error) {
    // Non-fatal — the message already saved; ordering is cosmetic.
    logger.warn('[manager-persistence] touch conversation failed', { conversationId }, error);
  }
}

export interface SaveManagerUserMessageInput {
  teamId: string;
  conversationId: string;
  content: string;
}

export async function saveManagerUserMessage(
  input: SaveManagerUserMessageInput,
): Promise<{ messageId: string }> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('ManagerMessage').insert({
    id,
    teamId: input.teamId,
    conversationId: input.conversationId,
    role: 'user',
    content: input.content,
    // User messages are always plain text — no blocks.
  });
  if (error) {
    logger.error('[manager-persistence] saveManagerUserMessage failed', { teamId: input.teamId }, error);
    throw new Error(`Failed to save manager user message: ${error.message}`);
  }
  await touchConversation(input.conversationId);
  return { messageId: id };
}

export interface SaveManagerAssistantMessageInput {
  teamId: string;
  conversationId: string;
  blocks: MessageBlock[];
}

export async function saveManagerAssistantMessage(
  input: SaveManagerAssistantMessageInput,
): Promise<{ messageId: string }> {
  const merged = coalesceTextBlocks(input.blocks);
  const content = merged
    .filter((b): b is Extract<MessageBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
    .trim();

  const id = crypto.randomUUID();
  const { error } = await supabase.from('ManagerMessage').insert({
    id,
    teamId: input.teamId,
    conversationId: input.conversationId,
    role: 'assistant',
    // A pure tool-only turn has no text — store a short placeholder so legacy
    // readers don't render a blank row.
    content: content || '(tool-only turn)',
    blocks: merged as unknown as Record<string, unknown>[],
  });
  if (error) {
    logger.error('[manager-persistence] saveManagerAssistantMessage failed', { teamId: input.teamId }, error);
    throw new Error(`Failed to save manager assistant message: ${error.message}`);
  }
  await touchConversation(input.conversationId);
  return { messageId: id };
}
