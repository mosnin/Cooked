/**
 * Public realtor page — the "link in bio" surface at /p/[slug].
 *
 * No auth (same pattern as /apply/[slug] and /book/[slug]): resolve the
 * Space by slug, read branding from SpaceSetting, the page config from
 * ProfilePage, and — when enabled — the space's active listings. The
 * render lives in <PublicProfile/>.
 */

import type { Viewport } from 'next';
import { notFound } from 'next/navigation';
import { getSpaceFromSlug } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { getSignedDownloadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { PublicProfile, type PublicProperty } from '@/components/profile-page/public-profile';

/** viewport-fit=cover lets the page draw under the iOS notch / status-bar area
 *  instead of leaving a body-coloured strip above it. On the /p/[slug] page
 *  the cover photo is the first DOM element, so with this set the photo is
 *  truly flush with the top of the viewport on iOS — no white gap above it.
 *  Non-iOS browsers ignore this; it's a free fix everywhere else. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/** Cover photo & realtor photo are stored as object KEYS in our buckets
 *  (the bucket isn't anonymously readable). Sign a 24h URL for render —
 *  the page revalidates every 60s so freshness is fine. Legacy values
 *  that start with `http(s)://` are URLs already; pass through verbatim.
 */
async function resolveStoredPhoto(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value; // legacy URL, render as-is
  try {
    return await getSignedDownloadUrl(value, 60 * 60 * 24);
  } catch (err) {
    logger.warn('[p/[slug]] signed url failed', {
      keyPreview: value.slice(0, 60),
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Try Clerk's stored imageUrl as a last-resort fallback for the realtor's
 *  face. Returns null on any failure — the page just falls through to the
 *  generic avatar. Server-side fetch by clerkId; no auth required for
 *  reading another user's public profile fields.
 */
async function clerkImageUrlFor(clerkId: string | null | undefined): Promise<string | null> {
  if (!clerkId) return null;
  try {
    const { clerkClient } = await import('@clerk/nextjs/server');
    const client = await clerkClient();
    const user = await client.users.getUser(clerkId);
    return user?.imageUrl || null;
  } catch (err) {
    logger.warn('[p/[slug]] clerk lookup failed', {
      clerkIdPreview: clerkId.slice(0, 12),
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export const revalidate = 60;

interface ProfileConfig {
  enabled: boolean;
  headline: string | null;
  showIntake: boolean;
  showTours: boolean;
  showProperties: boolean;
  customLinks: Array<{ id: string; label: string; url: string; thumbnail?: string }>;
  videos: Array<{ id: string; url: string; title?: string }>;
  coverPhotoUrl: string | null;
  profilePhotoUrl: string | null;
  /** Realtor-curated featured listings, in render order. Empty array falls
   *  back to the legacy auto-top-6-recent logic. */
  featuredPropertyIds: string[];
}

const DEFAULT_CONFIG: ProfileConfig = {
  enabled: true,
  headline: null,
  showIntake: true,
  showTours: true,
  showProperties: true,
  customLinks: [],
  videos: [],
  coverPhotoUrl: null,
  profilePhotoUrl: null,
  featuredPropertyIds: [],
};

export default async function PublicRealtorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const space = await getSpaceFromSlug(slug);
  if (!space) notFound();

  const [{ data: settings }, { data: owner }, { data: profileRow }] = await Promise.all([
    supabase
      .from('SpaceSetting')
      .select(
        'businessName, logoUrl, realtorPhotoUrl, bio, socialLinks, intakeAccentColor, intakeDarkMode, isVerified',
      )
      .eq('spaceId', space.id)
      .maybeSingle(),
    // clerkId added so we can fall back to the realtor's Clerk imageUrl when
    // neither realtorPhotoUrl nor avatar is set (covers the common case
    // where the realtor uploaded a photo to Clerk but never to Settings).
    supabase.from('User').select('name, avatar, clerkId').eq('id', space.ownerId).maybeSingle(),
    supabase
      .from('ProfilePage')
      .select(
        'enabled, headline, showIntake, showTours, showProperties, customLinks, videos, coverPhotoUrl, profilePhotoUrl, featuredPropertyIds',
      )
      .eq('spaceId', space.id)
      .maybeSingle(),
  ]);

  // No row yet = sensible defaults (the page works before the realtor edits
  // it). enabled === false means they've explicitly unpublished it.
  const cfg: ProfileConfig = { ...DEFAULT_CONFIG, ...((profileRow ?? {}) as Partial<ProfileConfig>) };
  if (cfg.enabled === false) notFound();

  let properties: PublicProperty[] = [];
  if (cfg.showProperties) {
    const featuredIds = Array.isArray(cfg.featuredPropertyIds)
      ? cfg.featuredPropertyIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];

    if (featuredIds.length > 0) {
      // Realtor-curated set. Postgres `.in()` doesn't preserve order — fetch
      // the rows then reorder in JS to match the realtor's chosen sequence.
      // Stale ids (deleted listings, listings flipped off `active`) silently
      // drop out — same forgiving contract as the PATCH validator.
      const { data } = await supabase
        .from('Property')
        .select('id, address, city, stateRegion, listPrice, photos, listingUrl')
        .eq('spaceId', space.id)
        .eq('listingStatus', 'active')
        .in('id', featuredIds);
      const byId = new Map((data ?? []).map((p) => [p.id, p as PublicProperty]));
      properties = featuredIds
        .map((id) => byId.get(id))
        .filter((p): p is PublicProperty => Boolean(p));
    } else {
      // Legacy fallback: the realtor hasn't curated yet, so show the six
      // most-recently-updated active listings. Same query as before this
      // feature shipped — no behaviour change for un-curated pages.
      const { data } = await supabase
        .from('Property')
        .select('id, address, city, stateRegion, listPrice, photos, listingUrl')
        .eq('spaceId', space.id)
        .eq('listingStatus', 'active')
        .order('updatedAt', { ascending: false })
        .limit(6);
      properties = ((data ?? []) as PublicProperty[]);
    }

    // Sign each property's first photo. Same contract as the cover/agent
    // photos: values are stored as private storage KEYS (the Wasabi bucket
    // isn't anonymously readable, so even a `getPublicUrl()` link 403s).
    // The carousel only reads `photos[0]`, so we rewrite the array to a
    // single-element list holding the signed URL — keeps the type stable
    // and avoids signing photos the UI will never render.
    properties = await Promise.all(
      properties.map(async (p) => {
        const first = Array.isArray(p.photos) ? p.photos[0] : null;
        const signed = await resolveStoredPhoto(first);
        return { ...p, photos: signed ? [signed] : null };
      }),
    );
  }

  const subStatus = space.stripeSubscriptionStatus;
  const hidePoweredBy = subStatus === 'active' || subStatus === 'trialing';

  const businessName = settings?.businessName || space.name;

  // Resolve photo URLs in parallel. Two distinct face slots now:
  //   - profilePhotoUrl on ProfilePage  → public-page-specific portrait the
  //                                        realtor picked deliberately for /p/[slug]
  //   - realtorPhotoUrl on SpaceSetting → the dashboard / intake / booking face
  // Public page prefers the ProfilePage one when set. If unset, fall through
  // to the existing chain (realtorPhotoUrl → User.avatar → Clerk imageUrl)
  // so legacy realtors who haven't picked a separate photo still see something.
  const [coverPhotoUrl, profilePagePhoto, realtorPhotoFromStorage] = await Promise.all([
    resolveStoredPhoto(cfg.coverPhotoUrl),
    resolveStoredPhoto(cfg.profilePhotoUrl),
    resolveStoredPhoto(settings?.realtorPhotoUrl ?? owner?.avatar ?? null),
  ]);
  const agentPhoto =
    profilePagePhoto ??
    realtorPhotoFromStorage ??
    (await clerkImageUrlFor((owner as { clerkId?: string | null } | null)?.clerkId));

  return (
    <PublicProfile
      slug={slug}
      businessName={businessName}
      logoUrl={settings?.logoUrl || null}
      agentName={owner?.name || businessName}
      agentPhoto={agentPhoto}
      bio={settings?.bio || null}
      headline={cfg.headline}
      socialLinks={(settings?.socialLinks as Record<string, string> | null) ?? null}
      accentColor={(settings?.intakeAccentColor as string | null) || '#ff964f'}
      darkMode={settings?.intakeDarkMode === true}
      showIntake={cfg.showIntake !== false}
      showTours={cfg.showTours !== false}
      customLinks={Array.isArray(cfg.customLinks) ? cfg.customLinks : []}
      videos={Array.isArray(cfg.videos) ? cfg.videos : []}
      coverPhotoUrl={coverPhotoUrl}
      isVerified={settings?.isVerified === true}
      properties={properties}
      hidePoweredBy={hidePoweredBy}
    />
  );
}
