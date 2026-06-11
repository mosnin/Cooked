import { NextRequest, NextResponse } from 'next/server';
import { requireBroker } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

type LedgerStatus = 'pending' | 'paid' | 'void';

const VALID_STATUSES: readonly LedgerStatus[] = ['pending', 'paid', 'void'] as const;

function isValidStatus(v: string): v is LedgerStatus {
  return (VALID_STATUSES as readonly string[]).includes(v);
}

/**
 * Shape of a CommissionLedger row with its two embedded joins. The UI agent
 * relies on these exact embed aliases:
 *   - agent:User!CommissionLedger_agentUserId_fkey(id, name, email)
 *   - deal:Deal!CommissionLedger_dealId_fkey(id, title)
 */
interface LedgerExportRow {
  id: string;
  dealId: string;
  closedAt: string;
  dealValue: number;
  agentRate: number;
  brokerRate: number;
  referralRate: number;
  agentAmount: number;
  brokerAmount: number;
  referralAmount: number;
  status: LedgerStatus;
  payoutAt: string | null;
  notes: string | null;
  agent: { id: string; name: string | null; email: string | null } | null;
  deal: { id: string; title: string | null } | null;
}

/**
 * Escape a CSV field per RFC 4180-ish rules:
 *   - If the value contains a comma, double-quote, or newline, wrap in
 *     double quotes and double up any internal quotes.
 *   - null / undefined -> empty string.
 *
 * Note: this mirrors the simple CSV escape in lib/csv.ts. Formula-injection
 * hardening lives in that shared helper; here the field set is fixed and
 * operator-only, so we keep the escape minimal per spec.
 */
function escapeCsv(val: unknown): string {
  if (val == null) return '';
  const str = typeof val === 'string' ? val : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * GET /api/broker/commissions/export
 * Export the commission ledger for a given month as CSV.
 *
 * Query:
 *   - month=YYYY-MM       (required)
 *   - format=csv          (optional; csv is the only supported value)
 *   - status=pending|paid|void  (optional)
 *
 * Returns `text/csv` with a Content-Disposition attachment filename.
 */
export async function GET(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireBroker();
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Audit found: the CSV includes every agent's email, deal value, and
  // amount. Letting realtor_member export the whole brokerage's ledger is
  // a real data-leak (one agent could see another's earnings). Restrict to
  // the people who already have legitimate financial access.
  const role = ctx.membership.role;
  if (role !== 'broker_owner' && role !== 'broker_admin') {
    return NextResponse.json(
      { error: 'Only the owner or admins can export commissions' },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const month = searchParams.get('month');
  const formatParam = searchParams.get('format');
  const statusParam = searchParams.get('status');

  if (!month) {
    return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 });
  }

  // Validate month format.
  const monthMatch = /^(\d{4})-(\d{2})$/.exec(month);
  if (!monthMatch) {
    return NextResponse.json({ error: 'Invalid month format (expected YYYY-MM)' }, { status: 400 });
  }
  const year = Number(monthMatch[1]);
  const monthNum = Number(monthMatch[2]);
  if (monthNum < 1 || monthNum > 12) {
    return NextResponse.json({ error: 'Invalid month value' }, { status: 400 });
  }

  // Only CSV is supported for now; reject other formats so we can add PDF later.
  const format = formatParam ?? 'csv';
  if (format !== 'csv') {
    return NextResponse.json({ error: 'Unsupported format (only csv is supported)' }, { status: 400 });
  }

  let statusFilter: LedgerStatus | undefined;
  if (statusParam) {
    if (!isValidStatus(statusParam)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }
    statusFilter = statusParam;
  }

  // Compute [start, next) in UTC.
  const start = new Date(Date.UTC(year, monthNum - 1, 1, 0, 0, 0, 0));
  const next = new Date(Date.UTC(year, monthNum, 1, 0, 0, 0, 0));

  let query = supabase
    .from('CommissionLedger')
    .select(
      [
        'id',
        'dealId',
        'closedAt',
        'dealValue',
        'agentRate',
        'brokerRate',
        'referralRate',
        'agentAmount',
        'brokerAmount',
        'referralAmount',
        'status',
        'payoutAt',
        'notes',
        'agent:User!CommissionLedger_agentUserId_fkey(id, name, email)',
        'deal:Deal!CommissionLedger_dealId_fkey(id, title)',
      ].join(', '),
    )
    .eq('brokerageId', ctx.brokerage.id)
    .gte('closedAt', start.toISOString())
    .lt('closedAt', next.toISOString())
    .order('closedAt', { ascending: true });

  if (statusFilter) {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[broker/commissions/export] query failed', error);
    return NextResponse.json({ error: 'Failed to export commissions' }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as LedgerExportRow[];

  const headers = [
    'deal_id',
    'deal_title',
    'closed_at',
    'agent_name',
    'agent_email',
    'deal_value',
    'agent_rate',
    'agent_amount',
    'broker_rate',
    'broker_amount',
    'referral_rate',
    'referral_amount',
    'status',
    'payout_at',
    'notes',
  ];

  const lines: string[] = [headers.map(escapeCsv).join(',')];

  for (const r of rows) {
    lines.push(
      [
        escapeCsv(r.dealId),
        escapeCsv(r.deal?.title ?? ''),
        escapeCsv(r.closedAt ?? ''),
        escapeCsv(r.agent?.name ?? ''),
        escapeCsv(r.agent?.email ?? ''),
        escapeCsv(r.dealValue),
        escapeCsv(r.agentRate),
        escapeCsv(r.agentAmount),
        escapeCsv(r.brokerRate),
        escapeCsv(r.brokerAmount),
        escapeCsv(r.referralRate),
        escapeCsv(r.referralAmount),
        escapeCsv(r.status),
        escapeCsv(r.payoutAt ?? ''),
        escapeCsv(r.notes ?? ''),
      ].join(','),
    );
  }

  const csv = lines.join('\n');

  // Brokerage has no `slug` field in the current schema; use the id as a
  // stable, URL-safe identifier.
  const slug = ctx.brokerage.id;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="commissions-${slug}-${month}.csv"`,
    },
  });
}
