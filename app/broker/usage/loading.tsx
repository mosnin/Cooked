import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerUsageLoading() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-24 animate-pulse">
      {/* Status-sentence header */}
      <header className="space-y-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-72" />
      </header>

      {/* 3-cell totals strip */}
      <div className="grid grid-cols-3 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-background px-4 py-4 space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      {/* By-realtor section */}
      <div className="space-y-3">
        <Skeleton className="h-3.5 w-16" />
        {/* Column header bar */}
        <div className="flex items-center gap-6 px-1 pb-1">
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
        <div className="divide-y divide-border/60">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 items-center py-3 px-1">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="h-3.5 w-10" />
            </div>
          ))}
        </div>
      </div>

      {/* By-provider section */}
      <div className="space-y-3 border-t border-border/60 pt-5">
        <Skeleton className="h-3.5 w-20" />
        <div className="divide-y divide-border/60">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-3 px-1">
              <Skeleton className="h-3.5 w-28" />
              <div className="flex items-center gap-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3.5 w-14" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
