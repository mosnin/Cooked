import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getSpaceFromSlug } from '@/lib/space';
import { sendDemoConfirmation, type DemoEmailData } from '@/lib/demo-emails';
import { notifyNewDemo } from '@/lib/notify';
import { sendSMS, demoConfirmationSMS } from '@/lib/sms';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/** Public endpoint — guests book a demo without authentication. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Per-IP cap — tightened from 10 to 3/hour. The booking endpoint sends a
  // real-looking confirmation email to whatever `guestEmail` is provided,
  // which is a platform-as-spammer amplifier. A single IP shouldn't be
  // legitimately booking 3+ demos per hour.
  const { allowed } = await checkRateLimit(`book:rl:${ip}`, 3, 3600);
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 });

  const body = await req.json();
  const { slug, guestName, guestEmail, guestPhone, propertyAddress, notes, startsAt, propertyProfileId } = body;

  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  if (!guestName?.trim() || !guestEmail?.trim() || !startsAt) {
    return NextResponse.json({ error: 'guestName, guestEmail, startsAt required' }, { status: 400 });
  }

  // Length check FIRST — defends against running the regex on a multi-MB
  // string (ReDoS-ish CPU burn).
  if (guestEmail.length > 254) {
    return NextResponse.json({ error: 'Email too long' }, { status: 400 });
  }
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(guestEmail.trim())) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }

  // Input length validation to prevent storage DoS
  if (guestName.length > 200) return NextResponse.json({ error: 'Name too long' }, { status: 400 });
  if (guestPhone && guestPhone.length > 50) return NextResponse.json({ error: 'Phone too long' }, { status: 400 });
  if (propertyAddress && propertyAddress.length > 500) return NextResponse.json({ error: 'Address too long' }, { status: 400 });
  if (notes && notes.length > 2000) return NextResponse.json({ error: 'Notes too long' }, { status: 400 });

  const space = await getSpaceFromSlug(slug);
  if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

  // Per-space cap — catches distributed attacks (botnets rotating IPs) hitting
  // a single victim space. A real space gets at most a handful of bookings per
  // hour; 20 is well above legitimate traffic and well below the daily volume
  // a spammer would want.
  const spaceCheck = await checkRateLimit(`book:space:${space.id}`, 20, 3600);
  if (!spaceCheck.allowed) {
    return NextResponse.json({ error: 'Too many requests for this space' }, { status: 429 });
  }

  // Get duration from settings
  const { data: settings } = await supabase
    .from('SpaceSetting')
    .select('demoDuration')
    .eq('spaceId', space.id)
    .maybeSingle();
  let duration = settings?.demoDuration ?? 30;

  // Validate propertyProfileId belongs to this space before using it,
  // and use its demo duration if available
  let validPropertyProfileId: string | null = null;
  if (propertyProfileId) {
    const { data: profileRow } = await supabase
      .from('DemoPropertyProfile')
      .select('id, demoDuration')
      .eq('id', propertyProfileId)
      .eq('spaceId', space.id)
      .eq('isActive', true)
      .maybeSingle();
    if (profileRow) {
      validPropertyProfileId = profileRow.id;
      duration = profileRow.demoDuration;
    }
    // If profile not found or not active, proceed without it (don't block booking)
  }

  const start = new Date(startsAt);
  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: 'Invalid startsAt' }, { status: 400 });
  }
  if (start.getTime() < Date.now()) {
    return NextResponse.json({ error: 'Cannot book in the past' }, { status: 400 });
  }

  const end = new Date(start.getTime() + duration * 60 * 1000);

  // Try to match to existing contact by email, or create one
  let contactId: string | null = null;
  const { data: contactRow } = await supabase
    .from('Contact')
    .select('id')
    .eq('spaceId', space.id)
    .ilike('email', guestEmail.trim())
    .maybeSingle();

  if (contactRow) {
    contactId = contactRow.id;
    // Set source attribution if not already set. Awaited — the prior
    // fire-and-forget pattern could be GC'd on a cold Vercel function
    // before the update committed, so first-touch attribution was missed
    // intermittently. Cost is one extra serial query; the route already
    // does several.
    const { error: srcErr } = await supabase
      .from('Contact')
      .update({ sourceLabel: 'demo-booking' })
      .eq('id', contactId)
      .eq('spaceId', space.id)
      .is('sourceLabel', null);
    if (srcErr) console.error('[book] Source update failed:', srcErr);
  } else {
    // Auto-create a contact for this demo guest
    const newContactId = crypto.randomUUID();
    const { error: createErr } = await supabase.from('Contact').insert({
      id: newContactId,
      spaceId: space.id,
      name: guestName.trim(),
      email: guestEmail.trim().toLowerCase(),
      phone: guestPhone?.trim() || null,
      address: propertyAddress?.trim() || null,
      type: 'DEMO',
      tags: ['demo-booking'],
      sourceLabel: 'demo-booking',
      // `'unscored'` violated the CHECK constraint
      // (`contact_scoring_status_check` allows pending/scored/failed only),
      // so every auto-create silently failed and the demo was booked with
      // a NULL contactId — losing attribution and breaking follow-ups.
      scoringStatus: 'pending',
    });
    if (!createErr) {
      contactId = newContactId;
    } else {
      console.error('[book] Auto-create contact failed:', createErr);
    }
  }

  // Generate a cryptographically secure manage token (256-bit entropy)
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const manageToken = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, '0')).join('');

  // Atomic booking via DB function — conflict check + insert in a single
  // transaction with row-level locking to prevent double-booking.
  const demoId = crypto.randomUUID();
  const { data: bookedId, error: rpcError } = await supabase.rpc('book_demo_atomic', {
    p_id: demoId,
    p_space_id: space.id,
    p_contact_id: contactId,
    p_guest_name: guestName.trim(),
    p_guest_email: guestEmail.trim().toLowerCase(),
    p_guest_phone: guestPhone?.trim() || null,
    p_property_address: propertyAddress?.trim() || null,
    p_notes: notes?.trim() || null,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_property_profile_id: validPropertyProfileId,
    p_manage_token: manageToken,
  });
  if (rpcError) throw rpcError;

  // NULL return means a conflicting demo was found
  if (!bookedId) {
    return NextResponse.json({ error: 'This time slot is no longer available' }, { status: 409 });
  }

  // Fetch the created demo for the response
  const { data: demo, error: fetchError } = await supabase
    .from('Demo')
    .select('*')
    .eq('id', demoId)
    .single();
  if (fetchError) throw fetchError;

  // Send confirmation email (non-blocking)
  const { data: settingsFull } = await supabase
    .from('SpaceSetting')
    .select('businessName')
    .eq('spaceId', space.id)
    .maybeSingle();
  const emailData: DemoEmailData = {
    guestName: demo.guestName,
    guestEmail: demo.guestEmail,
    guestPhone: demo.guestPhone,
    propertyAddress: demo.propertyAddress,
    startsAt: demo.startsAt,
    endsAt: demo.endsAt,
    businessName: settingsFull?.businessName || space.name,
    demoId: demo.id,
    slug,
  };
  try { await sendDemoConfirmation(emailData); } catch (e) { console.error('[demos] confirmation email failed:', e); }

  // Send SMS confirmation to guest
  if (demo.guestPhone) {
    const d = new Date(demo.startsAt);
    try {
      await sendSMS(
        demoConfirmationSMS({
          guestName: demo.guestName,
          guestPhone: demo.guestPhone,
          businessName: settingsFull?.businessName || space.name,
          date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
          property: demo.propertyAddress,
        })
      );
    } catch (e) { console.error('[demos] SMS confirmation failed:', e); }
  }

  // Notify the space owner (email + SMS via unified dispatcher)
  try { await notifyNewDemo({ spaceId: space.id, demoData: emailData }); } catch (e) { console.error('[demos] owner notification failed:', e); }

  return NextResponse.json(demo, { status: 201 });
}
