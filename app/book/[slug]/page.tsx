import { notFound } from 'next/navigation';
import type { Viewport } from 'next';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { getSignedDownloadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { BookingForm } from './booking-form';
import { PublicPageShell } from '@/components/public-page-shell';
import { FormUnavailable } from '@/components/form-unavailable';
import { TrackingPixels } from '@/components/tracking-pixels';
import type { TrackingPixels as TrackingPixelsType } from '@/lib/types';

/** viewport-fit=cover so the booking page draws under the iOS notch the
 *  way the public profile and intake do — one applicant-facing family. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** Stored photos are object KEYs; sign a 24h URL on read. Legacy http(s)
 *  values pass through verbatim. Mirrors /p/[slug] and /apply/[slug]. */
async function resolveStoredPhoto(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return await getSignedDownloadUrl(value, 60 * 60 * 24);
  } catch (err) {
    logger.warn('[book/[slug]] signed url failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const revalidate = 60;

export default async function PublicBookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const [{ data: settingsData }, { data: customSettings }, { data: ownerData }] = await Promise.all([
    supabase
      .from('SpaceSetting')
      .select('tourBookingPageTitle, tourBookingPageIntro, businessName, tourDuration, timezone, logoUrl, realtorPhotoUrl')
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('SpaceSetting')
      .select(
        'intakeAccentColor, intakeFont, intakeDarkMode, ' +
        'intakeHeaderBgColor, intakeHeaderGradient, ' +
        'intakeFooterLinks, bio, socialLinks, trackingPixels'
      )
      .eq('spaceId', space.id)
      .maybeSingle(),
    supabase
      .from('User')
      .select('name, avatar')
      .eq('id', space.ownerId)
      .maybeSingle(),
  ]);

  const allSettings = { ...((settingsData ?? {}) as any), ...((customSettings ?? {}) as any) };
  const settings = allSettings as {
    tourBookingPageTitle: string | null;
    tourBookingPageIntro: string | null;
    businessName: string | null;
    tourDuration: number | null;
    timezone: string | null;
    logoUrl: string | null;
    realtorPhotoUrl: string | null;
    intakeAccentColor: string | null;
    intakeFont: string | null;
    intakeDarkMode: boolean | null;
    intakeHeaderBgColor: string | null;
    intakeHeaderGradient: string | null;
    intakeFooterLinks: { label: string; url: string }[] | null;
    bio: string | null;
    socialLinks: Record<string, string> | null;
    trackingPixels: TrackingPixelsType | null;
  } | null;

  const pageTitle = settings?.tourBookingPageTitle || 'Book a Tour';
  const pageIntro = settings?.tourBookingPageIntro || 'Pick a time that works for you and we\'ll confirm your tour.';
  const businessName = settings?.businessName || space.name;
  const duration = settings?.tourDuration || 30;
  const timezone = settings?.timezone || 'America/New_York';
  const agentName = ownerData?.name || businessName;
  const rawAgentPhoto = settings?.realtorPhotoUrl || ownerData?.avatar || null;
  const logoUrl = settings?.logoUrl || null;

  // Resolve the same identity material as /p/[slug] so the booking page
  // is visually consistent with the rest of the applicant-facing family.
  const { data: profileRow } = await supabase
    .from('ProfilePage')
    .select('coverPhotoUrl, profilePhotoUrl')
    .eq('spaceId', space.id)
    .maybeSingle();
  const [agentPhoto, coverPhotoUrl] = await Promise.all([
    resolveStoredPhoto(
      (profileRow as { profilePhotoUrl?: string | null } | null)?.profilePhotoUrl ?? rawAgentPhoto,
    ),
    resolveStoredPhoto(
      (profileRow as { coverPhotoUrl?: string | null } | null)?.coverPhotoUrl ?? null,
    ),
  ]);

  // Gate on subscription status — only pause forms for explicitly failed billing
  const subStatus = space.stripeSubscriptionStatus;
  const formPaused = subStatus === 'past_due' || subStatus === 'canceled' || subStatus === 'unpaid';
  if (formPaused) {
    return <FormUnavailable agentName={agentName} />;
  }

  // Hide the Chippi mark on paid tiers — visible only on the free tier as
  // a value-exchange brand exposure. The realtor pays for white-label when
  // they're on an active paid plan (or trialing into one).
  const hidePoweredBy = subStatus === 'active' || subStatus === 'trialing';

  const customization = {
    accentColor: settings?.intakeAccentColor || '#ff964f',
    font: settings?.intakeFont || 'system',
    darkMode: settings?.intakeDarkMode || false,
    headerBgColor: settings?.intakeHeaderBgColor || null,
    headerGradient: settings?.intakeHeaderGradient || null,
    footerLinks: settings?.intakeFooterLinks || [],
    bio: settings?.bio || null,
    socialLinks: settings?.socialLinks || null,
  };

  const trackingPixels = settings?.trackingPixels ?? null;

  return (
    <>
      <TrackingPixels pixels={trackingPixels} />
      <PublicPageShell
        logoUrl={logoUrl}
        businessName={businessName}
        agentName={agentName}
        agentPhone={null}
        agentPhoto={agentPhoto}
        pageTitle={pageTitle}
        pageIntro={pageIntro}
        trustLine={`Your information is shared only with ${agentName} and used solely for scheduling.`}
        agentPresenceLabel="Booking with"
        hidePoweredBy={hidePoweredBy}
        customization={customization}
        coverPhotoUrl={coverPhotoUrl}
        profileHref={`/p/${slug}`}
      >
        <BookingForm slug={slug} duration={duration} businessName={businessName} timezone={timezone} accentColor={customization.accentColor} profileHref={`/p/${slug}`} />
      </PublicPageShell>
    </>
  );
}
