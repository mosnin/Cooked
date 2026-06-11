import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getBrokerMemberContext } from '@/lib/permissions';
import { ChippiWorkspace } from '@/components/chippi/chippi-workspace';
import { MemberDashboard } from './member-dashboard';
import type { Conversation } from '@/lib/types';
import type { MessageBlock } from '@/lib/ai-tools/blocks';

/**
 * /broker — the brokerage home.
 *
 * Mirrors the realtor home (`/s/[slug]/chippi`): the home IS the Chippi chat.
 * Owners and admins land on the brokerage chief-of-staff chat
 * (`ChippiWorkspace variant="broker"`, backed by /api/ai/broker-task), scoped
 * to the whole brokerage. The team-overview dashboard moved to `/broker/brief`.
 *
 * `realtor_member`s are unchanged — they get their own work surface
 * (`MemberDashboard`), never the brokerage chat.
 */

export const dynamic = 'force-dynamic';

export default async function BrokerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; prompt?: string; prefill?: string }>;
}) {
  const ctx = await getBrokerMemberContext();
  if (!ctx) redirect('/');

  // realtor_member sees their own work surface, not the brokerage chat.
  if (ctx.membership.role === 'realtor_member') {
    return <MemberDashboard ctx={ctx} />;
  }

  const { conversationId: urlConversationId, prompt: urlPrompt, prefill: urlPrefill } = await searchParams;
  const initialPrefill =
    typeof urlPrompt === 'string' && urlPrompt.trim().length > 0
      ? urlPrompt
      : typeof urlPrefill === 'string' && urlPrefill.trim().length > 0
        ? urlPrefill
        : undefined;

  // Broker conversations + messages live in their OWN tables, keyed by
  // brokerageId — structurally separate from the realtor "Conversation"/
  // "Message" tables. No Space lookup, no title-prefix query.
  const { data: convData } = await supabase
    .from('BrokerConversation')
    .select('*')
    .eq('brokerageId', ctx.brokerage.id)
    .order('updatedAt', { ascending: false })
    .limit(50);
  const conversations = (convData ?? []) as Conversation[];

  let initialMessages: { role: 'user' | 'assistant'; content: string; blocks?: MessageBlock[] | null }[] = [];
  let initialConversationId: string | null = null;

  if (urlConversationId) {
    // Verify the requested conversation belongs to THIS brokerage BEFORE
    // loading messages. Without this guard an arbitrary conversationId in the
    // URL (another brokerage's) would render its private history. A realtor
    // conversation id simply won't exist in "BrokerConversation".
    const { data: convRow } = await supabase
      .from('BrokerConversation')
      .select('id, brokerageId')
      .eq('id', urlConversationId)
      .maybeSingle();
    const isThisBrokerageConversation =
      convRow != null && (convRow as { brokerageId: string }).brokerageId === ctx.brokerage.id;

    if (isThisBrokerageConversation) {
      initialConversationId = urlConversationId;
      const { data: msgData } = await supabase
        .from('BrokerMessage')
        .select('role, content, blocks')
        .eq('conversationId', urlConversationId)
        .order('createdAt', { ascending: true })
        .limit(50);
      initialMessages = ((msgData ?? []) as {
        role: string;
        content: string;
        blocks: MessageBlock[] | null;
      }[]).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        blocks: m.blocks,
      }));
    }
    // Foreign / realtor / unknown conversation id → new-chat state.
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <ChippiWorkspace
        slug=""
        variant="broker"
        initialMessages={initialMessages}
        initialConversations={conversations}
        initialConversationId={initialConversationId}
        initialPrefill={initialPrefill}
      />
    </div>
  );
}
