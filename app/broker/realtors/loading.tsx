import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerRealtorsLoading() {
  return (
    <div className="space-y-6 max-w-3xl pb-24 animate-pulse">
      {/* Status-sentence header */}
      <header className="space-y-1.5">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </header>

      {/* Realtor rows with avatar + health pill */}
      <ul className="divide-y divide-border/60">
        {Array.from({ length: 5 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-24 rounded-full flex-shrink-0 hidden sm:block" />
            <Skeleton className="h-5 w-16 rounded-full flex-shrink-0 hidden md:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
