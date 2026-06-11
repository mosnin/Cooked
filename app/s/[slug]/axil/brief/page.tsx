/**
 * /axil/brief — the dedicated daily brief page.
 *
 * The brief's serif morning sentence IS the page's identity, so we omit
 * the shell's static title to avoid two serif h1s stacking. The greeting
 * line ("Today.") still orients; everything below it is the brief.
 *
 * Renders the live brief — bypasses the lifecycle collapse so the rep
 * always sees the full brief when they navigate here intentionally.
 */

import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { AxilPageShell } from '@/components/axil/axil-page-shell';
import { DailyBrief } from '@/components/axil/daily-brief';

export const dynamic = 'force-dynamic';

export default async function AxilBriefPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const { data: spaceOwner } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .eq('id', space.ownerId)
    .maybeSingle();
  if (!spaceOwner) notFound();

  return (
    <AxilPageShell greeting="Today.">
      <DailyBrief slug={slug} alwaysLive />
    </AxilPageShell>
  );
}
