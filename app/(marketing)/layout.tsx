/**
 * Marketing route group layout.
 *
 * Every page under `app/(marketing)/` renders inside this shell — nav at
 * top, footer at bottom, content fills the middle. The dashboard chrome
 * (Sidebar, Header) is NOT mounted here.
 *
 * The marketing site is public — we don't load Clerk for unauth visitors.
 * Auth-aware pages (the homepage redirects auth users to their workspace)
 * still call `auth()` from their own server component before rendering.
 */

import { FortitudoNav } from '@/components/marketing/fortitudo/nav';
import { FortitudoFooter } from '@/components/marketing/fortitudo/footer';
import { ScrollProgress } from '@/components/marketing/fortitudo/scroll-progress';
import { FprScript } from '@/components/affiliate/fpr-script';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* FirstPromoter click tracking — sets _fprom_tid cookie from ?fpr= links */}
      <FprScript />
      {/* fortitudo "studio ASCII" chrome: thin scroll bar, floating pill nav,
          inset charcoal footer. Every logged-out page inherits the look. */}
      <ScrollProgress />
      <FortitudoNav />
      <main className="flex-1">{children}</main>
      <FortitudoFooter />
    </div>
  );
}
