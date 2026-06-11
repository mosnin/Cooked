import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /chippi/memory — legacy URL. Memory is configuration (how Chippi works,
 * not what Chippi did today) so it moved into Settings. Kept as a redirect
 * for bookmark safety.
 */
export default async function ChippiMemoryRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  redirect(`/s/${slug}/settings?tab=memory`);
}
