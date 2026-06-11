'use client';

/**
 * ReferralTracker — attributes an authenticated signup to a FirstPromoter
 * affiliate, client-side only.
 *
 * Called once per authenticated session: fires `window.fpr('referral', { email })`
 * with the Clerk user's primary email. FirstPromoter matches this against the
 * _fprom_tid cookie set by fpr.js when the user first landed via a referral link.
 *
 * Mount this in the authenticated dashboard layout (app/s/[slug]/layout.tsx)
 * so it fires once after the realtor signs in — without touching any protected
 * server flows (onboarding, apply, Stripe).
 *
 * Guards:
 *  - Only fires when NEXT_PUBLIC_FIRST_PROMOTER_CID is set.
 *  - Only fires once per browser session (sessionStorage flag).
 *  - Gracefully no-ops when fpr.js has not loaded yet.
 */

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';

const CID = process.env.NEXT_PUBLIC_FIRST_PROMOTER_CID;
const SESSION_KEY = 'fpr_attribution_fired';

export function ReferralTracker() {
  const { user, isLoaded } = useUser();

  useEffect(() => {
    if (!CID) return;
    if (!isLoaded || !user) return;

    // Only fire once per session.
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const email =
      user.primaryEmailAddress?.emailAddress ??
      user.emailAddresses[0]?.emailAddress;

    if (!email) return;

    // fpr.js may still be loading; wait for it.
    const fire = () => {
      if (typeof window !== 'undefined' && typeof (window as any).fpr === 'function') {
        (window as any).fpr('referral', { email });
        sessionStorage.setItem(SESSION_KEY, '1');
      }
    };

    // Try immediately, then defer once in case fpr.js is still loading.
    fire();
    if (!sessionStorage.getItem(SESSION_KEY)) {
      const t = setTimeout(fire, 1500);
      return () => clearTimeout(t);
    }
  }, [isLoaded, user]);

  return null;
}
