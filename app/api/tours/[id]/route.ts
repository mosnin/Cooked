import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { sendTourFollowUp, type TourEmailData } from '@/lib/tour-emails';
import { fireAgentTrigger } from '@/lib/agent/fire-trigger';
import { deleteGoogleEvent } from '@/lib/gcal-helpers';

async function resolveTour(userId: string, tourId: string) {
  const { data: tour, error } = await supabase.from('Tour').select('*').eq('id', tourId).maybeSingle();
  if (error) throw error;
  if (!tour) return null;
  const space = await getSpaceForUser(userId);
  if (!space || tour.spaceId !== space.id) return null;
  return { tour, space };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const ctx = await resolveTour(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(ctx.tour);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const ctx = await resolveTour(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  const VALID_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // Enforce valid status transitions to prevent bypassing business rules
  if (body.status !== undefined && body.status !== ctx.tour.status) {
    const current = ctx.tour.status as string;
    const next = body.status as string;
    // Once a tour is completed or no_show, it cannot be moved back to active states
    if ((current === 'completed' || current === 'no_show') && (next === 'scheduled' || next === 'confirmed')) {
      return NextResponse.json({ error: `Cannot transition from '${current}' to '${next}'` }, { status: 400 });
    }
  }

  // Whitelist and validate allowed fields
  const update: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.status !== undefined) update.status = body.status;
  if (body.guestName !== undefined) {
    if (typeof body.guestName !== 'string' || body.guestName.length > 200) return NextResponse.json({ error: 'Invalid guestName' }, { status: 400 });
    update.guestName = body.guestName;
  }
  if (body.guestEmail !== undefined) {
    if (typeof body.guestEmail !== 'string' || body.guestEmail.length > 254) return NextResponse.json({ error: 'Invalid guestEmail' }, { status: 400 });
    update.guestEmail = body.guestEmail;
  }
  if (body.guestPhone !== undefined) {
    if (body.guestPhone && (typeof body.guestPhone !== 'string' || body.guestPhone.length > 50)) return NextResponse.json({ error: 'Invalid guestPhone' }, { status: 400 });
    update.guestPhone = body.guestPhone || null;
  }
  if (body.propertyAddress !== undefined) {
    if (body.propertyAddress && (typeof body.propertyAddress !== 'string' || body.propertyAddress.length > 500)) return NextResponse.json({ error: 'Invalid propertyAddress' }, { status: 400 });
    update.propertyAddress = body.propertyAddress || null;
  }
  if (body.notes !== undefined) {
    if (body.notes && (typeof body.notes !== 'string' || body.notes.length > 2000)) return NextResponse.json({ error: 'Invalid notes' }, { status: 400 });
    update.notes = body.notes || null;
  }
  if (body.startsAt !== undefined) {
    const d = new Date(body.startsAt);
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid startsAt' }, { status: 400 });
    update.startsAt = d.toISOString();
  }
  if (body.endsAt !== undefined) {
    const d = new Date(body.endsAt);
    if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid endsAt' }, { status: 400 });
    update.endsAt = d.toISOString();
  }
  // Cross-validate the effective start/end range
  const effectiveStart = update.startsAt ?? ctx.tour.startsAt;
  const effectiveEnd = update.endsAt ?? ctx.tour.endsAt;
  if (new Date(effectiveEnd as string) <= new Date(effectiveStart as string)) {
    return NextResponse.json({ error: 'endsAt must be after startsAt' }, { status: 400 });
  }
  // Validate the new contactId belongs to the SAME space — without this,
  // an owner could link their tour to a contact from another space, and
  // the /[id]/prep route would then pull cross-space contact data into
  // this tour's prep card.
  if (body.contactId !== undefined) {
    if (body.contactId) {
      const { data: contactRow, error: cErr } = await supabase
        .from('Contact')
        .select('id')
        .eq('id', body.contactId)
        .eq('spaceId', ctx.space.id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!contactRow) {
        return NextResponse.json({ error: 'Contact not found in this space' }, { status: 400 });
      }
      update.contactId = contactRow.id;
    } else {
      update.contactId = null;
    }
  }

  const { data, error } = await supabase
    .from('Tour')
    .update(update)
    .eq('id', id)
    // resolveTour proved space ownership at read time; scope the write
    // by spaceId too so a between-check-and-write reassignment can't
    // cross-tenant the row.
    .eq('spaceId', ctx.space.id)
    .select()
    .single();
  if (error) throw error;

  // Auto-create follow-up reminder when tour is completed (24h later)
  if (body.status === 'completed' && ctx.tour.status !== 'completed' && data.contactId) {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from('Contact')
      .update({ followUpAt, type: 'TOUR' })
      .eq('id', data.contactId)
      .is('followUpAt', null)
      .then(({ error: fuErr }) => { if (fuErr) console.error('[tour] Follow-up set failed:', fuErr); });

    // Log activity on the contact
    supabase.from('ContactActivity').insert({
      id: crypto.randomUUID(),
      contactId: data.contactId,
      spaceId: ctx.space.id,
      type: 'follow_up',
      content: `Auto follow-up set for 24h after tour completion${data.propertyAddress ? ` — ${data.propertyAddress}` : ''}`,
    }).then(({ error: actErr }) => { if (actErr) console.error('[tour] Activity log failed:', actErr); });
  }

  // Auto-set follow-up for no-shows (48h later)
  if (body.status === 'no_show' && ctx.tour.status !== 'no_show' && data.contactId) {
    const followUpAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    supabase
      .from('Contact')
      .update({ followUpAt })
      .eq('id', data.contactId)
      .is('followUpAt', null)
      .then(({ error: fuErr }) => { if (fuErr) console.error('[tour] No-show follow-up failed:', fuErr); });
  }

  // Send follow-up email when marked completed
  if (body.status === 'completed' && ctx.tour.status !== 'completed') {
    const { data: settings } = await supabase
      .from('SpaceSetting')
      .select('businessName')
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    const { data: spaceRow } = await supabase.from('Space').select('name, slug').eq('id', ctx.space.id).maybeSingle();
    const emailData: TourEmailData = {
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      propertyAddress: data.propertyAddress,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      businessName: settings?.businessName || spaceRow?.name || '',
      tourId: data.id,
      slug: spaceRow?.slug ?? '',
    };
    try { await sendTourFollowUp(emailData); } catch (e) { console.error('[tours] follow-up email failed:', e); }
  }

  // Fire the agent trigger on tour completion so Chippi reacts in real
  // time (drafts a thank-you, asks for feedback, suggests next steps)
  // instead of waiting for the 4-hour cron sweep. Never fails the response.
  if (body.status === 'completed' && ctx.tour.status !== 'completed') {
    try {
      await fireAgentTrigger({
        spaceId: ctx.space.id,
        event: 'tour_completed',
        contactId: data.contactId ?? undefined,
      });
    } catch (e) {
      console.error('[tours/PATCH] agent trigger failed:', e);
    }
  }

  // Tour was cancelled — drop the mirrored Google Calendar event so the
  // realtor's calendar doesn't keep a ghost slot for an appointment that
  // isn't happening. Fire-and-forget: the DB is the source of truth and
  // we already responded to the client; a GCal hiccup orphans the event
  // and lib/gcal-helpers logs it for ops to chase manually.
  if (
    body.status === 'cancelled' &&
    ctx.tour.status !== 'cancelled' &&
    ctx.tour.googleEventId
  ) {
    void deleteGoogleEvent({
      spaceId: ctx.space.id,
      googleEventId: ctx.tour.googleEventId as string,
    }).then(async (ok) => {
      if (ok) {
        // Clear the stale id so a re-sync doesn't try to update a
        // deleted event. Best-effort — orphaned id is survivable.
        await supabase
          .from('Tour')
          .update({ googleEventId: null })
          .eq('id', id)
          .eq('spaceId', ctx.space.id);
      }
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const ctx = await resolveTour(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Capture the GCal mirror id before the delete — once the row is
  // gone we can't look it up, and the realtor's calendar would keep
  // a ghost slot indefinitely.
  const googleEventId = ctx.tour.googleEventId as string | null | undefined;

  const { error } = await supabase
    .from('Tour')
    .delete()
    .eq('id', id)
    // Scope by spaceId so the delete can't cross-tenant on reassignment.
    .eq('spaceId', ctx.space.id);
  if (error) throw error;

  // Fire-and-forget the GCal cleanup. The DB has already committed; a
  // GCal failure orphans the event and lib/gcal-helpers logs it.
  if (googleEventId) {
    void deleteGoogleEvent({ spaceId: ctx.space.id, googleEventId });
  }

  return NextResponse.json({ success: true });
}
