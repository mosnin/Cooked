import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { findWhatsAppConnection } from '@/lib/communication/connect';
import { WhatsAppThreadView } from './whatsapp-thread-view';
import { PAGE_RHYTHM } from '@/lib/typography';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `WhatsApp — ${slug}` };
}

/**
 * /s/[slug]/whatsapp/[id] — full conversation page.
 *
 * Messages oldest-to-newest. Sticky send footer. Enter sends, Shift+Enter
 * makes a newline.
 */
export default async function WhatsAppThreadPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const conn = await findWhatsAppConnection(space.id);

  return (
    <div className={PAGE_RHYTHM}>
      <WhatsAppThreadView
        slug={slug}
        conversationId={id}
        connected={Boolean(conn)}
      />
    </div>
  );
}
