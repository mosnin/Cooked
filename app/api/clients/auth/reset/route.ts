import { NextResponse, type NextRequest } from 'next/server';
import {
  consumeCode,
  findClientByEmail,
  markEmailVerified,
  setClientPassword,
  startSession,
} from '@/lib/client-auth';
import { authRateLimit, normalizeEmail, readJson, validCode, validPassword } from '../_shared';

export const runtime = 'nodejs';

/**
 * POST /api/clients/auth/reset — consume a reset code, set the new password,
 * and open a session. A successful reset also marks the email verified (a
 * code delivered to the inbox proves ownership).
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const code = body.code;
  const password = body.password;

  if (!email || !validCode(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code.' }, { status: 400 });
  }
  if (!validPassword(password)) {
    return NextResponse.json({ error: 'Use at least 8 characters.' }, { status: 400 });
  }

  const limited = await authRateLimit(req, 'reset', email);
  if (limited) return limited;

  const ok = await consumeCode(email, code.trim(), 'reset');
  if (!ok) {
    return NextResponse.json({ error: 'That code is wrong or expired.' }, { status: 400 });
  }

  await setClientPassword(email, password);
  await markEmailVerified(email);
  const user = await findClientByEmail(email);
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 });
  await startSession(user);
  return NextResponse.json({ ok: true });
}
