import { NextResponse, type NextRequest } from 'next/server';
import {
  consumeCode,
  findClientByEmail,
  markEmailVerified,
  startSession,
} from '@/lib/client-auth';
import { authRateLimit, normalizeEmail, readJson, validCode } from '../_shared';

export const runtime = 'nodejs';

/**
 * POST /api/clients/auth/verify — consume a verify code, mark the email
 * verified, and open a session. Generic failure copy on a bad/expired code.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const code = body.code;

  if (!email || !validCode(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
  }

  const limited = await authRateLimit(req, 'verify', email);
  if (limited) return limited;

  const ok = await consumeCode(email, code.trim(), 'verify');
  if (!ok) {
    return NextResponse.json({ error: 'That code is wrong or expired.' }, { status: 400 });
  }

  await markEmailVerified(email);
  const user = await findClientByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  }
  await startSession(user);
  return NextResponse.json({ ok: true });
}
