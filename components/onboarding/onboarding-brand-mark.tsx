'use client';

/**
 * The brand mark on the onboarding hero. Previously a custom rounded-diamond
 * SVG, which the user (correctly) flagged as a "weird shape" that didn't
 * belong on the front door of the product. Now renders the actual Chippi
 * logo so the moment the realtor lands on setup, they see the same identity
 * that lives in the sidebar, the public profile, and every other surface.
 */
import { BrandLogo } from '@/components/brand-logo';

export function OnboardingBrandMark({ size = 48 }: { size?: number }) {
  // BrandLogo is height-driven via Tailwind. Map common sizes; default 48 →
  // h-12. For other sizes fall back to inline style on the wrapping span.
  const heightClass =
    size === 20
      ? 'h-5'
      : size === 24
        ? 'h-6'
        : size === 32
          ? 'h-8'
          : size === 48
            ? 'h-12'
            : size === 64
              ? 'h-16'
              : 'h-12';
  return <BrandLogo className={heightClass} alt="Chippi" />;
}
