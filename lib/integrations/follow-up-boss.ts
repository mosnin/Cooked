/**
 * Follow Up Boss — a native CRM adapter that talks straight to the FUB REST
 * API. No Composio: FUB authenticates with a user-issued API key over HTTP
 * Basic (the key is the username, the password is blank), so wrapping it in
 * Composio's OAuth machinery would buy nothing. We own the whole call.
 *
 * Docs: https://docs.followupboss.com/  (Basic auth, base https://api.followupboss.com/v1)
 *
 * The realtor pastes their API key once (Follow Up Boss → Admin → API). We
 * validate it, encrypt it at rest, and read their People list on demand to
 * mirror it on the Smart sync surface.
 *
 * This file is pure transport + mapping — no DB, no auth. Storage lives in
 * lib/integrations/connections.ts (the encrypted key on the
 * IntegrationConnection row); the routes wire the two together.
 */

import { logger } from '@/lib/logger';
import type { SyncRecord } from '@/app/api/sync/route';

const FUB_BASE = 'https://api.followupboss.com/v1';
const REQUEST_TIMEOUT_MS = 12_000;

/** Basic auth header — FUB key as the username, blank password. */
function authHeader(apiKey: string): string {
  const token = Buffer.from(`${apiKey}:`).toString('base64');
  return `Basic ${token}`;
}

async function fubFetch(
  apiKey: string,
  path: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${FUB_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader(apiKey),
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export interface FubVerifyResult {
  ok: boolean;
  /** Human-readable account label (the FUB account name) when valid. */
  label: string | null;
  /** Set when ok=false — a realtor-friendly reason. */
  reason?: string;
}

/**
 * Validate an API key by calling the identity endpoint. A 200 means the key
 * is live; 401/403 means it's wrong. Anything else is an upstream hiccup,
 * surfaced honestly rather than silently accepting a bad key.
 */
export async function verifyApiKey(apiKey: string): Promise<FubVerifyResult> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, label: null, reason: 'Enter your Follow Up Boss API key.' };

  let res: Awaited<ReturnType<typeof fubFetch>>;
  try {
    res = await fubFetch(trimmed, '/identity');
  } catch (err) {
    logger.warn('[fub] verify request failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, label: null, reason: 'Could not reach Follow Up Boss. Try again.' };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, label: null, reason: 'That API key was rejected by Follow Up Boss.' };
  }
  if (!res.ok) {
    return { ok: false, label: null, reason: 'Follow Up Boss returned an error. Try again.' };
  }

  // /identity returns { name, account, ... } — shapes vary; pull a label best-effort.
  const obj = (res.body ?? {}) as Record<string, unknown>;
  const account = (obj.account ?? {}) as Record<string, unknown>;
  const label =
    (typeof account.name === 'string' && account.name) ||
    (typeof obj.name === 'string' && obj.name) ||
    'Follow Up Boss';
  return { ok: true, label };
}

/* ── People → SyncRecord ─────────────────────────────────────────────── */

interface FubEmail {
  value?: string;
  isPrimary?: boolean | number;
}
interface FubPhone {
  value?: string;
  isPrimary?: boolean | number;
}
interface FubPerson {
  id?: number | string;
  name?: string;
  firstName?: string;
  lastName?: string;
  stage?: string;
  source?: string;
  emails?: FubEmail[];
  phones?: FubPhone[];
  created?: string;
  updated?: string;
}

function primary<T extends { value?: string; isPrimary?: boolean | number }>(
  list: T[] | undefined,
): string | null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const flagged = list.find((x) => x.isPrimary === true || x.isPrimary === 1);
  return (flagged?.value ?? list[0]?.value ?? null) || null;
}

function mapPerson(p: FubPerson, idx: number): SyncRecord {
  const composed = [p.firstName, p.lastName].filter(Boolean).join(' ').trim();
  const email = primary(p.emails);
  return {
    id: String(p.id ?? idx),
    name: (p.name && p.name.trim()) || composed || email || '(no name)',
    email,
    phone: primary(p.phones),
    stage: (p.stage && p.stage.trim()) || null,
    lastActivityAt: p.updated ?? p.created ?? null,
    recordType: 'Person',
  };
}

/**
 * Pull the realtor's People list, most-recently-updated first, mapped to the
 * unified SyncRecord shape. Caps at `limit` (the surface is a mirror, not a
 * paginated table). Returns [] on any upstream failure — the route decides
 * how to present "connected but couldn't read".
 */
export async function listPeople(
  apiKey: string,
  limit = 50,
): Promise<{ ok: boolean; records: SyncRecord[] }> {
  let res: Awaited<ReturnType<typeof fubFetch>>;
  try {
    res = await fubFetch(
      apiKey.trim(),
      `/people?limit=${Math.min(limit, 100)}&sort=-updated`,
    );
  } catch (err) {
    logger.warn('[fub] listPeople request failed', {
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, records: [] };
  }

  if (!res.ok) {
    logger.warn('[fub] listPeople non-ok', { status: res.status });
    return { ok: false, records: [] };
  }

  const body = (res.body ?? {}) as { people?: unknown };
  const people = Array.isArray(body.people) ? (body.people as FubPerson[]) : [];
  return { ok: true, records: people.slice(0, limit).map(mapPerson) };
}
