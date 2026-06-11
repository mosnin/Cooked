import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { audit } from '@/lib/audit';
import { sendDraft, type DeliveryResult } from '@/lib/delivery';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

/**
 * Batch-approve pending agent drafts in one tap.
 *
 * Mirrors the auth + space-scoping shape of the single-draft PATCH endpoint
 * (`/api/agent/drafts/[id]`). Per-draft failure does NOT fail the batch —
 * the realtor batch-approves 5, four succeed, one returns its error, and the
 * UI surfaces per-item status from the `results[]` payload.
 *
 * Body: { draftIds: string[] }
 * Returns: { results: [{ draftId, ok, error?, status?, deliveryResult? }] }
 *
 * Server-side scoping: every draftId is verified to belong to the realtor's
 * space AND status='pending'. A compromised client passing ids from another
 * space gets per-item not_found, never an accidental cross-space send.
 *
 * Rate limit: 100 batch-approves per hour per space — one chat session might
 * batch 30-50 drafts; 100 covers the heaviest realtor.
 */

const MAX_BATCH_SIZE = 50;

interface BatchResult {
  draftId: string;
  ok: boolean;
  error?: string;
  status?: 'sent' | 'approved';
  deliveryResult?: DeliveryResult;
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { allowed } = await checkRateLimit(`agent-drafts-batch-approve:${space.id}`, 100, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many batch approvals. Try again later.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const draftIds = (body as { draftIds?: unknown })?.draftIds;
  if (!Array.isArray(draftIds) || draftIds.length === 0) {
    return NextResponse.json(
      { error: 'draftIds must be a non-empty array' },
      { status: 400 },
    );
  }
  if (draftIds.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Cannot batch more than ${MAX_BATCH_SIZE} drafts at once` },
      { status: 400 },
    );
  }
  if (!draftIds.every((id) => typeof id === 'string' && id.length > 0)) {
    return NextResponse.json(
      { error: 'draftIds must be an array of non-empty strings' },
      { status: 400 },
    );
  }
  // De-dupe to avoid double-sending if the client passes the same id twice.
  const uniqueIds = Array.from(new Set(draftIds as string[]));

  const results: BatchResult[] = [];

  for (const draftId of uniqueIds) {
    try {
      // Verify the draft belongs to this space AND is still pending. The
      // single-draft PATCH route does exactly this check; we repeat it
      // per-item so a stale draftId in the batch fails alone, not the batch.
      const { data: existing, error: fetchError } = await supabase
        .from('AgentDraft')
        .select('id, status, contactId, channel, subject, content')
        .eq('id', draftId)
        .eq('spaceId', space.id)
        .maybeSingle();

      if (fetchError || !existing) {
        results.push({ draftId, ok: false, error: 'not_found' });
        continue;
      }

      if (existing.status !== 'pending') {
        results.push({ draftId, ok: false, error: `already_${existing.status}` });
        continue;
      }

      // Fetch contact info needed for delivery (email / phone). Same shape
      // as the single PATCH route — fall back to a neutral name when the
      // draft isn't linked to a contact (e.g. an internal note).
      let contact = { name: 'Contact', email: null as string | null, phone: null as string | null };
      if (existing.contactId) {
        const { data: contactRow } = await supabase
          .from('Contact')
          .select('name, email, phone')
          .eq('id', existing.contactId)
          .eq('spaceId', space.id)
          .maybeSingle();
        if (contactRow) contact = contactRow;
      }

      const deliveryResult: DeliveryResult = await sendDraft(
        { channel: existing.channel, subject: existing.subject, content: existing.content },
        contact,
        space.name,
        { spaceId: space.id, userId },
      );

      // sent=true → "sent"; sent=false → "approved" (human reviewed,
      // delivery unconfigured/failed). Matches the single PATCH semantics.
      const finalStatus: 'sent' | 'approved' = deliveryResult.sent ? 'sent' : 'approved';

      const { error: updateError } = await supabase
        .from('AgentDraft')
        .update({
          status: finalStatus,
          updatedAt: new Date().toISOString(),
          feedback_action: 'approved',
          edit_distance: 0,
        })
        .eq('id', draftId)
        .eq('spaceId', space.id);

      if (updateError) {
        // Delivery may have already happened — surface the DB error to the
        // realtor but mark the result as failed so they re-check.
        results.push({
          draftId,
          ok: false,
          error: `update_failed: ${updateError.message}`,
          deliveryResult,
        });
        continue;
      }

      void audit({
        actorClerkId: userId,
        action: 'UPDATE',
        resource: 'AgentDraft',
        resourceId: draftId,
        spaceId: space.id,
        metadata: {
          newStatus: finalStatus,
          contactId: existing.contactId,
          channel: existing.channel,
          deliverySent: deliveryResult.sent,
          deliveryError: deliveryResult.error,
          batch: true,
        },
      });

      results.push({
        draftId,
        ok: true,
        status: finalStatus,
        deliveryResult,
      });
    } catch (err) {
      logger.warn('[batch-approve] per-draft error', { draftId, spaceId: space.id }, err as Error);
      results.push({ draftId, ok: false, error: (err as Error).message ?? 'unknown_error' });
    }
  }

  return NextResponse.json({ results });
}
