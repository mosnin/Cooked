import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerForecastLoading() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12 animate-pulse">
      {/* Status-sentence header */}
      <header className="space-y-1.5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
      </header>

      {/* Focal projected number */}
      <div className="space-y-1">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-12 w-44" />
        <Skeleton className="h-3 w-52" />
      </div>

      {/* 3-cell stat strip */}
      <div className="grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-background px-4 py-4 space-y-1.5">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      {/* Deals that swing it rows */}
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-32" />
        <div className="divide-y divide-border/60">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start justify-between gap-4 py-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <div className="text-right space-y-1.5">
                <Skeleton className="h-5 w-20 ml-auto" />
                <Skeleton className="h-3 w-28 ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
