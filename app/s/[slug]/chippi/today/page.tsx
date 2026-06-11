/**
 * /chippi/today — redirects to /chippi/brief.
 *
 * The old "full day" dashboard stacked seven equal-weight panels with no
 * focal element — the Jobs-lens audit scored it 1/5 on hierarchy and
 * 1/5 on sibling coherence. The brief absorbs its useful pieces; the
 * page itself was a junk drawer.
 *
 * Permanent server redirect keeps every old bookmark + every signal-source
 * link (slack.ts surfaces "go to today" hrefs) pointing at the right place
 * without a code sweep. The brief IS today.
 *
 * To delete the source components (TodayFocus, WhatsComing, WhatIDid,
 * AgentQuestionsPanel) — that's a follow-up cleanup once the brief has
 * absorbed what's worth keeping from them.
 */

import { redirect } from 'next/navigation';

export default async function ChippiTodayRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/s/${slug}/chippi/brief`);
}
