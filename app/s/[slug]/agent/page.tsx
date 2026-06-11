import { redirect } from 'next/navigation';

/**
 * /agent is an old route name. The unified Koala workspace lives at /axil —
 * preserve ?tab=settings (and any other tab values) for legacy deep links.
 */
export default async function AgentRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const target = tab ? `/s/${slug}/axil?tab=${encodeURIComponent(tab)}` : `/s/${slug}/axil`;
  redirect(target);
}
