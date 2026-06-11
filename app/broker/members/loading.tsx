import { Skeleton } from '@/components/ui/skeleton';

export default function BrokerMembersLoading() {
  return (
    <div className="space-y-6 max-w-3xl pb-56 md:pb-24">
      <header className="space-y-1.5">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-72" />
      </header>
      <Skeleton className="h-9 w-64" />
      <ul className="divide-y divide-border/60">
        {[1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="flex items-center gap-3 py-3">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
