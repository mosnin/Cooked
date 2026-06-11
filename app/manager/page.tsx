import { redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { getManagerMemberContext } from '@/lib/permissions';
import { AxilWorkspace } from '@/components/axil/axil-workspace';
import { MemberDashboard } from './member-dashboard';
import type { Conversation } from '@/lib/types';
import type { MessageBlock } from '@/lib/ai-tools/blocks';

/**
 * /manager — the team home.
 *
 * Mirrors the rep home (`/s/[slug]/axil`): the home IS the Koala chat.
 * Owners and admins land on the team chief-of-staff chat
 * (`AxilWorkspace variant="manager"`, backed by /api/ai/manager-task), scoped
 * to the whole team. The team-overview dashboard moved to `/manager/brief`.
 *
 * `rep_member`s are unchanged — they get their own work surface
 * (`MemberDashboard`), never the team chat.
 */

export const dynamic = 'force-dynamic';

export default async function ManagerHomePage({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; prompt?: string; prefill?: string }>;
}) {
  const ctx = await getManagerMemberContext();
  if (!ctx) redirect('/');

  // rep_member sees their own work surface, not the team chat.
  if (ctx.membership.role === 'rep_member') {
    return <MemberDashboard ctx={ctx} />;
  }

  const { conversationId: urlConversationId, prompt: urlPrompt, prefill: urlPrefill } = await searchParams;
  const initialPrefill =
    typeof urlPrompt === 'string' && urlPrompt.trim().length > 0
      ? urlPrompt
      : typeof urlPrefill === 'string' && urlPrefill.trim().length > 0
        ? urlPrefill
        : undefined;

  // Manager conversations + messages live in their OWN tables, keyed by
  // teamId — structurally separate from the rep "Conversation"/
  // "Message" tables. No Space lookup, no title-prefix query.
  const { data: convData } = await supabase
    .from('ManagerConversation')
    .select('*')
    .eq('teamId', ctx.team.id)
    .order('updatedAt', { ascending: false })
    .limit(50);
  const conversations = (convData ?? []) as Conversation[];

  let initialMessages: { role: 'user' | 'assistant'; content: string; blocks?: MessageBlock[] | null }[] = [];
  let initialConversationId: string | null = null;

  if (urlConversationId) {
    // Verify the requested conversation belongs to THIS team BEFORE
    // loading messages. Without this guard an arbitrary conversationId in the
    // URL (another team's) would render its private history. A rep
    // conversation id simply won't exist in "ManagerConversation".
    const { data: convRow } = await supabase
      .from('ManagerConversation')
      .select('id, teamId')
      .eq('id', urlConversationId)
      .maybeSingle();
    const isThisTeamConversation =
      convRow != null && (convRow as { teamId: string }).teamId === ctx.team.id;

    if (isThisTeamConversation) {
      initialConversationId = urlConversationId;
      const { data: msgData } = await supabase
        .from('ManagerMessage')
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
    // Foreign / rep / unknown conversation id → new-chat state.
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <AxilWorkspace
        slug=""
        variant="manager"
        initialMessages={initialMessages}
        initialConversations={conversations}
        initialConversationId={initialConversationId}
        initialPrefill={initialPrefill}
      />
    </div>
  );
}
