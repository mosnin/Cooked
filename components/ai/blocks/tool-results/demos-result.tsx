'use client';

import { useParams } from 'next/navigation';
import { DemoCard, type DemoSummary } from './demo-card';

interface DemosResultData {
  demos: DemoSummary[];
}

/**
 * Inline rendering of `schedule_demo` (and any future demo-listing) tool
 * results. Each demo renders as an expandable inline card with a mini
 * schedule / timeline view on expand.
 */
export function DemosResult({ data }: { data: DemosResultData }) {
  const params = useParams();
  const slug = params?.slug as string | undefined;

  if (!data.demos?.length) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {data.demos.map((t, i) => (
        <DemoCard key={t.demoId} demo={t} slug={slug ?? ''} animDelay={i * 0.05} />
      ))}
    </div>
  );
}
