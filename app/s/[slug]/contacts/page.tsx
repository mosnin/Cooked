import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug, getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { ContactTable } from '@/components/contacts/contact-table';
import { PerformanceStrip } from '@/components/contacts/performance-strip';
import type { DealMetricRow, StageMetricRow } from '@/lib/deal-metrics';

/**
 * Read-only fetch of the realtor's own deals + stages for the performance
 * strip. Mirrors the deals page query (Deal/DealStage scoped to spaceId) but
 * pulls the whole book — every stage, every deal — because this strip reports
 * the realtor's overall output, not a single pipeline. Never writes.
 *
 * Failures are non-fatal: a throw returns empty arrays, the metric functions
 * return null, and the strip renders calm empty states instead of breaking
 * the page.
 */
async function loadPerformanceData(spaceId: string): Promise<{
  deals: DealMetricRow[];
  stages: StageMetricRow[];
}> {
  try {
    const [{ data: dealRows }, { data: stageRows }] = await Promise.all([
      supabase
        .from('Deal')
        .select('id, status, stageId, createdAt, closedAt, stageChangedAt')
        .eq('spaceId', spaceId),
      supabase
        .from('DealStage')
        .select('id, name')
        .eq('spaceId', spaceId)
        .order('position', { ascending: true }),
    ]);
    return {
      deals: (dealRows ?? []) as DealMetricRow[],
      stages: (stageRows ?? []) as StageMetricRow[],
    };
  } catch (err) {
    console.error('[contacts] performance fetch failed', err);
    return { deals: [], stages: [] };
  }
}

export default async function ContactsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  // Middleware only requires login; ownership of /s/[slug] is enforced here.
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const userSpace = await getSpaceForUser(userId);
  if (!userSpace || userSpace.id !== space.id) notFound();

  const { deals, stages } = await loadPerformanceData(space.id);

  // ContactTable owns its own header, filters, and rows — one client
  // component, one source of truth for the surface. The New/All tab strip
  // that used to sit above is gone: the stage filter already cuts state,
  // and stacking two state-cuts on top of each other was the chief source
  // of the "messy top" the realtor flagged.
  //
  // The performance strip sits above the table: the three numbers that move
  // output (time-to-close, conversion, bottleneck) read first, then the book.
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <PerformanceStrip deals={deals} stages={stages} />
      <ContactTable slug={slug} />
    </div>
  );
}
