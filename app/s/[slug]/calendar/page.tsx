import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { findCalendarConnection } from '@/lib/calendar/mirror';
import { CalendarView } from './calendar-view';
import { PAGE_RHYTHM } from '@/lib/typography';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return { title: `Calendar — ${slug}` };
}

/**
 * /s/[slug]/calendar — thin mirror of the realtor's connected external
 * calendar.
 *
 * Chippi doesn't own a calendar anymore. The realtor lives in Google
 * Calendar (or Outlook); this surface reads from there on demand and
 * renders it inline. Events Chippi creates (tour bookings, callbacks)
 * write THROUGH to the same calendar so the source of truth stays
 * single.
 *
 * Server pass: figure out whether anything's connected so the page can
 * render the right shape with no flash. Event fetching happens
 * client-side via /api/calendar/events to keep this server render
 * cheap (the page should paint immediately even if Google is slow).
 */
export default async function CalendarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const connection = await findCalendarConnection(space.id);

  return (
    <div className={PAGE_RHYTHM}>
      <CalendarView
        slug={slug}
        initialConnected={Boolean(connection)}
        initialProvider={connection?.toolkit ?? null}
      />
    </div>
  );
}
