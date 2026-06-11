import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { CmaView } from './cma-view';

export const metadata = { title: 'CMA — Chippi' };

export default async function CmaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return <CmaView slug={slug} />;
}
