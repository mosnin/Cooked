import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { AffiliateView } from './affiliate-view';

export default async function AffiliatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return <AffiliateView slug={slug} />;
}
