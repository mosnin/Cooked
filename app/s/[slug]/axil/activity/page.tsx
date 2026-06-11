import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /axil/activity — legacy URL. The page now lives at /axil/history
 * (rep's noun, not ours). Kept as a redirect for bookmark safety.
 */
export default async function AxilActivityRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  redirect(`/s/${slug}/axil/history`);
}
