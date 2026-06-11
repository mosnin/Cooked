import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { findEmailConnection } from '@/lib/communication/connect';
import { EmailReadView } from './email-read-view';
import { PAGE_RHYTHM } from '@/lib/typography';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Email — ${slug}` };
}

/**
 * /s/[slug]/email/[id] — full-page email read.
 *
 * The read is the page, not a Dialog. Subject becomes the page's serif h1.
 * Reply / Star / Open in Gmail / Back to inbox are the affordances; that's
 * it. No tabbed sub-views, no preview pane.
 *
 * Server pass: bail-out if there's no email connection. Message fetch
 * happens client-side via /api/email/[id] to keep the server render cheap
 * even when Gmail is slow.
 */
export default async function EmailReadPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const conn = await findEmailConnection(space.id);

  return (
    <div className={PAGE_RHYTHM}>
      <EmailReadView slug={slug} messageId={id} connected={Boolean(conn)} />
    </div>
  );
}
