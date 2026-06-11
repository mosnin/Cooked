/**
 * Brief email one-click unsubscribe — RFC 8058.
 *
 * GET and POST both accept ?token=<unsubscribeToken>. The token is the
 * per-space opaque value stored on SpaceSetting.unsubscribeToken at
 * insert time (or backfilled by the migration for existing rows). Hitting
 * either verb flips briefEmail to false for that space — no Clerk
 * session required.
 *
 * Gmail / Apple Mail fire a POST when the user clicks the inbox-level
 * "Unsubscribe" affordance (paired with the List-Unsubscribe-Post:
 * List-Unsubscribe=One-Click header in the email).
 *
 * The realtor's master `notifications` toggle is NOT touched. Brief
 * unsubscribe is narrow — they keep new-lead alerts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

async function unsubscribe(token: string): Promise<NextResponse> {
  if (!token || typeof token !== 'string' || token.length < 8) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 });
  }

  const { data: setting } = await supabase
    .from('SpaceSetting')
    .select('id, spaceId, briefEmail')
    .eq('unsubscribeToken', token)
    .maybeSingle();

  if (!setting) {
    // Don't leak whether the token exists — same 200 either way so
    // bots can't enumerate valid tokens.
    return htmlResponse('You&#39;re unsubscribed from the daily brief.');
  }

  if (setting.briefEmail) {
    await supabase.from('SpaceSetting').update({ briefEmail: false }).eq('id', setting.id);
  }

  return htmlResponse('You&#39;re unsubscribed from the daily brief.');
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  return unsubscribe(token);
}

export async function POST(req: NextRequest) {
  // RFC 8058: List-Unsubscribe-Post fires a POST. The token comes in
  // the query string (Gmail's behavior), or as form data on some clients.
  const fromQuery = req.nextUrl.searchParams.get('token');
  if (fromQuery) return unsubscribe(fromQuery);

  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    const token = form.get('token');
    if (typeof token === 'string') return unsubscribe(token);
  }
  return NextResponse.json({ error: 'Missing token.' }, { status: 400 });
}

function htmlResponse(message: string): NextResponse {
  const body = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:-apple-system,sans-serif;text-align:center;padding:48px 16px;color:#111827">
  <p style="font-size:14px;color:#6b7280;margin:0 0 12px">Chippi</p>
  <p style="font-size:18px;margin:0">${message}</p>
</body>
</html>`;
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
