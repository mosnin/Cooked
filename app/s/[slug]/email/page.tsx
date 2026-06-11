import { redirect } from 'next/navigation';

/**
 * /s/[slug]/email — legacy direct URL.
 *
 * The unified Communication surface now owns the inbox view at
 * /s/[slug]/communication?tab=email. This route keeps deep-link
 * compatibility (old bookmarks, /email/[id] back-links) by redirecting
 * to the Email tab of Communication.
 *
 * /s/[slug]/email/[id] (full-page email read) stays — it's the deep link
 * from the inbox rows and isn't part of the toggle.
 */
export default async function EmailRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/s/${slug}/communication?tab=email`);
}
