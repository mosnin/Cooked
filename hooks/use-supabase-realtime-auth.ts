'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { setRealtimeAuth } from '@/lib/supabase-browser';

/**
 * Bridge Clerk's session JWT into Supabase Realtime.
 *
 * Supabase Realtime evaluates RLS against the JWT's `sub` claim. We feed
 * a Clerk-issued JWT (template name "supabase", configured in the Clerk
 * dashboard with the project's JWT secret) so the `authenticated` role
 * policies can match `auth.jwt() ->> 'sub'` to `User.clerkId`.
 *
 * Without this hook running (or without the Clerk template existing), the
 * client stays on the anon key — every subscription returns zero rows under
 * the post-migration RLS predicates. That's the graceful-degradation path.
 *
 * Refresh strategy:
 *   - Fetch a token on mount.
 *   - Re-fetch every 50 minutes. Clerk default JWT lifetime is 60 minutes;
 *     we leave a 10-minute buffer so a slow tick can't leave us holding
 *     an expired token.
 *   - On unmount, clear the token (sign-out path), which falls Realtime
 *     back to anon — i.e. no events.
 */
export function useSupabaseRealtimeAuth(): void {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setRealtimeAuth(null);
      return;
    }

    let cancelled = false;

    async function refresh() {
      try {
        const token = await getToken({ template: 'supabase' });
        if (cancelled) return;
        setRealtimeAuth(token);
      } catch (err) {
        // If the "supabase" template isn't configured in Clerk, getToken
        // throws. Log once and fall back to anon — subscriptions will
        // just return zero events under the new RLS policies, exactly
        // matching the pre-bridge behaviour. No crash, no broken UI.
        console.warn(
          '[supabase-realtime-auth] Could not fetch Clerk JWT (is the "supabase" template configured?). Realtime falling back to anon.',
          err,
        );
        setRealtimeAuth(null);
      }
    }

    void refresh();
    // Clerk JWT default lifetime is 60min. Refresh at 50min for a buffer.
    const interval = setInterval(() => void refresh(), 50 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLoaded, isSignedIn, getToken]);
}
