/**
 * loading.tsx — shown by Next.js App Router while admin/page.tsx streams.
 * Fixes DOET check 5 (Feedback): prevents a blank screen during slow DB queries.
 * Paper-flat skeleton — matches the hairline grid + section rhythm of the page.
 */

export default function AdminOverviewLoading() {
  return (
    <div className="space-y-12 pb-12 animate-pulse">
      {/* Header skeleton */}
      <header className="space-y-2">
        <div className="h-3 w-16 rounded bg-muted" />
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-3 w-64 rounded bg-muted" />
      </header>

      {/* 8-cell hairline grid skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-background px-4 py-4 sm:px-5 sm:py-5 space-y-2">
            <div className="h-2.5 w-20 rounded bg-muted" />
            <div className="h-7 w-16 rounded bg-muted" />
            <div className="h-2.5 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* At-risk section skeleton */}
      <div className="space-y-4">
        <div className="h-2.5 w-12 rounded bg-muted" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
              <div className="h-3 w-32 rounded bg-muted" />
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-9 rounded bg-muted/50" />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Growth section skeleton */}
      <div className="space-y-4">
        <div className="h-2.5 w-14 rounded bg-muted" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-border/70 bg-card p-5 space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            <div className="h-3 w-40 rounded bg-muted" />
            <div className="h-32 w-full rounded bg-muted/40" />
          </div>
          <div className="rounded-xl border border-border/70 bg-card p-5 space-y-4">
            <div className="h-4 w-32 rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-2.5 w-full rounded bg-muted" />
                <div className="h-1.5 w-full rounded-full bg-muted/50" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
