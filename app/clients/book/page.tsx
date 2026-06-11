import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getClientUser } from '@/lib/client-auth';
import { getClientPortalData } from '@/lib/client-portal-data';
import { TITLE_FONT } from '@/lib/typography';
import { PortalEmptyState } from '../portal-ui';
import { BookTourForm } from './book-form';

export const dynamic = 'force-dynamic';

export default async function BookTourPage() {
  const user = await getClientUser();
  if (!user) redirect('/clients/login');
  if (!user.emailVerifiedAt) redirect('/clients/verify');

  const { applications, tours } = await getClientPortalData(user.email);

  // Realtors the client is already engaged with (from applications + tours).
  // Booking with a stranger isn't a portal flow — the public /book/[slug] page
  // covers that. Here we only offer agents the client already has a thread with.
  const bySlug = new Map<string, string>();
  for (const a of applications) {
    if (a.realtorSlug) bySlug.set(a.realtorSlug, a.realtorName ?? a.realtorSlug);
  }
  for (const t of tours) {
    if (t.realtorSlug) bySlug.set(t.realtorSlug, t.realtorName ?? t.realtorSlug);
  }
  const realtors = Array.from(bySlug.entries()).map(([slug, name]) => ({ slug, name }));

  return (
    <main className="mx-auto max-w-3xl space-y-12 px-4 py-10 pb-16 sm:px-6">
      <header className="space-y-3">
        <Link
          href="/clients/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={13} />
          Back to your portal
        </Link>
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Book a tour.</p>
          <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
            Pick a time to see a place.
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose your agent, a date, and what you&apos;d like to see.
          </p>
        </div>
      </header>

      {realtors.length === 0 ? (
        <PortalEmptyState
          headline="No agents to book with yet."
          whatsNext="Once you've applied or toured with an agent, you can book more tours here."
        />
      ) : (
        <BookTourForm
          realtors={realtors}
          guestName={user.name ?? ''}
          guestEmail={user.email}
          guestPhone={user.phone ?? ''}
        />
      )}
    </main>
  );
}
