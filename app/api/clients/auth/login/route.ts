import { NextResponse, type NextRequest } from 'next/server';
import {
  findClientByEmail,
  issueCode,
  startSession,
  verifyPassword,
} from '@/lib/client-auth';
import { sendClientCode } from '@/lib/client-email';
import { authRateLimit, normalizeEmail, readJson } from '../_shared';

export const runtime = 'nodejs';

/**
 * POST /api/clients/auth/login — password sign-in.
 *
 * Generic "wrong email or password" on every failure so we never reveal which
 * field was wrong (no account enumeration). If the password is right but the
 * email isn't verified yet, we re-issue a verify code and route the client to
 * the verify screen instead of opening a session.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || password.length === 0) {
    return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
  }

  const limited = await authRateLimit(req, 'login', email);
  if (limited) return limited;

  const user = await findClientByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 });
  }

  if (!user.emailVerifiedAt) {
    const code = await issueCode(email, 'verify');
    if (code) await sendClientCode({ to: email, code, purpose: 'verify' });
    return NextResponse.json({ ok: true, next: 'verify' });
  }

  await startSession(user);
  return NextResponse.json({ ok: true, next: 'dashboard' });
}
