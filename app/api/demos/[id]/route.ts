import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { sendDemoFollowUp, type DemoEmailData } from '@/lib/demo-emails';
import { fireAgentTrigger } from '@/lib/agent/fire-trigger';
import { deleteGoogleEvent } from '@/lib/gcal-helpers';

async function resolveDemo(userId: string, demoId: string) {
  const { data: demo, error } = await supabase.from('Demo').select('*').eq('id', demoId).maybeSingle();
  if (error) throw error;
  if (!demo) return null;
  const space = await getSpaceForUser(userId);
  if (!space || demo.spaceId !== space.id) return null;
  return { demo, space };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const ctx = await resolveDemo(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json(ctx.demo);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;
  const { id } = await params;

  const ctx = await resolveDemo(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await req.json();

  const VALID_STATUSES = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
  if (body.status !== undefined && !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // Enforce valid status transitions to prevent bypassing business rules
  if (body.status !== undefined && body.status !== ctx.demo.status) {
    const current = ctx.demo.status as string;
    const next = body.status as string;
    // Once a demo is completed or no_show, it cannot be moved back to active states
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
  const effectiveStart = update.startsAt ?? ctx.demo.startsAt;
  const effectiveEnd = update.endsAt ?? ctx.demo.endsAt;
  if (new Date(effectiveEnd as string) <= new Date(effectiveStart as string)) {
    return NextResponse.json({ error: 'endsAt must be after startsAt' }, { status: 400 });
  }
  // Validate the new contactId belongs to the SAME space — without this,
  // an owner could link their demo to a contact from another space, and
  // the /[id]/prep route would then pull cross-space contact data into
  // this demo's prep card.
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
    .from('Demo')
    .update(update)
    .eq('id', id)
    // resolveDemo proved space ownership at read time; scope the write
    // by spaceId too so a between-check-and-write reassignment can't
    // cross-tenant the row.
    .eq('spaceId', ctx.space.id)
    .select()
    .single();
  if (error) throw error;

  // Auto-create follow-up reminder when demo is completed (24h later)
  if (body.status === 'completed' && ctx.demo.status !== 'completed' && data.contactId) {
    const followUpAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from('Contact')
      .update({ followUpAt, type: 'DEMO' })
      .eq('id', data.contactId)
      .is('followUpAt', null)
      .then(({ error: fuErr }) => { if (fuErr) console.error('[demo] Follow-up set failed:', fuErr); });

    // Log activity on the contact
    supabase.from('ContactActivity').insert({
      id: crypto.randomUUID(),
      contactId: data.contactId,
      spaceId: ctx.space.id,
      type: 'follow_up',
      content: `Auto follow-up set for 24h after demo completion${data.propertyAddress ? ` — ${data.propertyAddress}` : ''}`,
    }).then(({ error: actErr }) => { if (actErr) console.error('[demo] Activity log failed:', actErr); });
  }

  // Auto-set follow-up for no-shows (48h later)
  if (body.status === 'no_show' && ctx.demo.status !== 'no_show' && data.contactId) {
    const followUpAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    supabase
      .from('Contact')
      .update({ followUpAt })
      .eq('id', data.contactId)
      .is('followUpAt', null)
      .then(({ error: fuErr }) => { if (fuErr) console.error('[demo] No-show follow-up failed:', fuErr); });
  }

  // Send follow-up email when marked completed
  if (body.status === 'completed' && ctx.demo.status !== 'completed') {
    const { data: settings } = await supabase
      .from('SpaceSetting')
      .select('businessName')
      .eq('spaceId', ctx.space.id)
      .maybeSingle();
    const { data: spaceRow } = await supabase.from('Space').select('name, slug').eq('id', ctx.space.id).maybeSingle();
    const emailData: DemoEmailData = {
      guestName: data.guestName,
      guestEmail: data.guestEmail,
      guestPhone: data.guestPhone,
      propertyAddress: data.propertyAddress,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      businessName: settings?.businessName || spaceRow?.name || '',
      demoId: data.id,
      slug: spaceRow?.slug ?? '',
    };
    try { await sendDemoFollowUp(emailData); } catch (e) { console.error('[demos] follow-up email failed:', e); }
  }

  // Fire the agent trigger on demo completion so Koala reacts in real
  // time (drafts a thank-you, asks for feedback, suggests next steps)
  // instead of waiting for the 4-hour cron sweep. Never fails the response.
  if (body.status === 'completed' && ctx.demo.status !== 'completed') {
    try {
      await fireAgentTrigger({
        spaceId: ctx.space.id,
        event: 'demo_completed',
        contactId: data.contactId ?? undefined,
      });
    } catch (e) {
      console.error('[demos/PATCH] agent trigger failed:', e);
    }
  }

  // Demo was cancelled — drop the mirrored Google Calendar event so the
  // rep's calendar doesn't keep a ghost slot for an appointment that
  // isn't happening. Fire-and-forget: the DB is the source of truth and
  // we already responded to the client; a GCal hiccup orphans the event
  // and lib/gcal-helpers logs it for ops to chase manually.
  if (
    body.status === 'cancelled' &&
    ctx.demo.status !== 'cancelled' &&
    ctx.demo.googleEventId
  ) {
    void deleteGoogleEvent({
      spaceId: ctx.space.id,
      googleEventId: ctx.demo.googleEventId as string,
    }).then(async (ok) => {
      if (ok) {
        // Clear the stale id so a re-sync doesn't try to update a
        // deleted event. Best-effort — orphaned id is survivable.
        await supabase
          .from('Demo')
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

  const ctx = await resolveDemo(userId, id);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Capture the GCal mirror id before the delete — once the row is
  // gone we can't look it up, and the rep's calendar would keep
  // a ghost slot indefinitely.
  const googleEventId = ctx.demo.googleEventId as string | null | undefined;

  const { error } = await supabase
    .from('Demo')
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
