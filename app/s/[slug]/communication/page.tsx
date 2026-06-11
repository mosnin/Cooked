import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import {
  findEmailConnection,
  findWhatsAppConnection,
} from '@/lib/communication/connect';
import { CommunicationView } from './communication-view';
import { PAGE_RHYTHM } from '@/lib/typography';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Communication — ${slug}` };
}

/**
 * /s/[slug]/communication — the realtor's email + messages, toggled.
 *
 * PR #161 shipped a unified inbox feed; PR #165 split into two sidebar
 * items (one for email, one for WhatsApp). The realtor's read was that
 * two competing sidebar items felt like Chippi crammed messages under
 * email. The compromise — and the right one — is one sidebar entry with
 * a segmented toggle (Email · Messages) inside this page.
 *
 * Server pass figures out which channels are connected so the page paints
 * the right shape with no flash. Feed / list fetching is client-side
 * inside the per-channel views.
 */
export default async function CommunicationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { slug } = await params;
  const { tab } = await searchParams;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const [emailConn, waConn] = await Promise.all([
    findEmailConnection(space.id),
    findWhatsAppConnection(space.id),
  ]);

  const initialTab: 'email' | 'messages' = tab === 'messages' ? 'messages' : 'email';

  return (
    <div className={PAGE_RHYTHM}>
      <CommunicationView
        slug={slug}
        initialTab={initialTab}
        emailConnected={Boolean(emailConn)}
        emailProvider={emailConn?.toolkit ?? null}
        messagesConnected={Boolean(waConn)}
      />
    </div>
  );
}
