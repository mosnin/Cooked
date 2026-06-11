'use client';

import { usePathname } from 'next/navigation';
import { PageTransition } from '@/components/motion/page-transition';
import { PAGE_MAX } from '@/lib/geometry';
import { cn } from '@/lib/utils';

/**
 * The team content shell — the manager mirror of `LayoutShell`.
 *
 * Client component so `usePathname()` decides chat-vs-dashboard reliably. The
 * previous manager layout branched on an `x-pathname` HTTP header, which is not
 * reliably set on Vercel — when it missed, the wrong container rendered and
 * content hugged the screen edge. Using the client pathname eliminates that.
 *
 *   - `/manager` (the Koala chat home) → full-height, no padding box, so the
 *     workspace centers its own `max-w-3xl` column (identical to the rep
 *     `/s/[slug]/axil`).
 *   - every other manager page → the same `dashboard-content` padded, centered
 *     container the rep dashboard uses
 *     (`px-4 sm:px-6 md:px-10 lg:px-12 py-5 md:py-7`), so nothing touches the edge.
 */
export function ManagerMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const isChat = pathname === '/manager';

  if (isChat) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background text-foreground pb-[env(safe-area-inset-bottom)] md:pb-0">
        <PageTransition className="flex-1 min-h-0 flex flex-col">{children}</PageTransition>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto flex flex-col bg-background text-foreground">
      <div className={cn('dashboard-content w-full', PAGE_MAX, 'mx-auto min-w-0 px-4 sm:px-6 md:px-10 lg:px-12 py-5 md:py-7 pb-28')}>
        <PageTransition>{children}</PageTransition>
      </div>
    </main>
  );
}
