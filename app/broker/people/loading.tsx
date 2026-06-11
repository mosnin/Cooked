import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerPeopleLoading() {
  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-12 animate-pulse">
      {/* Header + search bar row */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Search + filter row */}
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-24 rounded-lg" />
      </div>

      {/* Divide-y contact rows */}
      <div className="divide-y divide-border/60">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 py-3">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full hidden sm:block" />
            <Skeleton className="h-5 w-16 rounded-full hidden md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
