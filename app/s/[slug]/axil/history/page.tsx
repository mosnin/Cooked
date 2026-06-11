import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { ActivityFeed } from '@/components/axil/activity-feed';
import { AxilPageShell } from '@/components/axil/axil-page-shell';

export const metadata = { title: 'History — Koala' };

export default async function AxilHistoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Verify ownership before rendering
  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  return (
    <AxilPageShell
      greeting="Log."
      title="Here's what I did."
    >
      <ActivityFeed slug={slug} />
    </AxilPageShell>
  );
}
