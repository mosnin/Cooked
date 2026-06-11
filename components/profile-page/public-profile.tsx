/**
 * The public realtor "link in bio" page rendered at /p/[slug].
 *
 * Layout: a single narrow column. A full-bleed header photo fades into the
 * page; identity and socials sit just below it. Then clearly separated,
 * labelled sections — the application (the conversion, in the realtor's
 * accent colour), tour booking, featured videos, listings, and links.
 *
 * On desktop the column becomes a centred card; on mobile it's full-bleed.
 * Branding (logo, accent colour, light/dark) is inherited from SpaceSetting
 * — the same fields the intake and booking pages use.
 *
 * Server component: every element is a link, nothing needs the client.
 */

import type { ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  Globe,
  Home,
  Link2,
  Play,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { PublicSurfaceFrame } from '@/components/public-surface-frame';
import { cn, safeHref } from '@/lib/utils';
import { pickContrastColor } from '@/lib/color';
import { parseYouTubeId, youTubeThumbnail, faviconUrl } from '@/lib/profile-page';

export interface PublicProperty {
  id: string;
  address: string;
  city: string | null;
  stateRegion: string | null;
  listPrice: number | null;
  photos: string[] | null;
  listingUrl: string | null;
}

interface PublicVideo {
  id: string;
  url: string;
  title?: string;
}

interface PublicProfileProps {
  slug: string;
  businessName: string;
  logoUrl: string | null;
  agentName: string;
  agentPhoto: string | null;
  bio: string | null;
  headline: string | null;
  socialLinks: Record<string, string> | null;
  accentColor: string;
  darkMode: boolean;
  showIntake: boolean;
  showTours: boolean;
  customLinks: Array<{ id: string; label: string; url: string; thumbnail?: string }>;
  videos: PublicVideo[];
  /** Realtor-curated hero image. When set it becomes the full-bleed header
   *  and the agent photo demotes to a round avatar centered below. When null,
   *  the agent photo stretches as the hero (the original behavior). On
   *  desktop, this is ALSO the blur source for the page background. */
  coverPhotoUrl: string | null;
  /** Small blue checkmark next to the realtor's name. Realtor-controlled
   *  toggle in the editor; defaults to false if the column doesn't exist. */
  isVerified: boolean;
  properties: PublicProperty[];
  hidePoweredBy: boolean;
}

function formatPrice(value: number | null): string | null {
  if (value == null || value <= 0) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Centred uppercase section heading — the divider between page sections. */
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-center text-[13px] font-bold uppercase tracking-[0.12em] text-foreground">
      {children}
    </h2>
  );
}

/** Hand-rolled brand marks — lucide dropped brand icons (and never had
 *  TikTok / Threads / X). Keeping all platform glyphs in one file so the
 *  social row stays visually coherent. */
function SocialIcon({ platform }: { platform: string }) {
  const size = 15;
  switch (platform.toLowerCase()) {
    case 'linkedin':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      );
    case 'facebook':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      );
    case 'twitter':
    case 'x':
      // The 2023 X mark — replaces the old bird so the icon row matches
      // what people actually see on Twitter/X today.
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'youtube':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.91a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.34z" />
        </svg>
      );
    case 'threads':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M17.36 11.205c-.085-.04-.171-.08-.258-.118-.151-2.798-1.68-4.4-4.246-4.416h-.035c-1.534 0-2.81.655-3.595 1.846l1.41.967c.587-.89 1.508-1.08 2.186-1.08h.023c.844.005 1.481.25 1.894.728.3.348.5.83.598 1.44-.74-.126-1.54-.165-2.395-.116-2.41.139-3.96 1.544-3.856 3.498.053.991.546 1.844 1.388 2.401.713.472 1.63.702 2.583.65 1.259-.07 2.246-.55 2.935-1.428.523-.666.854-1.529.998-2.617.591.357 1.029.826 1.272 1.39.412.96.436 2.537-.85 3.821-1.126 1.125-2.48 1.612-4.527 1.627-2.27-.017-3.987-.745-5.103-2.163C7.776 16.32 7.227 14.39 7.205 12c.022-2.39.571-4.32 1.633-5.735C9.954 4.847 11.67 4.12 13.94 4.103c2.287.017 4.032.748 5.187 2.171.567.696 1 1.578 1.279 2.607l1.65-.44c-.337-1.273-.866-2.376-1.586-3.265C19.018 3.367 16.802 2.43 13.943 2.41h-.012c-2.852.02-5.057.96-6.553 2.793-1.354 1.65-2.05 3.949-2.075 6.789v.013c.024 2.84.72 5.138 2.075 6.788 1.496 1.833 3.701 2.773 6.553 2.794h.012c2.527-.018 4.292-.677 5.745-2.137 1.913-1.911 1.866-4.317 1.236-5.811-.45-1.077-1.297-1.949-2.443-2.535zm-4.291 3.93c-1.058.058-2.158-.418-2.213-1.444-.04-.762.546-1.612 2.279-1.712.197-.012.39-.018.582-.018.625 0 1.21.06 1.74.176-.197 2.444-1.337 2.937-2.388 2.998z" />
        </svg>
      );
    case 'website':
    case 'site':
    default:
      return <Globe size={size} aria-hidden />;
  }
}

/** Closed platform list. The order is the render order in the icon row —
 *  Instagram first (where realtors live) → Facebook → X → LinkedIn →
 *  YouTube → TikTok → Threads → "Personal site" last. The editor accepts
 *  these keys only; the renderer iterates this list (not the entries) so
 *  the order is stable regardless of object-key insertion. */
export const SOCIAL_PLATFORMS = [
  'instagram',
  'facebook',
  'twitter',
  'linkedin',
  'youtube',
  'tiktok',
  'threads',
  'website',
] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  twitter: 'X (Twitter)',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  threads: 'Threads',
  website: 'Personal site',
};

export const SOCIAL_PLACEHOLDERS: Record<SocialPlatform, string> = {
  instagram: 'https://instagram.com/your-handle',
  facebook: 'https://facebook.com/your-page',
  twitter: 'https://x.com/your-handle',
  linkedin: 'https://linkedin.com/in/you',
  youtube: 'https://youtube.com/@you',
  tiktok: 'https://tiktok.com/@you',
  threads: 'https://threads.net/@you',
  website: 'https://your-site.com',
};

/** The YouTube glyph for the video-card corner badge. */
function YouTubeMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#FF0000"
        d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8Z"
      />
      <path fill="#fff" d="M9.6 15.6 15.8 12 9.6 8.4Z" />
    </svg>
  );
}

function VideoCard({ video }: { video: PublicVideo }) {
  const videoId = parseYouTubeId(video.url);
  if (!videoId) return null;
  return (
    <a
      href={safeHref(video.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="group block overflow-hidden rounded-2xl border border-border/70 bg-card transition-colors hover:bg-muted/30"
    >
      <div className="relative">
        <img
          src={youTubeThumbnail(videoId)}
          alt={video.title || 'YouTube video'}
          loading="lazy"
          decoding="async"
          className="aspect-video w-full object-cover"
        />
        <span className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white">
          <YouTubeMark />
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/55 ring-1 ring-white/20 transition-transform duration-150 group-hover:scale-105">
            <Play size={22} className="ml-0.5 text-white" fill="currentColor" />
          </span>
        </span>
      </div>
      {video.title && (
        <div className="px-4 py-3">
          <p className="truncate text-sm font-medium text-foreground">{video.title}</p>
        </div>
      )}
    </a>
  );
}

/** A single property card inside the carousel. Image-led; fixed width so
 *  the carousel hints a peek of the next card at the right edge on mobile.
 *  When a property has no photo we render a tasteful muted placeholder
 *  (Home glyph) rather than a broken-image gap. The whole card is a link
 *  when `listingUrl` is set; otherwise it's a static surface. */
function PropertyCard({ property }: { property: PublicProperty }) {
  const cover = property.photos?.[0] ?? null;
  const locality = [property.city, property.stateRegion].filter(Boolean).join(', ');
  const price = formatPrice(property.listPrice);

  const inner = (
    <>
      {cover ? (
        <img
          src={cover}
          alt={property.address}
          loading="lazy"
          decoding="async"
          className="aspect-[16/9] w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex aspect-[16/9] w-full items-center justify-center bg-muted"
        >
          <Home size={28} className="text-muted-foreground/60" />
        </div>
      )}
      <div className="px-4 py-3">
        <p className="truncate text-sm font-medium text-foreground">{property.address}</p>
        {locality && <p className="truncate text-xs text-muted-foreground">{locality}</p>}
        {price && (
          <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{price}</p>
        )}
      </div>
    </>
  );

  // The shared classes describe the carousel slide itself — fixed width so
  // ~1.7 cards are visible on a 390px phone (hints horizontal swipe), the
  // canonical card border/radius vocabulary, and `sm:hover:-translate-y-0.5`
  // so it lifts on desktop only (mobile gets no hover state). `snap-start`
  // pairs with the scroller's `snap-x mandatory` to lock each card into
  // place as the realtor swipes.
  const slideClass =
    'block w-[260px] shrink-0 snap-start overflow-hidden rounded-2xl border border-border/70 bg-card sm:transition-transform sm:duration-150 sm:hover:-translate-y-0.5';

  if (property.listingUrl) {
    return (
      <a
        href={safeHref(property.listingUrl)}
        target="_blank"
        rel="noopener noreferrer"
        className={slideClass}
      >
        {inner}
      </a>
    );
  }
  return <div className={slideClass}>{inner}</div>;
}

function LinkCard({
  link,
}: {
  link: { id: string; label: string; url: string; thumbnail?: string };
}) {
  // Uploaded image wins; otherwise fall back to the site's favicon.
  const icon =
    link.thumbnail && link.thumbnail.trim() ? link.thumbnail : faviconUrl(link.url);

  return (
    <a
      href={safeHref(link.url)}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-3.5 py-3 transition-colors hover:bg-muted/30"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-background">
        {icon ? (
          <img src={icon} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <Link2 size={16} className="text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
        {link.label}
      </span>
      <ArrowUpRight
        size={16}
        className="shrink-0 text-muted-foreground/40 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
      />
    </a>
  );
}

export function PublicProfile({
  slug,
  businessName,
  logoUrl,
  agentName,
  agentPhoto,
  bio,
  headline,
  socialLinks,
  accentColor,
  darkMode,
  showIntake,
  showTours,
  customLinks,
  videos,
  coverPhotoUrl,
  isVerified,
  properties,
  hidePoweredBy,
}: PublicProfileProps) {
  // Render the icon row in canonical platform order (not object-key
  // insertion order). Anything not in SOCIAL_PLATFORMS is ignored — the
  // PATCH already enforces a closed set, but the renderer enforces it too
  // (defence in depth against legacy rows with arbitrary keys).
  const socialEntries = (SOCIAL_PLATFORMS as readonly string[])
    .map((platform) => {
      const raw = socialLinks?.[platform];
      const url = typeof raw === 'string' ? raw.trim() : '';
      return url ? { platform, url } : null;
    })
    .filter((e): e is { platform: string; url: string } => e !== null);
  const playableVideos = videos.filter((v) => parseYouTubeId(v.url));
  const ctaTextColor = pickContrastColor(accentColor);

  // Pick the best image for the desktop blur fill: realtor-curated cover
  // wins; otherwise the realtor's face; otherwise null (we fall through to
  // a neutral gradient). Mobile ignores this — a heavy blur on a phone is
  // expensive and the background fights the card on a small screen.
  const blurSource = coverPhotoUrl || agentPhoto || null;

  return (
    <PublicSurfaceFrame blurSource={blurSource} darkMode={darkMode}>
      <>
        {/* ── Header ──────────────────────────────────────────────────────
            Two shapes:
            (a) Cover photo set → cover is the full-bleed hero (16:9) and
                the agent photo becomes a round avatar that overlaps it.
            (b) No cover → the agent photo stretches as the hero (original
                behavior). ─────────────────────────────────────────────── */}
        <header>
          {coverPhotoUrl ? (
            <div className="relative">
              <img
                src={coverPhotoUrl}
                alt=""
                loading="eager"
                decoding="async"
                className="aspect-[16/9] w-full object-cover"
              />
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-background"
              />
            </div>
          ) : (
            agentPhoto && (
              <div className="relative">
                <img
                  src={agentPhoto}
                  alt={agentName}
                  loading="eager"
                  decoding="async"
                  className="aspect-[4/5] w-full object-cover object-top"
                />
                <div
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-b from-transparent to-background"
                />
              </div>
            )
          )}

          <div
            className={cn(
              'relative px-6 text-center',
              coverPhotoUrl ? '-mt-12' : agentPhoto ? '-mt-14' : 'pt-12',
            )}
          >
            {/* When a cover is set, the face becomes a round avatar — the
                "who" — sitting on top of the hero. The 4px background-coloured
                ring carries the lift against any cover; no shadow needed. */}
            {coverPhotoUrl && agentPhoto && (
              <img
                src={agentPhoto}
                alt={agentName}
                loading="eager"
                decoding="async"
                className="mx-auto mb-4 h-24 w-24 rounded-full border-4 border-background object-cover object-top"
              />
            )}

            <h1>
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={businessName}
                  loading="eager"
                  decoding="async"
                  className="mx-auto h-9 max-w-[240px] object-contain"
                />
              ) : (
                // Serif Times — the brand's quiet flourish, scoped to the
                // name line only (the handle and bio stay sans). Inline
                // BadgeCheck sits on the name's mid-line when verified;
                // it's the focal moment of the header.
                <span
                  className="inline-flex items-center justify-center gap-1.5 text-[28px] leading-tight tracking-tight text-foreground"
                  style={{ fontFamily: 'var(--font-title)' }}
                >
                  {businessName}
                  {isVerified && (
                    <BadgeCheck
                      size={18}
                      aria-label="Verified"
                      className="shrink-0 fill-sky-500 text-white dark:fill-sky-400"
                    />
                  )}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">@{slug}</p>
            {headline && (
              <p className="mt-2 text-sm text-foreground">{headline}</p>
            )}

            {socialEntries.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {socialEntries.map(({ platform, url }) => (
                  <a
                    key={platform}
                    href={safeHref(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={SOCIAL_LABELS[platform as SocialPlatform] ?? platform}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-foreground/80 transition-colors hover:bg-foreground/[0.08] hover:text-foreground"
                  >
                    <SocialIcon platform={platform} />
                  </a>
                ))}
              </div>
            )}

            {bio && (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{bio}</p>
            )}
          </div>
        </header>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-6 pb-10">
          {/* Primary actions */}
          {(showIntake || showTours) && (
            <div className="mt-7 space-y-3">
              {showIntake && (
                <a
                  href={`/apply/${slug}`}
                  style={{ backgroundColor: accentColor, color: ctaTextColor }}
                  className="group flex items-center gap-3 rounded-2xl px-5 py-4 transition-transform duration-150 active:scale-[0.99]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">Start your application</p>
                    <p className="truncate text-xs opacity-75">
                      A few quick questions about what you&apos;re looking for.
                    </p>
                  </div>
                  <ArrowRight
                    size={18}
                    className="shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </a>
              )}
              {showTours && (
                <a
                  href={`/book/${slug}`}
                  className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card px-5 py-4 transition-colors hover:bg-muted/30"
                >
                  <CalendarCheck size={18} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">Book a tour</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Pick a time that works for you.
                    </p>
                  </div>
                  <ArrowRight
                    size={16}
                    className="shrink-0 text-muted-foreground/40 transition-transform duration-150 group-hover:translate-x-0.5"
                  />
                </a>
              )}
            </div>
          )}

          {/* Watch */}
          {playableVideos.length > 0 && (
            <section className="mt-10 space-y-4">
              <SectionHeader>Watch</SectionHeader>
              <div className="space-y-3">
                {playableVideos.map((v) => (
                  <VideoCard key={v.id} video={v} />
                ))}
              </div>
            </section>
          )}

          {/* Listings — horizontal carousel.
              The scroller breaks out of the page's px-6 with `-mx-6 px-6` so
              cards align with the page padding but can scroll past it; the
              trailing card sits flush with the edge instead of clipping at
              the page padding. `snap-x mandatory` + `snap-start` on each
              card locks the card to the left edge as the realtor swipes.
              `no-scrollbar` hides the scrollbar — the peek of the next card
              is the affordance, not chrome. */}
          {properties.length > 0 && (
            <section className="mt-10 space-y-4">
              <SectionHeader>Listings</SectionHeader>
              <div
                className="-mx-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-2 no-scrollbar"
                style={{ scrollPaddingLeft: '1.5rem', scrollPaddingRight: '1.5rem' }}
              >
                {properties.map((p) => (
                  <PropertyCard key={p.id} property={p} />
                ))}
              </div>
            </section>
          )}

          {/* Links */}
          {customLinks.length > 0 && (
            <section className="mt-10 space-y-4">
              <SectionHeader>Links</SectionHeader>
              <div className="space-y-3">
                {customLinks.map((link) => (
                  <LinkCard key={link.id} link={link} />
                ))}
              </div>
            </section>
          )}

          {/* Already applied? A quiet way back into the client portal — never
              competes with the Apply / Book CTAs above. */}
          <div className="mt-12 text-center">
            <a
              href="/clients/login"
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Already applied? Check your status.
            </a>
          </div>

          {/* Powered by Chippi — free tier only; paid plans are white-label. */}
          {!hidePoweredBy && (
            <footer className="mt-6 flex items-center justify-center gap-1.5 opacity-40">
              <span className="text-[10px] text-muted-foreground">Powered by</span>
              <BrandLogo className="h-3" />
            </footer>
          )}
        </div>
      </>
    </PublicSurfaceFrame>
  );
}
