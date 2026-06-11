'use client';

import { useSupabaseRealtimeAuth } from '@/hooks/use-supabase-realtime-auth';

/**
 * Invisible client component that wires the Clerk session JWT into the
 * Supabase Realtime singleton. Mount once near the root of the
 * authenticated layout — every subsequent `useRealtime` subscription
 * inherits the auth automatically because they all share the same
 * singleton from getSupabaseBrowser().
 *
 * Pre-bridge (until this commit), Realtime evaluated as anon and the
 * RLS policies denied every SELECT — every subscription was a silent
 * no-op masked by 5-min polling. This component is what makes the
 * "live" in "live notifications" actually live.
 */
export function SupabaseRealtimeBridge(): null {
  useSupabaseRealtimeAuth();
  return null;
}
