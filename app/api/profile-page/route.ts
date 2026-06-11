/**
 * GET   /api/profile-page — the realtor's public-page config (defaults if unset).
 * PATCH /api/profile-page — update enabled / headline / section toggles / links / videos.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { getSignedDownloadUrl } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { parseYouTubeId } from '@/lib/profile-page';
import { SOCIAL_PLATFORMS, type SocialPlatform } from '@/components/profile-page/public-profile';

export const runtime = 'nodejs';

const SELECT =
  'enabled, headline, showIntake, showTours, showProperties, customLinks, videos, coverPhotoUrl, profilePhotoUrl, featuredPropertyIds';

// Brand identity bits (verified badge, social handles) live on SpaceSetting
// rather than ProfilePage because they're inherited across every public
// surface the realtor owns — the public page, the application, the booking
// page all read these. The PATCH below threads them through.
const SETTINGS_SELECT = 'isVerified, socialLinks';

// The picker only needs to render — full property pages live elsewhere.
// We cap the list at 50 so the editor stays snappy; if a realtor truly has
// more, the picker isn't the right tool for the long tail.
const AVAILABLE_PROPERTIES_CAP = 50;

// Cap the realtor's curated set at 12 — enough for a carousel without
// drowning the page. Matches the editor's own UI cap.
const FEATURED_CAP = 12;

const DEFAULTS = {
  enabled: true,
  headline: null as string | null,
  showIntake: true,
  showTours: true,
  showProperties: true,
  customLinks: [] as Array<{ id: string; label: string; url: string; thumbnail: string }>,
  videos: [] as Array<{ id: string; url: string; title: string }>,
  coverPhotoUrl: null as string | null,
  profilePhotoUrl: null as string | null,
  featuredPropertyIds: [] as string[],
  isVerified: false,
  socialLinks: {} as Partial<Record<SocialPlatform, string>>,
};

interface AvailableProperty {
  id: string;
  address: string;
  city: string | null;
  stateRegion: string | null;
  listPrice: number | null;
  photo: string | null;
}

/** Sign a stored photo KEY for the editor preview (24h TTL — way longer than
 *  the editor's actual session). Legacy `http(s)://` values pass through
 *  verbatim. Returns null on signing failure so the UI shows the empty state
 *  instead of a broken image.
 */
async function signStoredPhoto(value: unknown): Promise<string | null> {
  if (typeof value !== 'string' || !value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return await getSignedDownloadUrl(value, 60 * 60 * 24);
  } catch {
    return null;
  }
}

export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const space = await getSpaceForUser(authResult.userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [{ data }, { data: settingsRow }, { data: propertyRows }] = await Promise.all([
    supabase.from('ProfilePage').select(SELECT).eq('spaceId', space.id).maybeSingle(),
    supabase
      .from('SpaceSetting')
      .select(SETTINGS_SELECT)
      .eq('spaceId', space.id)
      .maybeSingle(),
    // The picker shows every active listing in the space. Capped at 50 —
    // beyond that the realtor isn't picking from a list any more, they're
    // hunting, and that belongs in the listings management surface, not
    // here.
    supabase
      .from('Property')
      .select('id, address, city, stateRegion, listPrice, photos')
      .eq('spaceId', space.id)
      .eq('listingStatus', 'active')
      .order('updatedAt', { ascending: false })
      .limit(AVAILABLE_PROPERTIES_CAP),
  ]);

  // Sanitize socialLinks read from the DB. Older rows may carry arbitrary
  // platform keys (the original shape was Record<string,string>); the
  // editor only edits the closed set, so we drop anything outside it on
  // the way out so the UI's view of the data matches what it can write
  // back.
  const rawSocial = (settingsRow?.socialLinks ?? {}) as Record<string, unknown>;
  const cleanSocial: Partial<Record<SocialPlatform, string>> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const v = rawSocial[platform];
    if (typeof v === 'string' && v.trim()) cleanSocial[platform] = v.trim();
  }

  // coverPhotoUrl is stored as a storage KEY (the bucket isn't anonymously
  // readable, so signing on read is the live contract). Legacy values that
  // start with `http(s)://` are URLs and get passed through. Editor UI
  // displays this value directly, so signing here is the only place that
  // matters for the preview.
  const merged: Record<string, unknown> = {
    ...DEFAULTS,
    ...(data ?? {}),
    isVerified: settingsRow?.isVerified === true,
    socialLinks: cleanSocial,
  };
  // Both photos use the same private-store + sign-on-read contract. Sign
  // both in parallel so the editor preview never sees a raw storage key.
  const [signedCover, signedProfile] = await Promise.all([
    signStoredPhoto(merged.coverPhotoUrl),
    signStoredPhoto(merged.profilePhotoUrl),
  ]);
  merged.coverPhotoUrl = signedCover;
  merged.profilePhotoUrl = signedProfile;

  // Property photos are stored as a JSONB array of URLs (see the Property
  // migration comment). For the picker we only need the first one — the
  // public page's carousel uses the same shape.
  const availableProperties: AvailableProperty[] = ((propertyRows ?? []) as Array<{
    id: string;
    address: string;
    city: string | null;
    stateRegion: string | null;
    listPrice: number | null;
    photos: unknown;
  }>).map((row) => ({
    id: row.id,
    address: row.address,
    city: row.city ?? null,
    stateRegion: row.stateRegion ?? null,
    listPrice: row.listPrice ?? null,
    photo: Array.isArray(row.photos) && typeof row.photos[0] === 'string' ? row.photos[0] : null,
  }));
  merged.availableProperties = availableProperties;

  return NextResponse.json(merged);
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;

  const space = await getSpaceForUser(authResult.userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  for (const key of ['enabled', 'showIntake', 'showTours', 'showProperties'] as const) {
    if (typeof body[key] === 'boolean') patch[key] = body[key];
  }
  if (body.headline === null || typeof body.headline === 'string') {
    patch.headline =
      typeof body.headline === 'string' ? body.headline.trim().slice(0, 200) || null : null;
  }
  if (Array.isArray(body.customLinks)) {
    // Sanitize to [{ id, label, url, thumbnail }] — cap 20, http(s) URLs only.
    // thumbnail is optional and only kept when it's itself an http(s) URL.
    patch.customLinks = (body.customLinks as unknown[])
      .filter((l): l is Record<string, unknown> => Boolean(l) && typeof l === 'object')
      .slice(0, 20)
      .map((l) => ({
        id: typeof l.id === 'string' && l.id ? l.id : crypto.randomUUID(),
        label: typeof l.label === 'string' ? l.label.trim().slice(0, 80) : '',
        url: typeof l.url === 'string' ? l.url.trim().slice(0, 500) : '',
        thumbnail:
          typeof l.thumbnail === 'string' && /^https?:\/\//i.test(l.thumbnail.trim())
            ? l.thumbnail.trim().slice(0, 500)
            : '',
      }))
      .filter((l) => l.label && /^https?:\/\//i.test(l.url));
  }
  if (Array.isArray(body.videos)) {
    // Sanitize to [{ id, url, title }] — cap 12, only real YouTube URLs survive.
    patch.videos = (body.videos as unknown[])
      .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object')
      .slice(0, 12)
      .map((v) => ({
        id: typeof v.id === 'string' && v.id ? v.id : crypto.randomUUID(),
        url: typeof v.url === 'string' ? v.url.trim().slice(0, 500) : '',
        title: typeof v.title === 'string' ? v.title.trim().slice(0, 120) : '',
      }))
      .filter((v) => parseYouTubeId(v.url));
  }

  // featuredPropertyIds: validate each id belongs to the space and is an
  // active listing. Unknown / stale ids are dropped silently rather than
  // 400-ing the whole save — the editor's set can drift when a property
  // gets deleted or marked sold, and the user shouldn't be punished for
  // that. Cap at FEATURED_CAP. Order is preserved (array order = render
  // order on the public page).
  if (Array.isArray(body.featuredPropertyIds)) {
    const raw = (body.featuredPropertyIds as unknown[])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, FEATURED_CAP);

    if (raw.length === 0) {
      patch.featuredPropertyIds = [];
    } else {
      const { data: validRows } = await supabase
        .from('Property')
        .select('id')
        .eq('spaceId', space.id)
        .eq('listingStatus', 'active')
        .in('id', raw);
      const valid = new Set((validRows ?? []).map((r: { id: string }) => r.id));
      // Preserve the realtor's submitted order — `.in()` returns rows in
      // whatever order Postgres feels like.
      patch.featuredPropertyIds = raw.filter((id) => valid.has(id));
    }
  }

  const { data, error } = await supabase
    .from('ProfilePage')
    .upsert({ spaceId: space.id, ...patch }, { onConflict: 'spaceId' })
    .select(SELECT)
    .single();

  if (error) {
    logger.error('[profile-page] update failed', { spaceId: space.id }, error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // socialLinks + isVerified live on SpaceSetting (they're brand-level —
  // every public surface the realtor owns reads from there). Build a
  // separate settings patch and apply it if anything came through.
  const settingsPatch: Record<string, unknown> = {};

  if (typeof body.isVerified === 'boolean') {
    settingsPatch.isVerified = body.isVerified;
  }

  if (body.socialLinks && typeof body.socialLinks === 'object' && !Array.isArray(body.socialLinks)) {
    // Closed platform set — anything outside SOCIAL_PLATFORMS is dropped.
    // Each value must be a string http(s) URL; non-URL strings are
    // silently dropped so we never persist an unclickable link. Empty
    // strings remove the platform.
    const incoming = body.socialLinks as Record<string, unknown>;
    const cleaned: Partial<Record<SocialPlatform, string>> = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const raw = incoming[platform];
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim().slice(0, 500);
      if (!trimmed) continue; // empty = unset, leave it out
      if (!/^https?:\/\//i.test(trimmed)) continue;
      cleaned[platform] = trimmed;
    }
    settingsPatch.socialLinks = cleaned;
  }

  let settingsRow: { isVerified: boolean; socialLinks: Record<string, string> } | null = null;
  if (Object.keys(settingsPatch).length > 0) {
    // Upsert keyed on spaceId — when the row doesn't exist yet, the unique
    // constraint on spaceId picks it up and we synthesise the required PK.
    const { data: upserted, error: settingsError } = await supabase
      .from('SpaceSetting')
      .upsert(
        { id: crypto.randomUUID(), spaceId: space.id, ...settingsPatch },
        { onConflict: 'spaceId' },
      )
      .select(SETTINGS_SELECT)
      .single();

    if (settingsError) {
      logger.error('[profile-page] settings update failed', { spaceId: space.id }, settingsError);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    settingsRow = upserted as unknown as typeof settingsRow;
  } else {
    const { data: existing } = await supabase
      .from('SpaceSetting')
      .select(SETTINGS_SELECT)
      .eq('spaceId', space.id)
      .maybeSingle();
    settingsRow = existing as unknown as typeof settingsRow;
  }

  // Mirror the GET shape so the editor's applyConfig() can re-hydrate
  // straight from the PATCH response.
  const settingsRowAny = settingsRow as { isVerified?: boolean; socialLinks?: unknown } | null;
  const rawSocial = (settingsRowAny?.socialLinks ?? {}) as Record<string, unknown>;
  const cleanSocial: Partial<Record<SocialPlatform, string>> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const v = rawSocial[platform];
    if (typeof v === 'string' && v.trim()) cleanSocial[platform] = v.trim();
  }

  return NextResponse.json({
    ...data,
    isVerified: settingsRowAny?.isVerified === true,
    socialLinks: cleanSocial,
  });
}
