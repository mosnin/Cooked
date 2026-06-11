/**
 * CMA reports (realtor-facing) — GET / POST
 *
 *   GET  ?slug=<slug>  → { reports: [...] }   the space's CMAs, newest first
 *   POST { slug, subjectPropertyId? | subject:{address,...}, title? }
 *        → { report }   builds the CMA, inserts a CmaReport with a shareToken
 *
 * Auth: requireSpaceOwner(slug). Comps come from the space's own Property rows
 * (in-house, no MLS). The analysis is frozen into `payload` at insert time so
 * the public page stays stable even if the underlying rows later change.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireSpaceOwner } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { buildCma, generateShareToken, type SubjectFields } from '@/lib/cma';

export const runtime = 'nodejs';

const TITLE_MAX = 200;

// The list view never needs the (potentially large) payload — select lean.
const LIST_COLUMNS =
  'id, spaceId, subjectAddress, subjectPropertyId, shareToken, title, status, createdAt, updatedAt';

// ── GET — the space's CMAs ────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { space } = auth;

  const { data, error } = await supabase
    .from('CmaReport')
    .select(LIST_COLUMNS)
    .eq('spaceId', space.id)
    .order('createdAt', { ascending: false })
    .limit(100);

  if (error) {
    logger.error('[cma] list failed', { spaceId: space.id, err: error.message });
    return NextResponse.json({ error: 'Could not load your reports.' }, { status: 500 });
  }

  return NextResponse.json({ reports: data ?? [] });
}

// ── POST — build + persist a CMA ──────────────────────────────────────────────

interface PostBody {
  slug?: string;
  subjectPropertyId?: string;
  subject?: SubjectFields;
  title?: string;
}

function coerceSubjectFields(raw: unknown): SubjectFields | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  const address = typeof s.address === 'string' ? s.address.trim().slice(0, 500) : '';
  if (!address) return undefined;

  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

  return {
    address,
    city: str(s.city, 120),
    stateRegion: str(s.stateRegion, 120),
    beds: num(s.beds),
    baths: num(s.baths),
    squareFeet: num(s.squareFeet),
    propertyType: str(s.propertyType, 60),
    listPrice: num(s.listPrice),
  };
}

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const slug = body.slug?.trim();
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const auth = await requireSpaceOwner(slug);
  if (auth instanceof NextResponse) return auth;
  const { userId, space } = auth;

  // Building a CMA fans out to a 50-row query + scoring. 20/min is generous
  // for a human; it stops a loop from hammering the table.
  const { allowed } = await checkRateLimit(`cma:create:${userId}`, 20, 60);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  const subjectPropertyId =
    typeof body.subjectPropertyId === 'string' && body.subjectPropertyId.trim()
      ? body.subjectPropertyId.trim()
      : undefined;
  const subjectFields = subjectPropertyId ? undefined : coerceSubjectFields(body.subject);

  if (!subjectPropertyId && !subjectFields) {
    return NextResponse.json(
      { error: 'Pick a subject property or enter an address.' },
      { status: 400 },
    );
  }

  let payload;
  try {
    payload = await buildCma({ spaceId: space.id, subjectPropertyId, subjectFields });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not build the analysis.';
    // A missing subject is the caller's fault (404-ish); everything else is 500.
    const status = message.toLowerCase().includes('not found') ? 404 : 500;
    if (status === 500) logger.error('[cma] build failed', { spaceId: space.id, err: message });
    return NextResponse.json({ error: message }, { status });
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, TITLE_MAX) || null : null;
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('CmaReport')
    .insert({
      id: crypto.randomUUID(),
      spaceId: space.id,
      subjectAddress: payload.subject.address,
      subjectPropertyId: payload.subject.propertyId,
      shareToken: generateShareToken(),
      title,
      status: 'draft',
      payload,
      createdAt: now,
      updatedAt: now,
    })
    .select(LIST_COLUMNS)
    .single();

  if (error || !data) {
    logger.error('[cma] insert failed', { spaceId: space.id, err: error?.message });
    return NextResponse.json({ error: 'Could not save the report. Try again.' }, { status: 500 });
  }

  // Return the lean row plus the freshly built payload so the client can show
  // the preview without a second round-trip.
  return NextResponse.json({ report: { ...data, payload } });
}
