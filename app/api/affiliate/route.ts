/**
 * Affiliate program — GET / POST
 *
 *   GET  ?slug=<slug>  → { enrolled: false }
 *                      → { enrolled: true, refLink, stats, balances, dashboardUrl }
 *
 *   POST { slug }      → enroll (idempotent): creates a FP promoter + stores
 *                        the AffiliateAccount row, returns the link.
 *
 * Auth: requireSpaceOwner(slug) — only the workspace owner.
 */

import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  firstPromoterConfigured,
  createPromoter,
  getPromoter,
} from '@/lib/first-promoter';

export const runtime = 'nodejs';
export const maxDuration = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

interface AffiliateRow {
  id: string;
  userId: string;
  spaceId: string;
  fpPromoterId: string;
  refLink: string;
  refToken: string;
}

async function findAffiliateBySpace(spaceId: string): Promise<AffiliateRow | null> {
  const { data, error } = await supabase
    .from('AffiliateAccount')
    .select('id, userId, spaceId, fpPromoterId, refLink, refToken')
    .eq('spaceId', spaceId)
    .maybeSingle();
  if (error) {
    logger.warn('[affiliate] findAffiliateBySpace error', { spaceId, err: error.message });
    return null;
  }
  return (data as AffiliateRow) ?? null;
}

async function insertAffiliate(row: Omit<AffiliateRow, 'id'>): Promise<AffiliateRow | null> {
  const { data, error } = await supabase
    .from('AffiliateAccount')
    .insert({
      userId: row.userId,
      spaceId: row.spaceId,
      fpPromoterId: row.fpPromoterId,
      refLink: row.refLink,
      refToken: row.refToken,
    })
    .select('id, userId, spaceId, fpPromoterId, refLink, refToken')
    .single();

  if (error) {
    logger.error('[affiliate] insertAffiliate error', { spaceId: row.spaceId, err: error.message });
    return null;
  }
  return data as AffiliateRow;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  if (!firstPromoterConfigured()) {
    return NextResponse.json({ enrolled: false, unconfigured: true });
  }

  const existing = await findAffiliateBySpace(space.id);
  if (!existing) {
    return NextResponse.json({ enrolled: false });
  }

  // Fetch fresh stats from FirstPromoter.
  const fp = await getPromoter(existing.fpPromoterId);
  if (!fp) {
    // FP unreachable — return cached link, no stats.
    return NextResponse.json({
      enrolled: true,
      refLink: existing.refLink,
      stats: null,
      balances: [],
      dashboardUrl: null,
    });
  }

  return NextResponse.json({
    enrolled: true,
    refLink: fp.refLink,
    stats: fp.stats,
    balances: fp.balances,
    dashboardUrl: fp.dashboardUrl,
  });
}

// ── POST (enroll) ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let payload: { slug?: string };
  try {
    payload = (await req.json()) as { slug?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = payload.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  if (!firstPromoterConfigured()) {
    return NextResponse.json(
      { error: 'Affiliate program is not configured on this server.' },
      { status: 503 },
    );
  }

  // Idempotent — return existing row if already enrolled.
  const existing = await findAffiliateBySpace(space.id);
  if (existing) {
    const fp = await getPromoter(existing.fpPromoterId);
    return NextResponse.json({
      enrolled: true,
      refLink: fp?.refLink ?? existing.refLink,
      stats: fp?.stats ?? null,
      balances: fp?.balances ?? [],
      dashboardUrl: fp?.dashboardUrl ?? null,
    });
  }

  // Resolve the Clerk user's primary email.
  let email: string;
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(userId);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    email = primary?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '';
  } catch (err) {
    logger.warn('[affiliate] could not resolve clerk email', {
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Could not resolve your account email. Try again.' },
      { status: 500 },
    );
  }

  if (!email) {
    return NextResponse.json(
      { error: 'No email address found on your account.' },
      { status: 400 },
    );
  }

  const fp = await createPromoter({ email, custId: userId });
  if (!fp) {
    logger.error('[affiliate] createPromoter returned null', { spaceId: space.id });
    return NextResponse.json(
      { error: 'Could not create your affiliate account. Try again.' },
      { status: 500 },
    );
  }

  const inserted = await insertAffiliate({
    userId,
    spaceId: space.id,
    fpPromoterId: fp.id,
    refLink: fp.refLink,
    refToken: fp.refToken,
  });

  if (!inserted) {
    return NextResponse.json(
      { error: 'Could not save your affiliate account. Try again.' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    enrolled: true,
    refLink: fp.refLink,
    stats: fp.stats,
    balances: fp.balances,
    dashboardUrl: fp.dashboardUrl,
  });
}
