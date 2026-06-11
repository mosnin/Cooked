/**
 * Files page — generic upload surface for documents, images, PDFs, videos,
 * and audio. Falls back to a graceful empty state when nothing's been
 * uploaded yet. All actual uploading + listing happens client-side via
 * /api/files so the page can be a thin server shell.
 *
 * Header follows STYLESHEET.md § "The status-sentence pattern":
 *   muted greeting line (with period) → serif h1 → one-sentence status.
 * The status sentence is computed from File table totals so the realtor
 * lands on a calm fact, not a directive ("Drop a file here…" reads as a
 * tooltip; "27 files. 142 MB so far." reads as the workspace's state).
 */

import { notFound } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { formatBytes } from '@/lib/storage/limits';
import { H1, TITLE_FONT, BODY_MUTED } from '@/lib/typography';
import { FilesPanel } from './files-panel';

export const dynamic = 'force-dynamic';

export default async function FilesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  // Status-sentence data. We pull size + createdAt for the most recent few
  // rows + a head-count so the sentence stays honest without dragging the
  // full file list server-side (the client panel already does that).
  const [{ count: fileCount }, { data: aggregateRows }] = await Promise.all([
    supabase
      .from('File')
      .select('*', { count: 'exact', head: true })
      .eq('spaceId', space.id),
    supabase
      .from('File')
      .select('sizeBytes, createdAt')
      .eq('spaceId', space.id)
      .order('createdAt', { ascending: false })
      .limit(500),
  ]);

  const totalBytes = (aggregateRows ?? []).reduce(
    (sum, row) => sum + (row.sizeBytes ?? 0),
    0,
  );
  const count = fileCount ?? 0;

  const statusSentence =
    count === 0
      ? 'Nothing uploaded yet — drop a file anywhere on this page.'
      : `${count} ${count === 1 ? 'file' : 'files'}, ${formatBytes(totalBytes)} so far.`;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Files.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          All files
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence}</p>
      </header>
      <FilesPanel />
    </div>
  );
}
