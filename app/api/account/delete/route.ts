import { NextRequest, NextResponse } from 'next/server';
import { createClerkClient } from '@clerk/nextjs/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';
import {
  hardDeleteEnabled,
  checkDeletionBlockers,
  hardDeleteSpaceAndUser,
} from '@/lib/account-deletion';

/**
 * GDPR right to erasure / CCPA right to delete (Privacy Policy §11.1).
 *
 * Deletes the caller's account: the Clerk identity (so they can't log back in
 * to a phantom account) and — when ACCOUNT_DELETION_HARD_DELETE is on — the
 * full workspace footprint via lib/account-deletion.ts.
 *
 * Tenant scope: the space is derived from the session, never from the body.
 * The only body field is `confirm`, which must exactly match the workspace
 * name — type-to-confirm, re-validated server-side so a forged request without
 * the name can't trigger a delete.
 *
 * See docs/DATA-DELETION.md for the table-by-table plan and what's retained.
 */

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  // Destructive — rate-limit hard.
  const { allowed } = await checkRateLimit(`account:delete:${userId}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json({ error: 'too many attempts. try again later.' }, { status: 429 });
  }

  let confirm = '';
  try {
    const body = await req.json();
    confirm = typeof body.confirm === 'string' ? body.confirm : '';
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Type-to-confirm, re-checked server-side. The client also enforces this,
  // but the server is the boundary that matters.
  if (confirm.trim() !== space.name.trim()) {
    return NextResponse.json(
      { error: 'the confirmation text does not match your workspace name.' },
      { status: 400 },
    );
  }

  // Resolve the internal User row — needed for the cascade root.
  const { data: userRow } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', userId)
    .maybeSingle();
  if (!userRow) {
    return NextResponse.json({ error: 'account not found.' }, { status: 404 });
  }

  // Structural blockers (e.g. owning a brokerage → User delete is RESTRICTed).
  const blocker = await checkDeletionBlockers(userRow.id);
  if (blocker) {
    return NextResponse.json({ error: blocker }, { status: 409 });
  }

  // Audit BEFORE anything is touched — we keep the spaceId in the log.
  await audit({
    actorClerkId: userId,
    action: 'DELETE',
    resource: 'Space',
    resourceId: space.id,
    spaceId: space.id,
    req,
    metadata: {
      kind: 'account-deletion',
      slug: space.slug,
      name: space.name,
      hardDelete: hardDeleteEnabled(),
    },
  });

  // Delete the Clerk identity first — this is always safe and is the part that
  // actually locks the person out. If the DB sweep is gated off, the worst
  // case is an orphaned set of rows with no login, cleaned up by the reviewed
  // run; that's far safer than an untested always-on cascade.
  try {
    await clerkClient.users.deleteUser(userId);
  } catch (err) {
    console.error('[account/delete] Clerk deleteUser failed', err);
    return NextResponse.json(
      { error: "couldn't delete your login. nothing was removed — try again." },
      { status: 500 },
    );
  }

  // The destructive DB sweep — gated. Off by default until owner signs off on
  // docs/DATA-DELETION.md (see PR). When off, we stop here: login is gone,
  // request is audited, workspace rows await the reviewed run.
  if (!hardDeleteEnabled()) {
    return NextResponse.json({
      success: true,
      pendingDataDeletion: true,
      message:
        'your login has been removed. your workspace data is queued for permanent deletion.',
    });
  }

  try {
    await hardDeleteSpaceAndUser({ userDbId: userRow.id, spaceId: space.id });
  } catch (err) {
    // Login is already gone; the DB sweep failed. Surface it loudly — this is
    // the case to page on, because the row state is now partial.
    console.error('[account/delete] hard delete failed after Clerk delete', err);
    return NextResponse.json(
      {
        success: false,
        loginRemoved: true,
        error:
          'your login was removed but data deletion did not finish. contact help@usechippi.com.',
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
