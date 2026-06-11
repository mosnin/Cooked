/**
 * Account deletion — the destructive sweep, in one reviewed place.
 *
 * GDPR right to erasure / CCPA right to delete (Privacy Policy §11.1). This is
 * the only place in the codebase that hard-deletes a user's full footprint, so
 * it lives behind a single function with the table-by-table plan documented in
 * docs/DATA-DELETION.md. Read that doc before touching this.
 *
 * How the cascade works (this is load-bearing):
 *   - `Space.ownerId REFERENCES "User"(id) ON DELETE CASCADE`
 *   - almost every Space-scoped table is `REFERENCES "Space"(id) ON DELETE CASCADE`
 *   So deleting the single User row cascades to the Space row, which cascades
 *   to Contact, Deal, Property, Conversation, Message, Note, Tour, etc. We do
 *   not hand-roll a deletion order — Postgres enforces it via the FK graph.
 *
 * What does NOT cascade (and so is swept explicitly here, BEFORE the User
 * delete, while we still hold the spaceId):
 *   - `Attachment`     — has spaceId but no FK to Space
 *   - `TelemetryEvent` — has nullable spaceId, no FK to Space
 *
 * What is intentionally retained (see docs/DATA-DELETION.md §retention):
 *   - Stripe customer/invoice records (held by Stripe; legal/financial retention)
 *   - CommissionLedger (brokerage-owned financial record, not space-owned)
 *   - SupportTicket / Property pool rows that ON DELETE SET NULL rather than cascade
 *
 * The feature flag (ACCOUNT_DELETION_HARD_DELETE) gates the irreversible DB
 * sweep. With it off, the route still deletes the Clerk user and records the
 * request, but leaves the workspace rows intact for the documented manual /
 * reviewed run. This is deliberate: we do not ship an untested cascade as
 * always-on. Flip it once owner has signed off on docs/DATA-DELETION.md.
 */

import { supabase } from '@/lib/supabase';

export function hardDeleteEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_HARD_DELETE === 'true';
}

/**
 * Returns a reason string if the space's owner cannot be hard-deleted yet, or
 * null if deletion is safe to proceed.
 *
 * The one structural blocker: `Brokerage.ownerId REFERENCES "User"(id) ON
 * DELETE RESTRICT`. A broker who owns a brokerage cannot have their User row
 * deleted until the brokerage is transferred or removed — Postgres will reject
 * the delete. We surface that as a clear message rather than letting the DB
 * throw an opaque FK error at the user.
 */
export async function checkDeletionBlockers(ownerId: string): Promise<string | null> {
  const { data: ownedBrokerages } = await supabase
    .from('Brokerage')
    .select('id, name')
    .eq('ownerId', ownerId);

  if (ownedBrokerages && ownedBrokerages.length > 0) {
    return 'you own a brokerage. transfer or close it before deleting your account, or contact help@usechippi.com.';
  }
  return null;
}

/**
 * The destructive sweep. Deletes the non-cascading tables explicitly, then
 * deletes the User row (which cascades to Space and everything under it).
 *
 * Gated by hardDeleteEnabled(). Callers MUST check that flag and surface the
 * scaffold path when it's off — this function will throw if called with the
 * flag disabled, as a second guard against an accidental purge.
 */
export async function hardDeleteSpaceAndUser(params: {
  userDbId: string;
  spaceId: string;
}): Promise<void> {
  if (!hardDeleteEnabled()) {
    throw new Error('hardDeleteSpaceAndUser called with ACCOUNT_DELETION_HARD_DELETE off');
  }

  const { userDbId, spaceId } = params;

  // 1. Non-cascading tables — must go first, while the spaceId still resolves.
  const { error: attErr } = await supabase.from('Attachment').delete().eq('spaceId', spaceId);
  if (attErr) throw new Error(`Attachment delete failed: ${attErr.message}`);

  const { error: telErr } = await supabase.from('TelemetryEvent').delete().eq('spaceId', spaceId);
  if (telErr) throw new Error(`TelemetryEvent delete failed: ${telErr.message}`);

  // 2. The User row — cascades to Space → all Space-scoped FK tables.
  const { error: userErr } = await supabase.from('User').delete().eq('id', userDbId);
  if (userErr) throw new Error(`User delete failed: ${userErr.message}`);
}
