import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerIntegrationsLoading() {
  return (
    <div className="space-y-6 max-w-prose pb-24 animate-pulse">
      {/* Status-sentence header */}
      <header className="space-y-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-72" />
      </header>

      {/* Integration card rows */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-xl border border-border/60 bg-background px-4 py-4"
          >
            <Skeleton className="h-9 w-9 rounded-lg flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-52" />
            </div>
            <Skeleton className="h-8 w-20 rounded-lg flex-shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
