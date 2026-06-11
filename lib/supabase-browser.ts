import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client. Used for Realtime subscriptions only —
 * all data mutations still go through API routes using the service role
 * key on the server.
 *
 * The client is initialised with the anon key so it can connect at all,
 * but Realtime RLS evaluates as `anon` until `setRealtimeAuth(jwt)` is
 * called with a Clerk-minted JWT. Until then, every subscription gets
 * zero rows (the migration that landed alongside this file rewrites the
 * old USING(false) anon policies to authenticated predicates scoped by
 * the JWT's `sub` claim).
 *
 * The SupabaseRealtimeBridge component (mounted in the dashboard layout)
 * fetches the Clerk JWT and feeds it in here. Without that bridge in the
 * tree, Realtime is a no-op — which is the graceful-degradation path
 * if Clerk's "supabase" template isn't configured yet.
 */
let _browserClient: ReturnType<typeof createClient> | undefined;

export function getSupabaseBrowser() {
  if (_browserClient) return _browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[supabase-browser] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — realtime disabled');
    return null;
  }

  _browserClient = createClient(url, key, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return _browserClient;
}

/**
 * Push a fresh JWT into the Realtime auth slot. Called by the
 * SupabaseRealtimeBridge component every time Clerk hands us a token —
 * on mount, on token refresh, and after re-auth. Safe to call repeatedly
 * with the same token (cheap no-op on the Realtime client).
 *
 * Pass `null` to revert to anon (e.g. on sign-out).
 */
export function setRealtimeAuth(token: string | null): void {
  const client = _browserClient;
  if (!client) return;
  // Supabase JS v2 exposes setAuth on the realtime instance; calling it
  // with null falls back to the anon key, which is exactly what we want
  // on sign-out (zero events under the new RLS predicates).
  (client.realtime as { setAuth: (token: string | null) => void }).setAuth(token);
}
