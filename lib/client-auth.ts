/**
 * Client-portal auth — fully separate from the realtor Clerk auth.
 *
 * Email + password accounts for end users (applicants / tour-bookers). Sessions
 * are stateless signed JWTs in an httpOnly cookie scoped to the portal; never
 * touches Clerk, Clerk cookies, or the realtor session. Passwords are scrypt
 * (node:crypto, no new dependency). Email verification + passwordless login use
 * 6-digit one-time codes (hashed at rest).
 */
import 'server-only';
import {
  scryptSync,
  randomBytes,
  randomInt,
  timingSafeEqual,
  createHash,
} from 'crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export const CLIENT_SESSION_COOKIE = 'chippi_client_session';
const SESSION_TTL = '30d';
const CODE_TTL_MINUTES = 15;
const MAX_CODE_ATTEMPTS = 6;

function sessionSecret(): Uint8Array {
  const raw = process.env.CLIENT_AUTH_SECRET || process.env.CLERK_SECRET_KEY;
  if (!raw) {
    // Fail closed: never sign client-portal sessions with a hardcoded dev
    // string — that made forged sessions trivial if both env vars were absent.
    // CLIENT_AUTH_SECRET is preferred; CLERK_SECRET_KEY stays as a fallback
    // ONLY so sessions issued before CLIENT_AUTH_SECRET was provisioned remain
    // valid (otherwise every client is logged out on deploy).
    throw new Error('CLIENT_AUTH_SECRET (or CLERK_SECRET_KEY) must be set for the client portal');
  }
  // Domain-separate from any other HMAC use of the same raw secret.
  return new TextEncoder().encode(`client-portal:${raw}`);
}

// ── Passwords ───────────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  try {
    const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
    const expected = Buffer.from(hashHex, 'hex');
    return hash.length === expected.length && timingSafeEqual(hash, expected);
  } catch {
    return false;
  }
}

// ── One-time codes ──────────────────────────────────────────────────────────

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface ClientUserRow {
  id: string;
  email: string;
  emailLower: string;
  name: string | null;
  phone: string | null;
  emailVerifiedAt: string | null;
}

const USER_COLS = 'id, email, "emailLower", name, phone, "emailVerifiedAt"';

export async function findClientByEmail(email: string): Promise<(ClientUserRow & { passwordHash: string }) | null> {
  const { data } = await supabase
    .from('ClientUser')
    .select(`${USER_COLS}, "passwordHash"`)
    .eq('emailLower', email.trim().toLowerCase())
    .maybeSingle();
  return (data as (ClientUserRow & { passwordHash: string }) | null) ?? null;
}

export async function findClientById(id: string): Promise<ClientUserRow | null> {
  const { data } = await supabase
    .from('ClientUser')
    .select(USER_COLS)
    .eq('id', id)
    .maybeSingle();
  return (data as ClientUserRow | null) ?? null;
}

export async function createClientUser(params: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
}): Promise<ClientUserRow | null> {
  const emailLower = params.email.trim().toLowerCase();
  const { data, error } = await supabase
    .from('ClientUser')
    .insert({
      email: params.email.trim(),
      emailLower,
      passwordHash: hashPassword(params.password),
      name: params.name?.trim() || null,
      phone: params.phone?.trim() || null,
    })
    .select(USER_COLS)
    .single();
  if (error) {
    logger.warn('[client-auth] createClientUser failed', { err: error.message });
    return null;
  }
  return data as ClientUserRow;
}

export async function markEmailVerified(emailLower: string): Promise<void> {
  await supabase
    .from('ClientUser')
    .update({ emailVerifiedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq('emailLower', emailLower);
}

export async function setClientPassword(emailLower: string, password: string): Promise<void> {
  await supabase
    .from('ClientUser')
    .update({ passwordHash: hashPassword(password), updatedAt: new Date().toISOString() })
    .eq('emailLower', emailLower);
}

/** Issue a one-time code, store its hash, and return the plaintext to email. */
export async function issueCode(
  email: string,
  purpose: 'verify' | 'login' | 'reset',
): Promise<string | null> {
  const emailLower = email.trim().toLowerCase();
  const code = generateCode();
  // Invalidate any prior unconsumed codes for this (email, purpose) so only the
  // newest code is ever valid — closes the window where a resend/race leaves
  // multiple live codes that each satisfy the one-time guarantee.
  await supabase
    .from('ClientAuthCode')
    .update({ consumedAt: new Date().toISOString() })
    .eq('emailLower', emailLower)
    .eq('purpose', purpose)
    .is('consumedAt', null);
  const { error } = await supabase.from('ClientAuthCode').insert({
    emailLower,
    codeHash: hashCode(code),
    purpose,
    expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
  });
  if (error) {
    logger.warn('[client-auth] issueCode failed', { purpose, err: error.message });
    return null;
  }
  return code;
}

/** Verify a code for (email, purpose). Consumes it on success. */
export async function consumeCode(
  email: string,
  code: string,
  purpose: 'verify' | 'login' | 'reset',
): Promise<boolean> {
  const emailLower = email.trim().toLowerCase();
  const { data } = await supabase
    .from('ClientAuthCode')
    .select('id, codeHash, attempts')
    .eq('emailLower', emailLower)
    .eq('purpose', purpose)
    .is('consumedAt', null)
    .gt('expiresAt', new Date().toISOString())
    .order('createdAt', { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as { id: string; codeHash: string; attempts: number } | null;
  if (!row) return false;
  if (row.attempts >= MAX_CODE_ATTEMPTS) return false;

  const ok =
    row.codeHash.length === hashCode(code).length &&
    timingSafeEqual(Buffer.from(row.codeHash, 'hex'), Buffer.from(hashCode(code), 'hex'));

  if (!ok) {
    await supabase.from('ClientAuthCode').update({ attempts: row.attempts + 1 }).eq('id', row.id);
    return false;
  }
  await supabase.from('ClientAuthCode').update({ consumedAt: new Date().toISOString() }).eq('id', row.id);
  return true;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function createSessionToken(user: ClientUserRow): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name ?? undefined })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(sessionSecret());
}

/** Set the session cookie. Call from a route handler / server action. */
export async function startSession(user: ClientUserRow): Promise<void> {
  const token = await createSessionToken(user);
  const jar = await cookies();
  jar.set(CLIENT_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(CLIENT_SESSION_COOKIE);
}

/** Current client from the session cookie, or null. Safe in server components. */
export async function getClientUser(): Promise<ClientUserRow | null> {
  const jar = await cookies();
  const token = jar.get(CLIENT_SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (!payload.sub) return null;
    return await findClientById(payload.sub);
  } catch {
    return null;
  }
}
