import { notFound } from 'next/navigation';
import type { Viewport } from 'next';
import { supabase } from '@/lib/supabase';
import { getSignedDownloadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { TourManageClient } from './tour-manage-client';
import { PublicPageMinimalShell } from '@/components/public-page-shell';

async function resolveStoredPhoto(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return await getSignedDownloadUrl(value, 60 * 60 * 24);
  } catch (err) {
    logger.warn('[tour/[token]] signed url failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** viewport-fit=cover so the tour page sits flush under the iOS notch,
 *  matching the public profile + intake form treatment. No body-coloured
 *  strip above whatever the shell renders at the top. Non-iOS ignores. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function TourManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: tour } = await supabase
    .from('Tour')
    .select('id, guestName, guestEmail, propertyAddress, startsAt, endsAt, status, spaceId')
    .eq('manageToken', token)
    .maybeSingle();

  if (!tour) notFound();

  const [{ data: settings }, { data: space }, { data: profileRow }] = await Promise.all([
    supabase
      .from('SpaceSetting')
      .select('businessName, logoUrl, realtorPhotoUrl')
      .eq('spaceId', tour.spaceId)
      .maybeSingle(),
    supabase
      .from('Space')
      .select('name, slug, ownerId')
      .eq('id', tour.spaceId)
      .maybeSingle(),
    supabase
      .from('ProfilePage')
      .select('coverPhotoUrl, profilePhotoUrl')
      .eq('spaceId', tour.spaceId)
      .maybeSingle(),
  ]);

  const businessName = settings?.businessName || space?.name || 'the property';
  const [coverPhotoUrl, agentPhoto] = await Promise.all([
    resolveStoredPhoto(
      (profileRow as { coverPhotoUrl?: string | null } | null)?.coverPhotoUrl ?? null,
    ),
    resolveStoredPhoto(
      (profileRow as { profilePhotoUrl?: string | null } | null)?.profilePhotoUrl ??
        settings?.realtorPhotoUrl ??
        null,
    ),
  ]);

  return (
    <PublicPageMinimalShell
      logoUrl={settings?.logoUrl}
      businessName={businessName}
      coverPhotoUrl={coverPhotoUrl}
      agentPhoto={agentPhoto}
    >
      <TourManageClient
        tour={{
          id: tour.id,
          guestName: tour.guestName,
          guestEmail: tour.guestEmail,
          propertyAddress: tour.propertyAddress,
          startsAt: tour.startsAt,
          endsAt: tour.endsAt,
          status: tour.status,
        }}
        token={token}
        businessName={businessName}
        bookingSlug={space?.slug || ''}
        profileHref={space?.slug ? `/p/${space.slug}` : null}
      />
    </PublicPageMinimalShell>
  );
}
