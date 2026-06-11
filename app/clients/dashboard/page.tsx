import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronRight, FileText, CalendarCheck } from 'lucide-react';
import { getClientUser } from '@/lib/client-auth';
import { getClientPortalData } from '@/lib/client-portal-data';
import { TITLE_FONT } from '@/lib/typography';
import { LogoutButton } from '../portal-actions';
import {
  StatusPill,
  PortalEmptyState,
  formatTourDate,
  formatDate,
} from '../portal-ui';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getClientUser();
  if (!user) redirect('/clients/login');
  if (!user.emailVerifiedAt) redirect('/clients/verify');

  const { applications, tours } = await getClientPortalData(user.email);

  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || null;
  const total = applications.length + tours.length;
  const statusSentence =
    total === 0
      ? 'nothing in flight yet — it lands here the moment you apply or book.'
      : `${applications.length} application${applications.length === 1 ? '' : 's'} and ${tours.length} tour${
          tours.length === 1 ? '' : 's'
        } in motion.`;

  return (
    <main className="mx-auto max-w-3xl space-y-12 px-4 py-10 pb-16 sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Your portal.</p>
          <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
            {firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}
          </h1>
          <p className="text-sm text-muted-foreground">{statusSentence}</p>
        </div>
        <LogoutButton />
      </header>

      {total === 0 && (
        <PortalEmptyState
          headline="Nothing here yet."
          whatsNext="Apply or book a tour with a realtor using this email and it shows up here."
        />
      )}

      {/* Applications */}
      {applications.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Applications
          </h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
            {applications.map((app) => (
              <li key={app.contactId}>
                <Link
                  href={`/clients/applications/${app.contactId}`}
                  className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-foreground/[0.04]"
                >
                  <FileText size={15} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {app.realtorName ?? 'Your application'}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {app.applicationRef ? `${app.applicationRef} · ` : ''}
                      applied {formatDate(app.createdAt)}
                    </p>
                  </div>
                  <StatusPill status={app.status} />
                  <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tours */}
      {tours.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Tours
          </h2>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
            {tours.map((tour) => (
              <li key={tour.id} className="flex items-center gap-3 px-4 py-3.5">
                <CalendarCheck size={15} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground tabular-nums">
                    {formatTourDate(tour.startsAt)}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {tour.propertyAddress ?? 'Address to be shared'}
                    {tour.realtorName ? ` · ${tour.realtorName}` : ''}
                  </p>
                </div>
                {tour.status && <StatusPill status={tour.status} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Book another tour — quiet entry point for engaged clients */}
      {applications.length > 0 && (
        <div>
          <Link
            href="/clients/book"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
          >
            <CalendarCheck size={14} />
            Book a tour
          </Link>
        </div>
      )}
    </main>
  );
}
