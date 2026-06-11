/**
 * Shared helpers for the client-portal auth routes. Kept tiny on purpose —
 * input validation + rate-limit keying live here so each route reads as the
 * flow it implements, not a wall of guards.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

/** Password policy: 8–200 chars. We don't dictate composition — length is the
 *  honest signal of strength and composition rules just push users to "P@ss1". */
export function validPassword(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 200;
}

export function validCode(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{6}$/.test(raw.trim());
}

/** Per-IP + per-email rate limit on an auth action. Returns a 429 response on
 *  trip, or null to proceed. Both keys must pass. */
export async function authRateLimit(
  req: NextRequest,
  action: string,
  email: string | null,
  max = 8,
  windowSeconds = 600,
): Promise<NextResponse | null> {
  const ip = getClientIp(req);
  const ipCheck = await checkRateLimit(`clients:${action}:ip:${ip}`, max, windowSeconds);
  if (!ipCheck.allowed) return tooMany();
  if (email) {
    const emailCheck = await checkRateLimit(`clients:${action}:email:${email}`, max, windowSeconds);
    if (!emailCheck.allowed) return tooMany();
  }
  return null;
}

function tooMany(): NextResponse {
  return NextResponse.json(
    { error: 'Too many attempts. Wait a few minutes and try again.' },
    { status: 429 },
  );
}

export async function readJson(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
