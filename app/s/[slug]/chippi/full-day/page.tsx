/**
 * /chippi/full-day — alias for /chippi/today.
 *
 * The user audit flagged that "full day" is the natural verb the realtor
 * (and Chippi) reach for, while the actual page lives at /chippi/today.
 * One permanent server redirect keeps both addresses pointing at one
 * surface — no duplicate code, no drift.
 */

import { redirect } from 'next/navigation';

export default async function ChippiFullDayAlias({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/s/${slug}/chippi/today`);
}
