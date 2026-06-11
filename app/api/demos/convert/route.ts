import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireSpaceOwner } from '@/lib/api-auth';

/**
 * Convert a completed demo into a deal.
 * Pre-fills the deal with guest info and property address,
 * links the contact, and records the sourceDemoId.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, demoId } = body;

  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });
  if (!demoId) return NextResponse.json({ error: 'demoId required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  // Fetch the demo
  const { data: demo, error: demoError } = await supabase
    .from('Demo')
    .select('*')
    .eq('id', demoId)
    .eq('spaceId', space.id)
    .maybeSingle();
  if (demoError) throw demoError;
  if (!demo) return NextResponse.json({ error: 'Demo not found' }, { status: 404 });

  // Check if already converted
  const { data: existingDeal } = await supabase
    .from('Deal')
    .select('id')
    .eq('sourceDemoId', demoId)
    .maybeSingle();
  if (existingDeal) {
    return NextResponse.json({ error: 'Demo already converted to a deal', dealId: existingDeal.id }, { status: 409 });
  }

  // Get the first deal stage for this space (used as default)
  const { data: firstStage } = await supabase
    .from('DealStage')
    .select('id')
    .eq('spaceId', space.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStage) {
    return NextResponse.json({ error: 'No deal stages configured. Create a deal stage first.' }, { status: 400 });
  }

  // Create or find linked contact
  let contactId = demo.contactId;
  if (!contactId) {
    // Try to find by email
    const { data: contactRow } = await supabase
      .from('Contact')
      .select('id')
      .eq('spaceId', space.id)
      .ilike('email', demo.guestEmail)
      .maybeSingle();

    if (contactRow) {
      contactId = contactRow.id;
    } else {
      // Create a new contact
      const newContactId = crypto.randomUUID();
      const { error: contactErr } = await supabase.from('Contact').insert({
        id: newContactId,
        spaceId: space.id,
        name: demo.guestName,
        email: demo.guestEmail,
        phone: demo.guestPhone || null,
        type: 'DEMO',
        tags: ['from-demo'],
        // 'unscored' violates contact_scoring_status_check (pending|scored|failed);
        // it silently failed the insert so the deal was created with no contact link.
        scoringStatus: 'pending',
      });
      if (!contactErr) contactId = newContactId;
    }
  }

  // Determine the next position in the first stage
  const { data: maxPositionRow } = await supabase
    .from('Deal')
    .select('position')
    .eq('stageId', firstStage.id)
    .eq('spaceId', space.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPosition = maxPositionRow ? maxPositionRow.position + 1 : 0;

  // Create the deal
  const dealId = crypto.randomUUID();
  const { data: deal, error: dealError } = await supabase
    .from('Deal')
    .insert({
      id: dealId,
      spaceId: space.id,
      title: demo.propertyAddress
        ? `${demo.guestName} — ${demo.propertyAddress}`
        : `${demo.guestName} — Demo Follow-up`,
      address: demo.propertyAddress || null,
      description: `Converted from demo on ${new Date(demo.startsAt).toLocaleDateString()}${demo.notes ? `\n\nDemo notes: ${demo.notes}` : ''}`,
      stageId: firstStage.id,
      status: 'active',
      priority: 'MEDIUM',
      position: nextPosition,
      milestones: [],
      sourceDemoId: demoId,
    })
    .select()
    .single();
  if (dealError) throw dealError;

  // Link contact to deal
  if (contactId) {
    const { error: dcError } = await supabase.from('DealContact').insert({ dealId, contactId });
    if (dcError) console.error('[convert] DealContact link failed:', dcError);
    // Update demo with contact link if it wasn't set
    if (!demo.contactId) {
      await supabase.from('Demo').update({ contactId }).eq('id', demoId);
    }
  }

  return NextResponse.json({ deal, contactId }, { status: 201 });
}
