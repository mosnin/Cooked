import { notFound } from 'next/navigation';
import type { Viewport } from 'next';
import { supabase } from '@/lib/supabase';
import { getSignedDownloadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { DemoManageClient } from './demo-manage-client';
import { PublicPageMinimalShell } from '@/components/public-page-shell';

async function resolveStoredPhoto(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return await getSignedDownloadUrl(value, 60 * 60 * 24);
  } catch (err) {
    logger.warn('[demo/[token]] signed url failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** viewport-fit=cover so the demo page sits flush under the iOS notch,
 *  matching the public profile + intake form treatment. No body-coloured
 *  strip above whatever the shell renders at the top. Non-iOS ignores. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function DemoManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const { data: demo } = await supabase
    .from('Demo')
    .select('id, guestName, guestEmail, propertyAddress, startsAt, endsAt, status, spaceId')
    .eq('manageToken', token)
    .maybeSingle();

  if (!demo) notFound();

  const [{ data: settings }, { data: space }, { data: profileRow }] = await Promise.all([
    supabase
      .from('SpaceSetting')
      .select('businessName, logoUrl, repPhotoUrl')
      .eq('spaceId', demo.spaceId)
      .maybeSingle(),
    supabase
      .from('Space')
      .select('name, slug, ownerId')
      .eq('id', demo.spaceId)
      .maybeSingle(),
    supabase
      .from('ProfilePage')
      .select('coverPhotoUrl, profilePhotoUrl')
      .eq('spaceId', demo.spaceId)
      .maybeSingle(),
  ]);

  const businessName = settings?.businessName || space?.name || 'the property';
  const [coverPhotoUrl, agentPhoto] = await Promise.all([
    resolveStoredPhoto(
      (profileRow as { coverPhotoUrl?: string | null } | null)?.coverPhotoUrl ?? null,
    ),
    resolveStoredPhoto(
      (profileRow as { profilePhotoUrl?: string | null } | null)?.profilePhotoUrl ??
        settings?.repPhotoUrl ??
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
      <DemoManageClient
        demo={{
          id: demo.id,
          guestName: demo.guestName,
          guestEmail: demo.guestEmail,
          propertyAddress: demo.propertyAddress,
          startsAt: demo.startsAt,
          endsAt: demo.endsAt,
          status: demo.status,
        }}
        token={token}
        businessName={businessName}
        bookingSlug={space?.slug || ''}
        profileHref={space?.slug ? `/p/${space.slug}` : null}
      />
    </PublicPageMinimalShell>
  );
}
