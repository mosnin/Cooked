import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/applications/portal/demo/[demoId]/respond
 *
 * Public endpoint — applicant confirms or declines a demo from the portal.
 * Auth pattern matches /api/applications/portal/message and demo-request:
 * applicationRef + statusPortalToken on the Contact, plus the demo must be
 * linked to that same contact.
 *
 * On success:
 *   - Demo.status flipped to 'confirmed' (action='confirm') or 'cancelled'
 *     (action='decline')
 *   - ApplicationMessage row added so the rep sees the response in the
 *     existing thread + so the applicant has receipt in their own thread
 *
 * Idempotent: confirming an already-confirmed demo is a no-op success.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ demoId: string }> },
) {
  const { demoId } = await ctx.params;
  if (!demoId || typeof demoId !== 'string' || demoId.length > 64) {
    return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
  }

  let body: {
    applicationRef?: string;
    token?: string;
    action?: 'confirm' | 'decline';
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { applicationRef, token, action, notes } = body;

  if (!applicationRef || !token || !action) {
    return NextResponse.json(
      { error: 'applicationRef, token, and action are required' },
      { status: 400 },
    );
  }
  if (action !== 'confirm' && action !== 'decline') {
    return NextResponse.json(
      { error: "action must be 'confirm' or 'decline'" },
      { status: 400 },
    );
  }
  if (
    typeof applicationRef !== 'string' || applicationRef.length < 10 || applicationRef.length > 64 ||
    typeof token !== 'string' || token.length < 32 || token.length > 128
  ) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  // Rate limit — applicants don't normally respond to demos dozens of times
  const ip = getClientIp(req);
  const { allowed: ipAllowed } = await checkRateLimit(`portal:demo-respond:ip:${ip}`, 30, 3600);
  if (!ipAllowed) {
    return NextResponse.json(
      { error: 'Too many requests. Try again in a bit.' },
      { status: 429, headers: { 'Retry-After': '3600' } },
    );
  }

  // Verify token + application
  const { data: contact, error: contactError } = await supabase
    .from('Contact')
    .select('id, spaceId, name')
    .eq('applicationRef', applicationRef)
    .eq('statusPortalToken', token)
    .maybeSingle();

  if (contactError) {
    console.error('[portal/demo-respond] Contact lookup error:', contactError);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!contact) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  // Validate demo belongs to this contact + space (defense in depth)
  const { data: demo, error: demoError } = await supabase
    .from('Demo')
    .select('id, spaceId, contactId, status, startsAt, propertyAddress')
    .eq('id', demoId)
    .maybeSingle();

  if (demoError) {
    console.error('[portal/demo-respond] Demo lookup error:', demoError);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
  if (!demo || demo.contactId !== contact.id || demo.spaceId !== contact.spaceId) {
    return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
  }

  // Idempotent — confirming already-confirmed is a successful no-op.
  // Cancelling an already-cancelled is the same. Don't post duplicate messages.
  const targetStatus = action === 'confirm' ? 'confirmed' : 'cancelled';
  if (demo.status === targetStatus) {
    return NextResponse.json({ ok: true, demo: { id: demo.id, status: demo.status } });
  }

  // Reject illogical transitions — e.g. don't let an applicant confirm a
  // demo that's already been completed or cancelled by the rep.
  if (demo.status === 'completed' || demo.status === 'no_show') {
    return NextResponse.json(
      { error: 'This demo is closed and can no longer be changed.' },
      { status: 409 },
    );
  }
  if (demo.status === 'cancelled' && action === 'confirm') {
    return NextResponse.json(
      { error: 'This demo was cancelled. Ask your rep to reschedule.' },
      { status: 409 },
    );
  }

  // Compare-and-swap on the demo status: only update if it's still in the
  // status we read above. Two parallel calls (network glitch + applicant
  // double-click) without CAS would both pass the L107 idempotency check
  // (status was 'scheduled' for both), both run an unguarded UPDATE, and
  // both insert their receipt message — cluttering the rep's thread
  // with duplicates. With CAS, only the first writer's UPDATE returns a
  // row; the second sees zero affected rows and skips the message insert.
  const { data: updated, error: updateError } = await supabase
    .from('Demo')
    .update({ status: targetStatus, updatedAt: new Date().toISOString() })
    .eq('id', demoId)
    .eq('spaceId', contact.spaceId)
    .eq('status', demo.status)
    .select('id');
  if (updateError) {
    console.error('[portal/demo-respond] Demo update error:', updateError);
    return NextResponse.json({ error: 'Failed to update demo' }, { status: 500 });
  }

  // Lost the CAS — another concurrent caller already moved the demo.
  // Return a clean success without inserting a duplicate message; the
  // first writer's message is already on the thread.
  if (!updated || updated.length === 0) {
    return NextResponse.json({
      ok: true,
      demo: { id: demo.id, status: targetStatus },
    });
  }

  // Compose receipt message for the thread.
  const sanitize = (s: string) =>
    s
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/[^\w\s.,!?;:'"@#$%&*()\-/+=\[\]{}~`^\n\r\t]/g, '');
  const safeNotes = sanitize((notes ?? '').trim()).slice(0, 1000);
  const demoTime = new Date(demo.startsAt).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const propLine = demo.propertyAddress ? ` at ${sanitize(demo.propertyAddress).slice(0, 200)}` : '';
  const messageBody =
    action === 'confirm'
      ? `✓ Confirmed demo ${demoTime}${propLine}.${safeNotes ? `\n\n${safeNotes}` : ''}`
      : `✗ Can't make demo ${demoTime}${propLine}.${safeNotes ? `\n\n${safeNotes}` : ''}`;

  await supabase
    .from('ApplicationMessage')
    .insert({
      contactId: contact.id,
      spaceId: contact.spaceId,
      senderType: 'applicant',
      content: messageBody,
    });

  return NextResponse.json({
    ok: true,
    demo: { id: demo.id, status: targetStatus },
  });
}
