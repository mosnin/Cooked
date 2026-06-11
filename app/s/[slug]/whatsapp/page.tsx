import { redirect } from 'next/navigation';

/**
 * /s/[slug]/whatsapp — legacy direct URL.
 *
 * The unified Communication surface now owns the messages list view at
 * /s/[slug]/communication?tab=messages. This route keeps deep-link
 * compatibility (old bookmarks, /whatsapp/[id] back-links) by redirecting
 * to the Messages tab of Communication.
 *
 * /s/[slug]/whatsapp/[id] (full-page thread) stays — it's the deep link
 * from the conversation rows and isn't part of the toggle.
 */
export default async function WhatsAppRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/s/${slug}/communication?tab=messages`);
}
