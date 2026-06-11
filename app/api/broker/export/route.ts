import { NextResponse } from 'next/server';
import { requireBroker } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

/**
 * GET /api/broker/export
 * Export team performance data as CSV.
 */
export async function GET() {
  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { brokerage } = ctx;

  // Fetch members with user + space
  const { data: memberships } = await supabase
    .from('BrokerageMembership')
    .select('id, role, createdAt, userId, User(id, name, email, onboard), Space!Space_ownerId_fkey(id, slug, name)')
    .eq('brokerageId', brokerage.id)
    .order('createdAt', { ascending: true });

  const members = (memberships ?? []) as unknown as Array<{
    id: string;
    role: string;
    createdAt: string;
    userId: string;
    User: { id: string; name: string | null; email: string; onboard: boolean } | null;
    Space: { id: string; slug: string; name: string } | null;
  }>;

  const spaceIds = members.map((m) => m.Space?.id).filter(Boolean) as string[];

  // Fetch stats
  const [leadRows, contactRows, dealRows] = await Promise.all([
    spaceIds.length > 0
      ? supabase.from('Contact').select('spaceId').in('spaceId', spaceIds).contains('tags', ['new-lead']).limit(10000).then((r) => r.data ?? [])
      : Promise.resolve([]),
    spaceIds.length > 0
      ? supabase.from('Contact').select('spaceId').in('spaceId', spaceIds).limit(10000).then((r) => r.data ?? [])
      : Promise.resolve([]),
    spaceIds.length > 0
      ? supabase.from('Deal').select('spaceId, value, status').in('spaceId', spaceIds).limit(10000).then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);

  const leadsBySpace = (leadRows as { spaceId: string }[]).reduce<Record<string, number>>(
    (acc, r) => { acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1; return acc; }, {}
  );
  const contactsBySpace = (contactRows as { spaceId: string }[]).reduce<Record<string, number>>(
    (acc, r) => { acc[r.spaceId] = (acc[r.spaceId] ?? 0) + 1; return acc; }, {}
  );
  const dealsBySpace = (dealRows as { spaceId: string; value: number | null; status: string }[]).reduce<
    Record<string, { count: number; value: number; won: number; wonValue: number }>
  >(
    (acc, r) => {
      if (!acc[r.spaceId]) acc[r.spaceId] = { count: 0, value: 0, won: 0, wonValue: 0 };
      acc[r.spaceId].count += 1;
      acc[r.spaceId].value += r.value ?? 0;
      if (r.status === 'won') {
        acc[r.spaceId].won += 1;
        acc[r.spaceId].wonValue += r.value ?? 0;
      }
      return acc;
    },
    {}
  );

  // Build CSV
  const headers = ['Name', 'Email', 'Role', 'Status', 'Joined', 'Workspace', 'New people', 'Total people', 'Deals', 'Pipeline value', 'Won deals', 'Won value'];
  const rows = members.map((m) => {
    const sid = m.Space?.id;
    const role = m.role === 'broker_owner' ? 'Owner' : m.role === 'broker_admin' ? 'Admin' : 'Realtor';
    const status = m.User?.onboard ? 'Active' : 'Pending';
    const joined = new Date(m.createdAt).toISOString().split('T')[0];
    const leads = sid ? (leadsBySpace[sid] ?? 0) : 0;
    const contacts = sid ? (contactsBySpace[sid] ?? 0) : 0;
    const deals = sid ? (dealsBySpace[sid]?.count ?? 0) : 0;
    const pipeline = sid ? (dealsBySpace[sid]?.value ?? 0) : 0;
    const won = sid ? (dealsBySpace[sid]?.won ?? 0) : 0;
    const wonValue = sid ? (dealsBySpace[sid]?.wonValue ?? 0) : 0;

    return [
      csvEscape(m.User?.name ?? ''),
      csvEscape(m.User?.email ?? ''),
      csvEscape(role),
      csvEscape(status),
      csvEscape(joined),
      csvEscape(m.Space?.slug ?? ''),
      leads,
      contacts,
      deals,
      pipeline,
      won,
      wonValue,
    ].join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${brokerage.name.replace(/[^a-zA-Z0-9]/g, '_')}_team_export_${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}

function csvEscape(val: string): string {
  // Prevent CSV injection: prefix formula-triggering characters with a tab
  let safe = val;
  if (/^[=+\-@\t\r]/.test(safe)) {
    safe = `\t${safe}`;
  }
  if (safe.includes(',') || safe.includes('"') || safe.includes('\n') || safe !== val) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
