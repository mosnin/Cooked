import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /routines — legacy URL. Routines are configuration (how Koala works,
 * not what Koala did today) so it moved into Settings. Kept as a redirect
 * for bookmark safety.
 */
export default async function RoutinesRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  redirect(`/s/${slug}/settings?tab=routines`);
}
