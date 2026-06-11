import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { CallsView } from './calls-view';

export const metadata = { title: 'Calls — Chippi' };

export default async function CallsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return <CallsView slug={slug} />;
}
