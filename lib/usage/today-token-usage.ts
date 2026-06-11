/**
 * getTodayTokenUsage — sum a space's token usage so far today (UTC).
 *
 * Two write paths feed today's number and they MUST be summed together
 * if any caller (display, enforcement) wants the truth:
 *
 *   - Chat turns insert `ChatUsage` rows. The Python side is
 *     `agent/ledger.py → record_chat_usage`; the TS side targets the
 *     same table (see ledger.py docstring).
 *   - Autonomous runs (cron / routines) call
 *     `agent/security/budget.py → record_usage`, which only writes to
 *     Upstash Redis at the key `agent:budget:{spaceId}:{YYYY-MM-DD}`.
 *
 * One shared helper so the Settings usage bar and the chat-budget
 * enforcement can't drift apart and disagree about whether the realtor
 * is over budget. Both callers route through this function.
 *
 * Redis failure is swallowed — chat tokens alone are still a useful
 * answer. Supabase failure surfaces as a thrown error; callers wrap it.
 */

import { supabase } from '@/lib/supabase';

export interface TodayTokenUsage {
  chat: number;
  autonomous: number;
  total: number;
}

export async function getTodayTokenUsage(spaceId: string): Promise<TodayTokenUsage> {
  const todayUtc = new Date().toISOString().slice(0, 10);

  const { data: chatRows } = await supabase
    .from('ChatUsage')
    .select('promptTokens, completionTokens')
    .eq('spaceId', spaceId)
    .gte('createdAt', `${todayUtc}T00:00:00.000Z`);

  const chat = (chatRows ?? []).reduce(
    (sum: number, row: { promptTokens: number | null; completionTokens: number | null }) =>
      sum + (row.promptTokens ?? 0) + (row.completionTokens ?? 0),
    0,
  );

  let autonomous = 0;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) {
    try {
      const key = `agent:budget:${spaceId}:${todayUtc}`;
      const res = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${kvToken}` },
      });
      if (res.ok) {
        const { result } = (await res.json()) as { result: string | null };
        autonomous = result ? parseInt(result, 10) : 0;
      }
    } catch {
      // Best-effort — chat tokens still a useful answer.
    }
  }

  return { chat, autonomous, total: chat + autonomous };
}
