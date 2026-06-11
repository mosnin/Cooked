import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';

export const metadata: Metadata = {
  title: 'Your portal · Chippi',
  description: 'Track your application, book tours, and message your agent.',
};

/**
 * Client-portal layout — a fully separate end-user surface. No ClerkProvider,
 * no realtor nav. Middleware already carves /clients out of Clerk; each page
 * enforces its own session via getClientUser(). The chrome is deliberately
 * quiet: a hairline header with the Chippi mark and a single back-to-marketing
 * link, nothing else competing with the work below it.
 */
export default function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/clients" className="flex items-center gap-2" aria-label="Chippi portal">
            <BrandLogo className="h-5" />
          </Link>
          <a
            href="https://usechippi.com"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            About Chippi
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
