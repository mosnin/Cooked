/**
 * /s/[slug]/sync — Smart sync.
 *
 * Server component. Resolves the space via `getSpaceFromSlug` and
 * renders a 404 if missing, matching the pattern of other [slug] pages.
 *
 * Data fetching (CRM connections + records) is deferred to the client
 * via /api/sync so this server render stays cheap and paints immediately
 * even if Composio is slow.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { SyncView } from './sync-view';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Smart sync — ${slug}` };
}

export default async function SyncPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return <SyncView slug={slug} />;
}
