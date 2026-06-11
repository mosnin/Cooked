import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /koala/memory — legacy URL. Memory is configuration (how Koala works,
 * not what Koala did today) so it moved into Settings. Kept as a redirect
 * for bookmark safety.
 */
export default async function KoalaMemoryRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  redirect(`/s/${slug}/settings?tab=memory`);
}
