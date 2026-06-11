import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { PracticeView } from '@/components/practice/practice-view';

export const metadata = { title: 'Practice — Koala' };

export default async function PracticePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return <PracticeView slug={slug} />;
}
