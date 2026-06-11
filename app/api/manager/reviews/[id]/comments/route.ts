import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getManagerMemberContext } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { audit } from '@/lib/audit';
import { logger } from '@/lib/logger';

type Params = { params: Promise<{ id: string }> };

type ReviewRow = {
  id: string;
  teamId: string;
  requestingUserId: string;
  status: 'open' | 'approved' | 'closed';
};

/**
 * POST /api/manager/reviews/[id]/comments
 *
 * Appends a comment to a review. Authorized if EITHER:
 *   - the caller is any manager member of the review's team, OR
 *   - the caller is the agent who opened the review.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId: clerkId } = authResult;

  const { id: reviewId } = await params;

  let body: { body?: unknown };
  try {
    body = (await req.json()) as { body?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = body?.body;
  if (typeof raw !== 'string') {
    return NextResponse.json({ error: 'body is required' }, { status: 400 });
  }
  const commentBody = raw.trim();
  if (commentBody.length < 1 || commentBody.length > 2000) {
    return NextResponse.json(
      { error: 'body must be 1..2000 characters' },
      { status: 400 },
    );
  }

  // Load the review first — we need its teamId and requestingUserId
  // to authorize. Use maybeSingle so missing rows yield a controlled 404.
  const { data: review, error: loadErr } = await supabase
    .from('DealReviewRequest')
    .select('id, teamId, requestingUserId, status')
    .eq('id', reviewId)
    .maybeSingle<ReviewRow>();

  if (loadErr) {
    logger.error('[manager/reviews/comments/POST] load failed', { reviewId }, loadErr);
    return NextResponse.json({ error: 'Failed to load review' }, { status: 500 });
  }
  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }
  // Audit finding: before this gate, comments could still be POSTed after
  // the manager had resolved the review (the UI was going through stale
  // state). A resolved review is terminal — both sides see the resolution
  // note + resolver and the conversation is over. Returning 409 surfaces
  // that to the client rather than silently accepting a comment that
  // would appear on a "closed" thread.
  if (review.status !== 'open') {
    return NextResponse.json(
      { error: 'This review is already resolved. No further comments.' },
      { status: 409 },
    );
  }

  // Resolve the caller's DB user id.
  const { data: dbUser, error: userErr } = await supabase
    .from('User')
    .select('id')
    .eq('clerkId', clerkId)
    .maybeSingle<{ id: string }>();
  if (userErr) {
    logger.error('[manager/reviews/comments/POST] user lookup failed', { clerkId }, userErr);
    return NextResponse.json({ error: 'User not found' }, { status: 500 });
  }
  if (!dbUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Authorization: manager member of this team OR the requesting agent.
  const managerCtx = await getManagerMemberContext();
  const isManagerMember = Boolean(managerCtx && managerCtx.team.id === review.teamId);
  const isRequester = review.requestingUserId === dbUser.id;
  if (!isManagerMember && !isRequester) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const commentId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { error: insertErr } = await supabase.from('DealReviewComment').insert({
    id: commentId,
    reviewRequestId: reviewId,
    authorUserId: dbUser.id,
    body: commentBody,
    createdAt: nowIso,
  });

  if (insertErr) {
    logger.error('[manager/reviews/comments/POST] insert failed', { reviewId, commentId }, insertErr);
    return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 });
  }

  // Fetch author display name for the response.
  const { data: authorRow } = await supabase
    .from('User')
    .select('id, name')
    .eq('id', dbUser.id)
    .maybeSingle<{ id: string; name: string | null }>();

  void audit({
    actorClerkId: clerkId,
    action: 'CREATE',
    resource: 'DealReviewComment',
    resourceId: commentId,
    req,
    metadata: {
      reviewRequestId: reviewId,
      teamId: review.teamId,
      authorUserId: dbUser.id,
    },
  });

  return NextResponse.json(
    {
      id: commentId,
      body: commentBody,
      authorUser: {
        id: authorRow?.id ?? dbUser.id,
        name: authorRow?.name ?? null,
      },
      createdAt: nowIso,
    },
    { status: 201 },
  );
}
