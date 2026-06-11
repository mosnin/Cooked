import { NextRequest, NextResponse } from 'next/server';
import { requireBroker } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { getBrokerageMembers } from '@/lib/brokerage-members';

/**
 * GET /api/broker/contacts
 *
 * Returns contacts scoped to ALL member spaces in the broker's brokerage,
 * each annotated with `realtorName` (the owning realtor's display name).
 *
 * Query params:
 *   search  — optional; case-insensitive substring match on name/email/phone
 *   type    — optional; QUALIFICATION | TOUR | APPLICATION | ALL (default ALL)
 *   limit   — optional; default 500, max 1000
 *   offset  — optional; default 0
 */
export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { brokerage } = ctx;

  // ── Resolve all member spaces ──────────────────────────────────────────────
  const allMembers = await getBrokerageMembers(brokerage.id, {
    includeSpaceName: true,
  });

  const memberSpaceIds = allMembers
    .map((m) => m.Space?.id)
    .filter(Boolean) as string[];

  // Belt-and-suspenders: include owner's own space if memberships resolved empty
  let ownerSpaceIds: string[] = [];
  if (memberSpaceIds.length === 0) {
    const { data: ownerSpaces } = await supabase
      .from('Space')
      .select('id')
      .eq('ownerId', brokerage.ownerId)
      .limit(10);
    ownerSpaceIds = (ownerSpaces ?? []).map((s: { id: string }) => s.id);
  }

  const spaceIds = [...new Set([...memberSpaceIds, ...ownerSpaceIds])];

  if (spaceIds.length === 0) {
    return NextResponse.json([]);
  }

  // ── Build spaceId → realtor display-name map ──────────────────────────────
  const spaceToRealtor = new Map<string, string>();
  for (const m of allMembers) {
    const sid = m.Space?.id;
    if (!sid) continue;
    spaceToRealtor.set(sid, m.User?.name ?? m.User?.email ?? 'Unknown realtor');
  }

  // ── Parse query params ────────────────────────────────────────────────────
  const search = (req.nextUrl.searchParams.get('search') ?? '').trim();
  const type = req.nextUrl.searchParams.get('type') ?? 'ALL';
  const limitParam = parseInt(req.nextUrl.searchParams.get('limit') ?? '500', 10);
  const offsetParam = parseInt(req.nextUrl.searchParams.get('offset') ?? '0', 10);
  const limit = Math.min(Math.max(1, limitParam || 500), 1000);
  const offset = Math.max(0, offsetParam || 0);

  // ── Build query ───────────────────────────────────────────────────────────
  let query = supabase
    .from('Contact')
    .select(
      'id, name, email, phone, type, leadType, leadScore, scoreLabel, tags, followUpAt, createdAt, updatedAt, spaceId'
    )
    .in('spaceId', spaceIds);

  if (type && type !== 'ALL') {
    query = query.eq('type', type);
  }

  if (search) {
    const limited = search.slice(0, 100).toLowerCase();
    const tokens = limited
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .slice(0, 8);
    for (const token of tokens) {
      const escaped = token
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
      const sanitized = escaped.replace(/[,()]/g, '');
      if (!sanitized) continue;
      const pattern = `%${sanitized}%`;
      query = query.or(
        `name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`
      );
    }
  }

  const { data, error } = await query
    .order('updatedAt', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error('[broker/contacts/GET] query error:', error);
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
  }

  // Annotate each row with realtorName
  const annotated = (data ?? []).map((c: any) => ({
    ...c,
    realtorName: spaceToRealtor.get(c.spaceId) ?? 'Unknown realtor',
  }));

  return NextResponse.json(annotated);
}
