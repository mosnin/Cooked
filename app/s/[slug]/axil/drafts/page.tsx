/**
 * /axil/drafts — kept alive as a redirect to /axil/inbox so live
 * bookmarks and link shares don't 404. Drafts and Approvals merged
 * into the unified Inbox surface. See app/s/[slug]/axil/inbox/page.tsx.
 *
 * Auth still runs so an unauthed hit can't bounce off as an open redirect.
 */

import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';

export const dynamic = 'force-dynamic';

export default async function AxilDraftsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { userId } = await auth();
  if (!userId) redirect('/login/rep');

  redirect(`/s/${slug}/axil/inbox`);
}
