/**
 * ICPs — Ideal Customer Profiles a space practices against.
 *
 * An Icp captures the kind of prospect a rep sells to as a structured persona
 * (industry, company size, role, pain points, objections, budget band, buying
 * process, temperament). Axil draws on it to roleplay a realistic prospect in a
 * mock sales call, and the same shape feeds the post-call coaching rubric.
 *
 * This module owns:
 *   - the `Icp` / `IcpPersona` row + persona types,
 *   - defensive normalization of a free-form persona payload coming off the
 *     wire (the column is JSONB, so the API trusts nothing),
 *   - the space-scoped CRUD the API route delegates to.
 *
 * Everything is space-scoped exactly like the rest of the rep-facing substrate
 * (CallLog, Contact, Deal): every read/write filters by `spaceId`. The seeded
 * defaults (`isDefault: true`, `spaceId: null`) are global and read-only — a
 * space sees its own ICPs plus the three starters, and may clone a default into
 * its own editable ICP but never mutates the shared row.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────────

/** The structured persona stored on `Icp.persona` (JSONB). All fields optional
 *  on the wire; `normalizePersona` fills the array fields and trims strings so
 *  downstream prompt-building never has to null-check. */
export interface IcpPersona {
  industry: string;
  company_size: string;
  role: string;
  pain_points: string[];
  objections: string[];
  budget_band: string;
  buying_process: string;
  temperament: string;
}

/** One ICP row as the API returns it. `spaceId` is null for the seeded defaults. */
export interface Icp {
  id: string;
  spaceId: string | null;
  name: string;
  description: string | null;
  persona: IcpPersona;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Selected columns — explicit so a column add never silently widens the API. */
export const ICP_COLUMNS =
  'id, spaceId, name, description, persona, isDefault, createdBy, createdAt, updatedAt';

// Guard rails on free-form text so a hand-crafted payload can't bloat a row or
// the prompt we build from it. Generous — a real persona is a sentence or two.
const MAX_NAME = 120;
const MAX_DESCRIPTION = 600;
const MAX_FIELD = 400;
const MAX_LIST_ITEM = 200;
const MAX_LIST_LEN = 12;

const PERSONA_STRING_FIELDS = [
  'industry',
  'company_size',
  'role',
  'budget_band',
  'buying_process',
  'temperament',
] as const;

const PERSONA_LIST_FIELDS = ['pain_points', 'objections'] as const;

function clampString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max).trimEnd() : trimmed;
}

/** Coerce an arbitrary value into a clean string[] — drops non-strings and
 *  blanks, trims + caps each item, and caps the list length. Accepts a single
 *  string (split on newlines/commas) for forgiving form input. */
function clampList(value: unknown): string[] {
  let items: unknown[];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    items = value.split(/[\n,]+/);
  } else {
    return [];
  }
  const out: string[] = [];
  for (const item of items) {
    const s = clampString(item, MAX_LIST_ITEM);
    if (s) out.push(s);
    if (out.length >= MAX_LIST_LEN) break;
  }
  return out;
}

/**
 * Normalize a free-form persona payload into the canonical `IcpPersona`. Pure,
 * total, and defensive: unknown keys are dropped, missing fields default to ''
 * or [], everything is trimmed and length-capped. The DB column is JSONB so the
 * API never trusts the body — this is the single choke-point that shapes it.
 */
export function normalizePersona(raw: unknown): IcpPersona {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const persona = {} as IcpPersona;
  for (const field of PERSONA_STRING_FIELDS) {
    persona[field] = clampString(obj[field], MAX_FIELD);
  }
  for (const field of PERSONA_LIST_FIELDS) {
    persona[field] = clampList(obj[field]);
  }
  return persona;
}

/** Validation result for a create/update payload. */
export type IcpInputResult =
  | { ok: true; value: { name: string; description: string | null; persona: IcpPersona } }
  | { ok: false; error: string };

/**
 * Validate + normalize an ICP create/update body. The only hard requirement is
 * a non-empty name; the persona is best-effort normalized. Returns a tagged
 * result so the route maps `{ ok: false }` straight to a 400.
 */
export function validateIcpInput(body: unknown): IcpInputResult {
  const obj = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = clampString(obj.name, MAX_NAME);
  if (!name) return { ok: false, error: 'Give this profile a name.' };
  const description = clampString(obj.description, MAX_DESCRIPTION);
  return {
    ok: true,
    value: {
      name,
      description: description || null,
      persona: normalizePersona(obj.persona),
    },
  };
}

/** Coerce a DB row (persona is `unknown` JSONB) into a typed `Icp`. */
function rowToIcp(row: Record<string, unknown>): Icp {
  return {
    id: row.id as string,
    spaceId: (row.spaceId as string | null) ?? null,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    persona: normalizePersona(row.persona),
    isDefault: Boolean(row.isDefault),
    createdBy: (row.createdBy as string | null) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

// ── CRUD (space-scoped) ──────────────────────────────────────────────────────

/**
 * List the ICPs a space can practice against: its own ICPs plus the global
 * seeded defaults (`spaceId IS NULL`). Defaults sort last so a space's own
 * profiles lead the picker; within each group, newest first.
 */
export async function listIcps(db: SupabaseClient, spaceId: string): Promise<Icp[]> {
  const { data, error } = await db
    .from('Icp')
    .select(ICP_COLUMNS)
    .or(`spaceId.eq.${spaceId},spaceId.is.null`)
    .order('isDefault', { ascending: true })
    .order('createdAt', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToIcp(r as Record<string, unknown>));
}

/**
 * Fetch one ICP visible to a space — either owned by it or a global default.
 * Returns null when the id doesn't exist or belongs to another space (so a
 * caller can't read another workspace's ICP by guessing an id).
 */
export async function getIcp(
  db: SupabaseClient,
  spaceId: string,
  icpId: string,
): Promise<Icp | null> {
  const { data, error } = await db
    .from('Icp')
    .select(ICP_COLUMNS)
    .eq('id', icpId)
    .or(`spaceId.eq.${spaceId},spaceId.is.null`)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToIcp(data as Record<string, unknown>) : null;
}

/** Insert a new ICP owned by the space. */
export async function createIcp(
  db: SupabaseClient,
  args: {
    spaceId: string;
    createdBy: string;
    name: string;
    description: string | null;
    persona: IcpPersona;
  },
): Promise<Icp> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('Icp')
    .insert({
      spaceId: args.spaceId,
      createdBy: args.createdBy,
      name: args.name,
      description: args.description,
      persona: args.persona,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    })
    .select(ICP_COLUMNS)
    .single();
  if (error) throw error;
  return rowToIcp(data as Record<string, unknown>);
}

/**
 * Update a space-owned ICP. Scoped to `spaceId` AND `isDefault = false` so the
 * shared seeded defaults can never be mutated through this path. Returns null
 * when nothing matched (missing, another space's, or a default).
 */
export async function updateIcp(
  db: SupabaseClient,
  args: {
    spaceId: string;
    icpId: string;
    name: string;
    description: string | null;
    persona: IcpPersona;
  },
): Promise<Icp | null> {
  const { data, error } = await db
    .from('Icp')
    .update({
      name: args.name,
      description: args.description,
      persona: args.persona,
      updatedAt: new Date().toISOString(),
    })
    .eq('id', args.icpId)
    .eq('spaceId', args.spaceId)
    .eq('isDefault', false)
    .select(ICP_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToIcp(data as Record<string, unknown>) : null;
}

/**
 * Delete a space-owned ICP. Like update, scoped to the space and to
 * non-defaults. Returns true when a row was removed. Past MockCalls that
 * referenced it keep their transcript — the FK is ON DELETE SET NULL.
 */
export async function deleteIcp(
  db: SupabaseClient,
  spaceId: string,
  icpId: string,
): Promise<boolean> {
  const { data, error } = await db
    .from('Icp')
    .delete()
    .eq('id', icpId)
    .eq('spaceId', spaceId)
    .eq('isDefault', false)
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
}
