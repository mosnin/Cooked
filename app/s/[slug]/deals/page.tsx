import { notFound, redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getSpaceFromSlug, getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { DealsPageClient } from '@/components/deals/deals-page-client';
import type { Pipeline, DealStage, Deal } from '@/lib/types';

type StageWithDeals = DealStage & { deals: Deal[] };

/**
 * Server-side fetch for pipelines + the default pipeline's stages-with-deals.
 *
 * Without this the deals page would render KPI cells at 0 until the client
 * round-trip finished — on a slow connection the realtor would see "0 active
 * deals" for a beat on every reload, which read as "I lost your data."
 * Pre-computing on the server makes the first paint truthful.
 *
 * Failures are non-fatal: any throw drops us back to the legacy
 * empty-then-fetch behaviour so the page never hard-blocks on a stat strip.
 */
async function loadInitialDealsData(spaceId: string): Promise<{
  pipelines: Pipeline[];
  initialStages: StageWithDeals[];
  initialPipelineId: string | null;
}> {
  try {
    const { data: pipelineRows } = await supabase
      .from('Pipeline')
      .select('*')
      .eq('spaceId', spaceId)
      .order('position', { ascending: true });

    const pipelines = (pipelineRows ?? []) as Pipeline[];
    if (pipelines.length === 0) {
      return { pipelines, initialStages: [], initialPipelineId: null };
    }

    // The client may override this with the realtor's localStorage pick after
    // mount; the first paint uses the first pipeline so we always have
    // something to compute KPIs from.
    const firstPipelineId = pipelines[0].id;
    const { data: stageRows } = await supabase
      .from('DealStage')
      .select('*')
      .eq('spaceId', spaceId)
      .eq('pipelineId', firstPipelineId)
      .order('position', { ascending: true });
    const stages = (stageRows ?? []) as DealStage[];

    const stageIds = stages.map((s) => s.id);
    let dealRows: Deal[] = [];
    if (stageIds.length > 0) {
      const { data } = await supabase
        .from('Deal')
        .select('*')
        .eq('spaceId', spaceId)
        .in('stageId', stageIds);
      dealRows = (data ?? []) as Deal[];
    }

    const dealsByStage = new Map<string, Deal[]>();
    for (const deal of dealRows) {
      const arr = dealsByStage.get(deal.stageId) ?? [];
      arr.push(deal);
      dealsByStage.set(deal.stageId, arr);
    }

    const initialStages: StageWithDeals[] = stages.map((s) => ({
      ...s,
      deals: dealsByStage.get(s.id) ?? [],
    }));

    return { pipelines, initialStages, initialPipelineId: firstPipelineId };
  } catch (err) {
    console.error('[deals] initial SSR fetch failed', err);
    return { pipelines: [], initialStages: [], initialPipelineId: null };
  }
}

export default async function DealsPage({
  params
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Middleware only requires login; ownership of /s/[slug] is enforced here.
  const { userId } = await auth();
  if (!userId) redirect('/login/realtor');

  let space;
  try {
    space = await getSpaceFromSlug(slug);
  } catch (err) {
    console.error('[deals] DB queries failed', err);
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your data. This is usually temporary.</p>
          <a href={`/s/${slug}/deals`} className="inline-block px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90">Try again</a>
        </div>
      </div>
    );
  }
  if (!space) notFound();

  const userSpace = await getSpaceForUser(userId);
  if (!userSpace || userSpace.id !== space.id) notFound();

  const { pipelines, initialStages, initialPipelineId } = await loadInitialDealsData(space.id);

  return (
    <DealsPageClient
      slug={slug}
      initialPipelines={pipelines}
      initialStages={initialStages}
      initialPipelineId={initialPipelineId}
    />
  );
}
