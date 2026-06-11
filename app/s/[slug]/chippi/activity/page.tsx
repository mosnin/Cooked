import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /chippi/activity — legacy URL. The page now lives at /chippi/history
 * (realtor's noun, not ours). Kept as a redirect for bookmark safety.
 */
export default async function ChippiActivityRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  redirect(`/s/${slug}/chippi/history`);
}
