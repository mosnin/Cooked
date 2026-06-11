import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

/**
 * POST — Guest self-service demo management via manage token.
 * Actions: cancel
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = await checkRateLimit(`demo-manage:${ip}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const { token, action } = await req.json();

  if (!token || !action) {
    return NextResponse.json({ error: 'token and action required' }, { status: 400 });
  }

  const { data: demo } = await supabase
    .from('Demo')
    .select('id, status, startsAt')
    .eq('manageToken', token)
    .maybeSingle();

  if (!demo) {
    return NextResponse.json({ error: 'Demo not found' }, { status: 404 });
  }

  if (action === 'cancel') {
    if (demo.status === 'cancelled') {
      return NextResponse.json({ error: 'Already cancelled' }, { status: 400 });
    }
    if (demo.status === 'completed') {
      return NextResponse.json({ error: 'Cannot cancel a completed demo' }, { status: 400 });
    }
    if (demo.status === 'no_show') {
      return NextResponse.json({ error: 'Cannot cancel a no-show demo' }, { status: 400 });
    }
    // Don't allow cancellation within 1 hour of demo
    const hourBefore = new Date(new Date(demo.startsAt).getTime() - 60 * 60 * 1000);
    if (new Date() > hourBefore) {
      return NextResponse.json(
        { error: 'Cannot cancel within 1 hour of the demo. Please contact the agent directly.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('Demo')
      .update({ status: 'cancelled', updatedAt: new Date().toISOString() })
      .eq('id', demo.id);

    if (error) throw error;
    return NextResponse.json({ success: true, status: 'cancelled' });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
