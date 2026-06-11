/**
 * /koala/full-day — alias for /koala/today.
 *
 * The user audit flagged that "full day" is the natural verb the rep
 * (and Koala) reach for, while the actual page lives at /koala/today.
 * One permanent server redirect keeps both addresses pointing at one
 * surface — no duplicate code, no drift.
 */

import { redirect } from 'next/navigation';

export default async function KoalaFullDayAlias({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/s/${slug}/koala/today`);
}
