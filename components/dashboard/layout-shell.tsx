'use client';

import { usePathname } from 'next/navigation';
import { PageTransition } from '@/components/motion/page-transition';
import { SupabaseRealtimeBridge } from '@/components/dashboard/supabase-realtime-bridge';
import { PAGE_MAX } from '@/lib/geometry';
import { cn } from '@/lib/utils';

interface LayoutShellProps {
  slug: string;
  children: React.ReactNode;
  liveNotifications: React.ReactNode;
}

/**
 * Client component so usePathname() always reflects the actual current route —
 * never stale from the Next.js router cache, which was the root cause of the
 * padding bug when navigating from /chippi to any dashboard page.
 */
export function LayoutShell({ slug, children, liveNotifications }: LayoutShellProps) {
  const pathname = usePathname() ?? '';
  const isChippiRoute = pathname.startsWith(`/s/${slug}/chippi`);

  if (isChippiRoute) {
    return (
      <main className="flex-1 min-h-0 flex flex-col bg-background text-foreground pb-[env(safe-area-inset-bottom)] md:pb-0">
        <SupabaseRealtimeBridge />
        {liveNotifications}
        <PageTransition className="flex-1 min-h-0 flex flex-col">{children}</PageTransition>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto flex flex-col bg-background text-foreground">
      {/* The ChippiBar overlays the bottom 80-100px of the viewport; pb-28
          on the content gives it just enough clearance without padding the
          page out to 160px. */}
      <div className={cn('dashboard-content w-full', PAGE_MAX, 'mx-auto min-w-0 px-4 sm:px-6 md:px-10 lg:px-12 py-5 md:py-7 pb-28')}>
        <SupabaseRealtimeBridge />
        {liveNotifications}
        <PageTransition>{children}</PageTransition>
      </div>
    </main>
  );
}
