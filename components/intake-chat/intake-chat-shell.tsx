'use client';

/**
 * IntakeChatShell — the realtor's storefront wrapped around the intake chat.
 *
 * What the applicant sees in the first second:
 *   1. (optional) a soft, dimmed cover-photo band — same image the public
 *      profile uses, just narrower and pulled back so it never competes
 *      with the question.
 *   2. The realtor's face (or a brand-orange-tinted monogram fallback —
 *      never a generic figure on a purple gradient).
 *   3. The business name in serif Times — the brand's focal flourish.
 *      Verified blue-check rides the baseline when isVerified is true.
 *   4. The agent's name as a secondary line. Suppressed if it equals the
 *      business name.
 *
 * What this shell is NOT:
 *   - Not the public profile. No bio, no social icons, no listing cards.
 *     The intake is a focused conversation; the hero just establishes
 *     identity and gets out of the way.
 *   - Not a logo dump. If `logoUrl` is set, we substitute it for the
 *     wordmark in a quiet, single-line treatment — but we don't render
 *     both the logo and the typed name.
 *
 * The shell renders no chat content; children render whatever the
 * IntakeChat state machine produces.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import { BadgeCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { DURATION_BASE, EASE_OUT } from '@/lib/motion';
import { safeHref, cn } from '@/lib/utils';
import { TITLE_FONT } from '@/lib/typography';

export interface IntakeChatShellProps {
  /** The realtor's brand-facing name — businessName from SpaceSetting, or
   *  the Space.name fallback. This is the focal serif moment. */
  businessName: string;
  /** The actual person's name. Rendered as a secondary line only when it
   *  differs from `businessName` (avoids "Jane Doe / Jane Doe"). */
  agentName: string;
  /** Realtor face. Already signed-and-resolved upstream; null if the
   *  realtor hasn't uploaded one (we fall back to a serif monogram). */
  agentPhoto?: string | null;
  /** Optional cover photo (same field /p/[slug] uses). When present, it
   *  becomes a softened brand band behind the avatar. */
  coverPhotoUrl?: string | null;
  /** When the realtor has uploaded a wordmark, it substitutes for the
   *  typed business name. Quiet, single-line — no doubled identity. */
  logoUrl?: string | null;
  /** Drives the blue-check next to the business name. */
  isVerified?: boolean;
  /** When set, the realtor identity in the header becomes a Link to this
   *  href — typically the public profile at /p/[slug]. Lets applicants
   *  step over to learn more about the realtor without abandoning the
   *  intake flow. Null/undefined → identity renders non-interactive. */
  profileHref?: string | null;
  accentColor?: string;
  privacyPolicyUrl?: string | null;
  termsUrl?: string | null;
  hidePoweredBy?: boolean;
  footerLinks?: { label: string; url: string }[];
  /** Realtor/brokerage-supplied trust signals. Chippi never injects
   *  legal copy — the slots are optional and the block disappears
   *  entirely when none are provided. */
  licenseNumber?: string | null;
  fairHousingNotice?: string | null;
  showEqualHousingMark?: boolean;
  children: ReactNode;
}

/** Standard Equal Housing Opportunity mark — house silhouette with an
 *  equals sign. Rendered as inline SVG so it inherits text color and
 *  scales cleanly at ~14px. Pure presentation, no remote assets. */
function EqualHousingMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label="Equal Housing Opportunity"
      role="img"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* House silhouette */}
      <path d="M3 11 L12 3 L21 11 V21 H3 Z" />
      {/* Equals sign inside */}
      <line x1="8" y1="13.5" x2="16" y2="13.5" />
      <line x1="8" y1="16.5" x2="16" y2="16.5" />
    </svg>
  );
}

/** First two initials from a name. Falls back to a single dot when empty. */
function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  return parts
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Realtor identity hero — cover band + avatar + name.
 *
 * Sweat the details: the cover (if any) gets a soft top-to-bottom gradient
 * dimmer so the avatar reads against it without looking pasted on. The
 * avatar lifts above the band with a `border-4 border-background` ring
 * that doubles as a paper-flat lift signal — no shadow needed.
 *
 * Fallback rules (no agentPhoto):
 *   - Use a `bg-brand-subtle` (washed orange tint, defined in globals.css)
 *     monogram circle with the realtor's initials in serif Times, brand-
 *     orange text. This is the ONLY place outside Chippi proper where
 *     brand-orange appears in the intake — and it's the realtor's
 *     identity slot, not a button or chrome — so it reads as warmth, not
 *     as a brand violation.
 *   - In dark mode the brand-subtle token already swaps to the right
 *     warm-brown tint, so the monogram stays legible.
 */
function RealtorIdentity({
  businessName,
  agentName,
  agentPhoto,
  coverPhotoUrl,
  logoUrl,
  isVerified,
  profileHref,
}: {
  businessName: string;
  agentName: string;
  agentPhoto?: string | null;
  coverPhotoUrl?: string | null;
  logoUrl?: string | null;
  isVerified?: boolean;
  /** When provided, the business name / logo becomes a quiet Link to the
   *  realtor's public page. Gives applicants a way to learn more about
   *  who they're applying with without abandoning the chat. */
  profileHref?: string | null;
}) {
  const initials = deriveInitials(businessName || agentName);
  const showSecondary =
    agentName && agentName.trim() && agentName.trim() !== businessName.trim();

  return (
    <div className="text-center">
      {/* Cover band — only when the realtor has uploaded a cover. The 16:9
          aspect ratio matches /p/[slug] but the height is constrained so
          the band reads as a quiet brand frame, not a hero takeover. The
          bottom-gradient mask blends into the page so the avatar appears
          to float out of it without a hard edge. */}
      {coverPhotoUrl && (
        // The negative top margin (-mt-5 sm:-mt-6) cancels the header
        // container's pt-5 sm:pt-6 so the cover band sits flush against
        // the top of the page — no body-coloured strip above it on iOS
        // even when the safe-area drops content below the notch. The
        // image grows in height a touch on mobile (h-28) so the extra
        // vertical real estate goes INTO the brand frame, not into empty
        // space above it.
        <div className="relative -mx-5 sm:-mx-8 -mt-5 sm:-mt-6 mb-[-2.75rem] h-28 sm:h-32 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverPhotoUrl}
            alt=""
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover opacity-80"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/40 to-background"
          />
        </div>
      )}

      <div className="relative inline-flex flex-col items-center">
        {agentPhoto ? (
          // Real photo wins every time. The 4px background ring carries
          // the lift against any cover; no shadow needed.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agentPhoto}
            alt={agentName}
            className={cn(
              'h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-full object-cover object-top',
              'border-4 border-background',
            )}
          />
        ) : (
          // Brand-orange-tinted monogram. Serif Times — matches the focal
          // serif moment used on the business name below. The 4px ring
          // mirrors the photo variant so layout stays steady.
          <span
            aria-hidden
            className={cn(
              'h-16 w-16 sm:h-[72px] sm:w-[72px] rounded-full inline-flex items-center justify-center',
              'border-4 border-background',
              'bg-orange-50 text-orange-600',
              'dark:bg-orange-500/15 dark:text-orange-400',
              'text-2xl sm:text-[26px] leading-none select-none',
            )}
            style={TITLE_FONT}
          >
            {initials}
          </span>
        )}
      </div>

      {/* Business name — the focal serif moment. Logo, if uploaded,
          substitutes for the typed name (single source of identity).
          The whole identity block wraps in a Link to /p/[slug] when a
          profileHref is provided so applicants can step over to the
          realtor's public page without breaking the intake flow. */}
      <div className="mt-3 sm:mt-4">
        {(() => {
          const identityNode = logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={businessName}
              loading="eager"
              decoding="async"
              className="mx-auto h-8 sm:h-9 max-w-[220px] object-contain"
            />
          ) : (
            <h1
              className={cn(
                'inline-flex items-center justify-center gap-1.5',
                'text-[22px] sm:text-2xl leading-tight tracking-tight text-foreground',
              )}
              style={TITLE_FONT}
            >
              {businessName}
              {isVerified && (
                <BadgeCheck
                  size={16}
                  aria-label="Verified"
                  className="shrink-0 fill-sky-500 text-white dark:fill-sky-400"
                />
              )}
            </h1>
          );
          return profileHref ? (
            <Link
              href={profileHref}
              className="inline-block transition-opacity hover:opacity-80"
              aria-label={`View ${businessName}'s page`}
            >
              {identityNode}
            </Link>
          ) : (
            identityNode
          );
        })()}

        {showSecondary && (
          <p className="mt-1 text-[12px] sm:text-[13px] text-muted-foreground">
            {agentName}
          </p>
        )}
      </div>
    </div>
  );
}

export function IntakeChatShell({
  businessName,
  agentName,
  agentPhoto,
  coverPhotoUrl,
  logoUrl,
  isVerified,
  profileHref,
  privacyPolicyUrl,
  termsUrl,
  hidePoweredBy,
  footerLinks,
  licenseNumber,
  fairHousingNotice,
  showEqualHousingMark,
  children,
}: IntakeChatShellProps) {
  // The trust block is entirely optional. If the realtor hasn't supplied
  // any of these three, render nothing — no hairline, no empty space.
  const trustedLicense = licenseNumber?.trim() || '';
  const trustedNotice = fairHousingNotice?.trim() || '';
  const hasTrustBlock = Boolean(
    trustedLicense || trustedNotice || showEqualHousingMark,
  );

  return (
    // Outer canvas. On mobile the chat fills the viewport edge-to-edge.
    // On sm+ the chat becomes a centred card on a blurred image fill —
    // same family as /p/[slug] and /book/[slug] so all three applicant-
    // facing surfaces share one product aesthetic.
    <div className="relative min-h-dvh bg-background sm:bg-muted/40 text-foreground">
      {/* Desktop blur canvas — only sm+. Cover photo blurred behind the
          card; 45% darken so the chat stays legible. Mobile skips this
          (no card frame on mobile means the blur would be invisible). */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 hidden sm:block"
      >
        {coverPhotoUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverPhotoUrl}
              alt=""
              loading="eager"
              decoding="async"
              className="h-full w-full scale-110 object-cover blur-[48px]"
            />
            <div className="absolute inset-0 bg-black/45" />
          </>
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-muted/60 via-muted/40 to-muted/60" />
        )}
      </div>

      {/* The chat card. Full-screen on mobile, centred 540-wide card on
          sm+ with rounded corners and a hairline border — matches the
          public profile / booking shell vocabulary. */}
      <div className="relative mx-auto h-dvh min-h-[600px] flex flex-col w-full sm:max-w-[540px] sm:my-8 sm:h-[calc(100dvh-4rem)] sm:rounded-[28px] sm:border sm:border-border/60 sm:overflow-hidden sm:shadow-2xl sm:shadow-black/10 bg-background overflow-hidden">
      {/* Paper texture — 1px dot grid at ultra-low opacity. Reads as paper,
          not screen. Sits beneath everything, never interactive. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 pointer-events-none opacity-[0.035] dark:opacity-[0.07]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* ── Sticky header — realtor identity hero pinned at the top ──── */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: DURATION_BASE, ease: EASE_OUT }}
        className="flex-shrink-0 w-full bg-background/80 backdrop-blur-xl border-b border-border/40"
      >
        <div className="max-w-2xl mx-auto px-5 sm:px-8 pt-5 sm:pt-6 pb-4 sm:pb-5">
          <RealtorIdentity
            businessName={businessName}
            agentName={agentName}
            agentPhoto={agentPhoto}
            coverPhotoUrl={coverPhotoUrl}
            logoUrl={logoUrl}
            isVerified={isVerified}
            profileHref={profileHref}
          />
        </div>
      </motion.header>

      {/* ── Main — scrollable chat with edge-fade masks ─────────────── */}
      <main className="flex-1 w-full min-h-0 relative">
        {/* Top edge-fade so content scrolls into the sticky header without
            a hard cutoff. -mb negative pulls the next element up so the
            visual rhythm doesn't gain extra space. */}
        <div
          aria-hidden
          className="sticky top-0 z-10 h-6 -mb-6 bg-gradient-to-b from-background to-transparent pointer-events-none"
        />
        <div className="h-full overflow-y-auto scroll-smooth">
          <div className="max-w-2xl mx-auto px-5 sm:px-8 py-8 pb-12">
            {children}
          </div>
        </div>
        {/* Bottom edge-fade — the same trick on the other end. Content
            scrolls into the sticky footer without abrupt clipping. */}
        <div
          aria-hidden
          className="sticky bottom-0 z-10 h-8 -mt-8 bg-gradient-to-t from-background to-transparent pointer-events-none"
        />
      </main>

      {/* ── Sticky footer — small print pinned at the bottom ────────── */}
      <footer className="flex-shrink-0 w-full bg-background/70 backdrop-blur-xl border-t border-border/40">
        <div className="max-w-2xl mx-auto px-5 sm:px-8 py-3 sm:py-4">
          {/* Trust signals — only renders when the realtor supplies content.
              Sits above the Terms/Privacy/PoweredBy row, separated by a
              hairline. Paper-flat: text + rule, no chrome. */}
          {hasTrustBlock && (
            <div className="mb-3 pb-3 border-b border-border/40 text-[11px] text-muted-foreground/80 space-y-1.5">
              {showEqualHousingMark && (
                <div>
                  <EqualHousingMark className="h-3.5 w-3.5 text-muted-foreground/70" />
                </div>
              )}
              {trustedLicense && <div>{trustedLicense}</div>}
              {trustedNotice && (
                <div className="whitespace-pre-line">{trustedNotice}</div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-4 text-[11px] text-muted-foreground/70">
            <div className="flex items-center gap-4">
              {termsUrl && (
                <Link
                  href={safeHref(termsUrl)}
                  className="hover:text-foreground transition-colors"
                >
                  Terms
                </Link>
              )}
              {privacyPolicyUrl && (
                <Link
                  href={safeHref(privacyPolicyUrl)}
                  className="hover:text-foreground transition-colors"
                >
                  Privacy
                </Link>
              )}
              {(footerLinks ?? []).map((l) => (
                <Link
                  key={l.url}
                  href={safeHref(l.url)}
                  className="hover:text-foreground transition-colors"
                >
                  {l.label}
                </Link>
              ))}
            </div>
            {!hidePoweredBy && (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-muted-foreground/60',
                )}
              >
                Powered by <BrandLogo className="h-3 opacity-70" />
              </span>
            )}
          </div>
        </div>
      </footer>
      </div>
    </div>
  );
}

