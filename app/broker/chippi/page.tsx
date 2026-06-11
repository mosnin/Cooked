import { redirect } from 'next/navigation';

/**
 * /broker/chippi — folded into the brokerage home.
 *
 * The brokerage chat is now the home surface at `/broker` (mirroring the
 * realtor home). This route stays as a permanent redirect so existing links,
 * bookmarks, and the `?prompt=` deep-links keep working.
 */
export default async function BrokerChippiRedirect({
  searchParams,
}: {
  searchParams: Promise<{ conversationId?: string; prompt?: string; prefill?: string }>;
}) {
  const { conversationId, prompt, prefill } = await searchParams;
  const qs = new URLSearchParams();
  if (conversationId) qs.set('conversationId', conversationId);
  if (prompt) qs.set('prompt', prompt);
  if (prefill) qs.set('prefill', prefill);
  const query = qs.toString();
  redirect(query ? `/broker?${query}` : '/broker');
}
