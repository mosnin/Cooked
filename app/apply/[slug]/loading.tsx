/**
 * Loading skeleton for /apply/[slug].
 *
 * Mirrors the redesigned IntakeChatShell's silhouette: centered hero
 * (avatar + serif business-name slug), slim progress bar, then a focal
 * question-shaped block. No purple gradients, no generic placeholders —
 * the skeleton honors the same neutral, paper-flat vocabulary the real
 * surface uses so the transition feels like the same product, not two.
 */
export default function ApplyLoading() {
  return (
    <div className="relative h-dvh min-h-[600px] flex flex-col text-foreground overflow-hidden bg-background">
      {/* Paper texture (same as the shell) */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none opacity-[0.035] dark:opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Hero skeleton */}
      <header className="flex-shrink-0 w-full bg-background/80 border-b border-border/40">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-5 sm:pt-6 pb-4 sm:pb-5">
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-full bg-muted/70 animate-pulse border-4 border-background" />
            <div className="mt-3 sm:mt-4 space-y-1.5">
              <div className="h-6 sm:h-7 w-40 rounded bg-muted/70 animate-pulse mx-auto" />
              <div className="h-3 w-24 rounded bg-muted/50 animate-pulse mx-auto" />
            </div>
          </div>
        </div>
      </header>

      {/* Body skeleton */}
      <main className="flex-1 w-full min-h-0">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8 pb-12 space-y-8">
          {/* Progress bar */}
          <div className="flex items-center gap-1 -mt-2">
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} className="h-[3px] flex-1 rounded-full bg-foreground/[0.08]" />
            ))}
          </div>

          {/* Active question skeleton */}
          <div className="space-y-5">
            <div className="space-y-2 max-w-md">
              <div className="h-7 w-full rounded bg-muted/70 animate-pulse" />
              <div className="h-7 w-2/3 rounded bg-muted/70 animate-pulse" />
            </div>
            <div className="flex gap-2.5 max-w-md">
              <div className="h-11 w-32 rounded-xl bg-muted/50 animate-pulse" />
              <div className="h-11 w-32 rounded-xl bg-muted/50 animate-pulse" />
            </div>
          </div>
        </div>
      </main>

      {/* Footer skeleton */}
      <footer className="flex-shrink-0 w-full bg-background/70 border-t border-border/40">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 py-3 sm:py-4 flex items-center justify-between">
          <div className="h-3 w-32 rounded bg-muted/50 animate-pulse" />
          <div className="h-3 w-20 rounded bg-muted/50 animate-pulse" />
        </div>
      </footer>
    </div>
  );
}
