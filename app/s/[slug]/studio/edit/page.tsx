import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { EditPanel } from './edit-panel';
import { H1, TITLE_FONT, BODY_MUTED, PAGE_RHYTHM } from '@/lib/typography';
import { cn } from '@/lib/utils';
import { PageTransition } from '@/components/motion/page-transition';

export const dynamic = 'force-dynamic';

export default async function StudioEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  // `fileId` comes from the Library "Edit" affordance — the panel hydrates
  // the source picker from this id so the realtor doesn't have to
  // re-upload an asset that already lives in their files.
  searchParams: Promise<{ fileId?: string }>;
}) {
  const { slug } = await params;
  const { fileId } = await searchParams;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  return (
    <PageTransition className={cn('mx-auto max-w-5xl px-6 py-8', PAGE_RHYTHM)}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>Studio.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Edit
        </h1>
        <p className={BODY_MUTED}>
          Upscale, clean up backgrounds, restyle an image.
        </p>
      </header>
      <EditPanel
        initialFileId={typeof fileId === 'string' ? fileId : undefined}
      />
    </PageTransition>
  );
}
