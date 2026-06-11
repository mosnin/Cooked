/**
 * GET  /api/manager/profile — the calling manager's OWN member profile.
 * PATCH /api/manager/profile — update the calling manager's OWN member profile.
 *
 * TIERED + self-scoped: gated via requireManager() (owner/admin only). A
 * manager can only ever read/write THEIR OWN TeamMembership row — the
 * update is keyed on (teamId, userId=dbUserId from the resolved context),
 * never on a client-supplied id. A rep_member can't reach a manager
 * context, so this 403s for them; an admin can't edit another member's
 * profile because there's no path to address another row.
 *
 * Profile fields (displayName, title, bio, photoUrl, phone) mirror the rep
 * profile on SpaceSetting but live per-member on TeamMembership — each
 * admin has their own profile within the team.
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';

interface MemberProfile {
  displayName: string | null;
  title: string | null;
  bio: string | null;
  photoUrl: string | null;
  phone: string | null;
}

export async function GET() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('TeamMembership')
    .select('displayName, title, bio, photoUrl, phone')
    .eq('id', ctx.membership.id)
    .maybeSingle<MemberProfile>();

  if (error) {
    // Degrade gracefully if the profile columns don't exist yet
    // (pre-20260615000000 migration).
    return NextResponse.json({
      displayName: null,
      title: null,
      bio: null,
      photoUrl: null,
      phone: null,
    });
  }

  return NextResponse.json({
    displayName: data?.displayName ?? null,
    title: data?.title ?? null,
    bio: data?.bio ?? null,
    photoUrl: data?.photoUrl ?? null,
    phone: data?.phone ?? null,
  });
}

export async function PATCH(req: Request) {
  const { userId: clerkId } = await auth();
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.displayName !== undefined) {
    updates.displayName =
      typeof body.displayName === 'string' && body.displayName.trim()
        ? body.displayName.trim().slice(0, 120)
        : null;
  }
  if (body.title !== undefined) {
    updates.title =
      typeof body.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : null;
  }
  if (body.bio !== undefined) {
    updates.bio =
      typeof body.bio === 'string' && body.bio.trim()
        ? body.bio.trim().slice(0, 2000)
        : null;
  }
  if (body.photoUrl !== undefined) {
    if (body.photoUrl === null || body.photoUrl === '') {
      updates.photoUrl = null;
    } else if (typeof body.photoUrl === 'string') {
      const url = body.photoUrl.trim().slice(0, 500);
      if (url && !/^https?:\/\/.+/i.test(url)) {
        return NextResponse.json(
          { error: 'Photo URL must start with http:// or https://' },
          { status: 400 },
        );
      }
      updates.photoUrl = url || null;
    }
  }
  if (body.phone !== undefined) {
    updates.phone =
      typeof body.phone === 'string' && body.phone.trim()
        ? body.phone.trim().slice(0, 40)
        : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // Self-scoped: update the caller's OWN membership row only. The id comes
  // from the resolved manager context, never from the client.
  const { error: updateErr } = await supabase
    .from('TeamMembership')
    .update(updates)
    .eq('id', ctx.membership.id);

  if (updateErr) {
    console.error('[manager/profile] update failed', updateErr);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }

  void audit({
    actorClerkId: clerkId ?? null,
    action: 'UPDATE',
    resource: 'TeamMembership',
    resourceId: ctx.membership.id,
    metadata: { updates },
  });

  return NextResponse.json({
    displayName: (updates.displayName as string | null) ?? null,
    title: (updates.title as string | null) ?? null,
    bio: (updates.bio as string | null) ?? null,
    photoUrl: (updates.photoUrl as string | null) ?? null,
    phone: (updates.phone as string | null) ?? null,
    ok: true,
  });
}
