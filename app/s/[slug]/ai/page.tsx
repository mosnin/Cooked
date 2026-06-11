import { redirect } from 'next/navigation';

/**
 * /ai is an old route name. The unified Koala workspace lives at /koala —
 * pass the original ?q= search param through so command-palette deep links
 * keep working.
 */
export default async function AIRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { slug } = await params;
  const { q } = await searchParams;
  const target = q ? `/s/${slug}/koala?q=${encodeURIComponent(q)}` : `/s/${slug}/koala`;
  redirect(target);
}
