import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

/**
 * /integrations — legacy URL. Connected apps are configuration (how Chippi
 * works, not what Chippi did today) so it moved into Settings. Kept as a
 * redirect for bookmark safety. The realtor-facing trust sentence
 * ("Chippi never sends without your tap.") now lives in the Settings
 * Connections section.
 */
export default async function IntegrationsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  redirect(`/s/${slug}/settings?tab=connections`);
}
