import { supabase } from '@/lib/supabase';
import { normalizeSlug } from '@/lib/intake';
import type { Space } from '@/lib/types';

export async function getSpaceFromSlug(inputSlug: string): Promise<Space | null> {
  const slug = normalizeSlug(inputSlug);
  const { data, error } = await supabase
    .from('Space')
    .select('id, slug, name, emoji, ownerId, brokerageId, createdAt, stripeSubscriptionStatus')
    .eq('slug', slug)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Space) ?? null;
}

export async function getSpaceByOwnerId(ownerId: string): Promise<Space | null> {
  // Space.ownerId is UNIQUE, so a user has at most one (producing) Space — the
  // .limit(1) is belt-and-suspenders, not a "pick one of many". Note that
  // space.brokerageId is the intake-config owner, NOT a membership signal:
  // membership lives in BrokerageMembership. Don't read brokerageId as "which
  // brokerage this user belongs to."
  const { data, error } = await supabase
    .from('Space')
    .select('*')
    .eq('ownerId', ownerId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Space) ?? null;
}

/**
 * True when the Clerk user owns the given Space. Space.ownerId is UNIQUE, so
 * ownership is the precise (spaceId, userId) binding. Used by the internal
 * integration routes to reject a mismatched pair — the AGENT_INTERNAL_SECRET
 * bearer authenticates Modal, not the space, so without this a caller could
 * charge another workspace's rate-limit budget or probe its connected toolkits.
 */
export async function userOwnsSpace(spaceId: string, clerkUserId: string): Promise<boolean> {
  const { data: user } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', clerkUserId)
    .maybeSingle();
  if (!user) return false;
  const { data: space } = await supabase
    .from('Space')
    .select('id')
    .eq('id', spaceId)
    .eq('ownerId', user.id)
    .maybeSingle();
  return !!space;
}

export async function getSpaceForUser(clerkUserId: string): Promise<Space | null> {
  // Two queries but they're simple index lookups — keeping sequential to avoid
  // PostgREST FK constraint name ambiguity with inline references.
  //
  // The SELECT mirrors getSpaceFromSlug exactly — stripeSubscriptionStatus
  // is critical: requireActiveSubscription reads it directly from this row.
  // Previously this query omitted the column, so `space.stripeSubscriptionStatus`
  // came back undefined → coerced to 'inactive' → every paying realtor was
  // blocked from any route that combined getSpaceForUser + requireActiveSubscription
  // (Studio generate/edit are the live callers). Active+trialing realtors saw
  // a 403 on a paid feature unless they happened to also be platform admins.
  // That's fiduciary harm — we were charging customers and locking them out.
  const { data: user, error: userErr } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', clerkUserId)
    .limit(1)
    .maybeSingle();
  if (userErr) throw userErr;
  if (!user) return null;

  const { data, error } = await supabase
    .from('Space')
    .select('id, slug, name, emoji, ownerId, brokerageId, createdAt, stripeSubscriptionStatus')
    .eq('ownerId', user.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Space) ?? null;
}
