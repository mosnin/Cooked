import { redirect } from 'next/navigation';

/**
 * /manager/koala — folded into the team home.
 *
 * The team chat is now the home surface at `/manager` (mirroring the
 * rep home). This route stays as a permanent redirect so existing links,
 * bookmarks, and the `?prompt=` deep-links keep working.
 */
export default async function ManagerKoalaRedirect({
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
  redirect(query ? `/manager?${query}` : '/manager');
}
