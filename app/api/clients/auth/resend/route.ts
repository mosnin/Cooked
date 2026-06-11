import { NextResponse, type NextRequest } from 'next/server';
import { findClientByEmail, issueCode } from '@/lib/client-auth';
import { sendClientCode } from '@/lib/client-email';
import { authRateLimit, normalizeEmail, readJson } from '../_shared';

export const runtime = 'nodejs';

/**
 * POST /api/clients/auth/resend — re-issue a verify code. Always responds ok
 * (no enumeration); only actually issues + sends when the account exists and
 * isn't already verified.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });

  const limited = await authRateLimit(req, 'resend', email, 5, 600);
  if (limited) return limited;

  const user = await findClientByEmail(email);
  if (user && !user.emailVerifiedAt) {
    const code = await issueCode(email, 'verify');
    if (code) await sendClientCode({ to: email, code, purpose: 'verify' });
  }

  return NextResponse.json({ ok: true });
}
