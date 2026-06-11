import { NextResponse, type NextRequest } from 'next/server';
import { findClientByEmail, issueCode } from '@/lib/client-auth';
import { sendClientCode } from '@/lib/client-email';
import { authRateLimit, normalizeEmail, readJson } from '../_shared';

export const runtime = 'nodejs';

/**
 * POST /api/clients/auth/request-reset — send a reset code. Always responds ok
 * regardless of whether the account exists (no enumeration).
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });

  const limited = await authRateLimit(req, 'reset-req', email, 5, 600);
  if (limited) return limited;

  const user = await findClientByEmail(email);
  if (user) {
    const code = await issueCode(email, 'reset');
    if (code) await sendClientCode({ to: email, code, purpose: 'reset' });
  }

  return NextResponse.json({ ok: true });
}
