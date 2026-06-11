import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getClientUser } from '@/lib/client-auth';
import { clientOwnsContact, getClientPortalData } from '@/lib/client-portal-data';
import { supabase } from '@/lib/supabase';
import { TITLE_FONT } from '@/lib/typography';
import { StatusPill, formatDate } from '../../portal-ui';
import { ApplicationDetailClient } from './detail-client';

export const dynamic = 'force-dynamic';

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const user = await getClientUser();
  if (!user) redirect('/clients/login');
  if (!user.emailVerifiedAt) redirect('/clients/verify');

  const { contactId } = await params;
  if (!(await clientOwnsContact(user.email, contactId))) notFound();

  // Pull this application from the aggregated portal data (already scoped to
  // the verified email) so the header reuses the same shape as the dashboard.
  const { applications } = await getClientPortalData(user.email);
  const app = applications.find((a) => a.contactId === contactId);
  if (!app) notFound();

  // Initial server-rendered payloads (the client component re-fetches on
  // actions but we render the first frame here for a calm, instant load).
  const [{ data: messages }, { data: documents }, { data: requests }] = await Promise.all([
    supabase
      .from('ClientMessage')
      .select('id, senderType, body, createdAt')
      .eq('contactId', contactId)
      .order('createdAt', { ascending: true }),
    supabase
      .from('ClientDocument')
      .select('id, fileName, contentType, sizeBytes, uploadedBy, createdAt')
      .eq('contactId', contactId)
      .order('createdAt', { ascending: false }),
    supabase
      .from('ClientInfoRequest')
      .select('id, message, status, response, createdAt, fulfilledAt')
      .eq('contactId', contactId)
      .neq('status', 'dismissed')
      .order('createdAt', { ascending: false }),
  ]);

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
          <p className="text-sm text-muted-foreground">Application.</p>
          <h1 className="text-3xl tracking-tight text-foreground" style={TITLE_FONT}>
            {app.realtorName ?? 'Your application'}
          </h1>
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusPill status={app.status} />
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {app.applicationRef ? `${app.applicationRef} · ` : ''}applied{' '}
              {formatDate(app.createdAt)}
            </span>
          </div>
        </div>
        {app.statusNote && (
          <div className="rounded-xl border border-border/70 bg-card px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Note from your agent
            </p>
            <p className="mt-1 text-sm text-foreground">{app.statusNote}</p>
          </div>
        )}
      </header>

      <ApplicationDetailClient
        contactId={contactId}
        initialMessages={messages ?? []}
        initialDocuments={documents ?? []}
        initialRequests={requests ?? []}
      />
    </main>
  );
}
