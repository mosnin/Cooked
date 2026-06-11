import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getSpaceForUser } from '@/lib/space';
import { supabase } from '@/lib/supabase';
import { checkRateLimit } from '@/lib/rate-limit';
import { audit } from '@/lib/audit';

/**
 * GDPR / CCPA data portability — export everything in the caller's workspace.
 *
 * Right to access + right to portability (Privacy Policy §11.1). The caller
 * gets a single machine-readable JSON file of their Space's data.
 *
 * Tenant scope is the whole point: the spaceId is derived from the session
 * (getSpaceForUser → owner's single Space) and never read from the request.
 * Every table read is filtered on that one spaceId. A body-supplied id would
 * be a cross-tenant leak; there is no body. Owner-only by design — an export
 * is the full book of business, so we don't extend it to brokerage admins
 * here (they have their own brokerage tooling).
 *
 * Heavy query — one read per table. Rate-limited to a handful per hour per
 * user so it can't be used to hammer the DB.
 */

// Every Space-scoped table that holds the user's own data. Each is read with
// .eq('spaceId', space.id). Keep this list in sync with docs/DATA-DELETION.md —
// what we export is what we delete.
const SPACE_SCOPED_TABLES = [
  'SpaceSetting',
  'Contact',
  'ContactActivity',
  'ContactDocument',
  'DealStage',
  'Pipeline',
  'Deal',
  'DealActivity',
  'DealChecklistItem',
  'DealDocument',
  'Property',
  'PropertyPacket',
  'Conversation',
  'Message',
  'Attachment',
  'Note',
  'Tour',
  'TourFeedback',
  'TourWaitlist',
  'TourPropertyProfile',
  'TourAvailabilityOverride',
  'CalendarEvent',
  'MessageTemplate',
  'FormDraft',
  'FormAnalyticsEvent',
  'ApplicationMessage',
  'ApplicationStatusUpdate',
  'CommissionSplit',
  'AuditLog',
  'AgentSettings',
  'AgentActivityLog',
  'AgentMemory',
  'AgentGoal',
  'AgentTask',
  'McpApiKey',
  'CmaReport',
  'StudioPost',
  'File',
] as const;

export async function GET(req: NextRequest) {
  const authResult = await requireAuth();
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

  // A full export is a heavy fan-out of reads. Cap it tightly per user.
  const { allowed } = await checkRateLimit(`account:export:${userId}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: 'export already requested recently. try again in a little while.' },
      { status: 429 },
    );
  }

  // Scope is derived from the session, never from the request body.
  const space = await getSpaceForUser(userId);
  if (!space) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // The account/profile row for the owner — controller-held data about them.
  const { data: ownerRow } = await supabase
    .from('User')
    .select('id, email, name, avatar, bio, createdAt, accountType')
    .eq('id', space.ownerId)
    .maybeSingle();

  const data: Record<string, unknown> = {
    space: {
      id: space.id,
      slug: space.slug,
      name: space.name,
      emoji: space.emoji,
      createdAt: space.createdAt,
      brokerageId: space.brokerageId,
    },
    account: ownerRow ?? null,
  };

  // One read per table, every one scoped to this space. Sequential keeps the
  // DB pressure predictable; an export is not latency-sensitive. A missing
  // table (pre-migration) is logged and skipped so the whole export never
  // fails on one absent relation.
  for (const table of SPACE_SCOPED_TABLES) {
    const { data: rows, error } = await supabase
      .from(table)
      .select('*')
      .eq('spaceId', space.id);
    if (error) {
      console.error(`[account/export] ${table} read failed`, error.message);
      data[table] = { error: 'unavailable' };
      continue;
    }
    data[table] = rows ?? [];
  }

  // DealContact is a junction with no spaceId — scope it through the deals we
  // just exported. Same tenant boundary, reached via the deal ids.
  const dealRows = Array.isArray(data['Deal']) ? (data['Deal'] as Array<{ id: string }>) : [];
  const dealIds = dealRows.map((d) => d.id);
  if (dealIds.length > 0) {
    const { data: dealContacts, error } = await supabase
      .from('DealContact')
      .select('*')
      .in('dealId', dealIds);
    data['DealContact'] = error ? { error: 'unavailable' } : (dealContacts ?? []);
  } else {
    data['DealContact'] = [];
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    spaceId: space.id,
    note:
      'this is a complete copy of your workspace data. document files are referenced by url/key; ' +
      'the binary contents live in storage and are not inlined here.',
    data,
  };

  void audit({
    actorClerkId: userId,
    action: 'ACCESS',
    resource: 'Space',
    resourceId: space.id,
    spaceId: space.id,
    req,
    metadata: { kind: 'data-export' },
  });

  const filename = `chippi-export-${space.slug}-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
