import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerDealsLoading() {
  return (
    <div className="space-y-5 max-w-[1500px] mx-auto pb-12 animate-pulse">
      {/* Status-sentence header */}
      <header className="space-y-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-4 w-72" />
      </header>

      {/* Kanban columns */}
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-72 flex-shrink-0 space-y-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
