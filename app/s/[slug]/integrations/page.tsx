import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /integrations — legacy URL. Connected apps are configuration (how Koala
 * works, not what Koala did today) so it moved into Settings. Kept as a
 * redirect for bookmark safety. The rep-facing trust sentence
 * ("Koala never sends without your tap.") now lives in the Settings
 * Connections section.
 */
export default async function IntegrationsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  redirect(`/s/${slug}/settings?tab=connections`);
}
