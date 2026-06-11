import { requireManager } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { CommissionsClient, type LedgerRow } from './commissions-client';
import { H1, TITLE_FONT, BODY_MUTED, SECTION_RHYTHM } from '@/lib/typography';

export const metadata: Metadata = { title: 'Commissions — Teams' };

/** Raw row shape as stored in CommissionLedger. */
type LedgerDbRow = {
  id: string;
  teamId: string;
  agentUserId: string;
  dealId: string;
  closedAt: string;
  dealValue: number | null;
  agentRate: number | null;
  managerRate: number | null;
  referralRate: number | null;
  referralUserId: string | null;
  agentAmount: number | null;
  managerAmount: number | null;
  referralAmount: number | null;
  status: 'pending' | 'paid' | 'void';
  payoutAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type LedgerWithJoins = LedgerDbRow & {
  agent?: { id: string; name: string | null; email: string | null } | null;
  deal?: { id: string; title: string | null } | null;
};

/**
 * Fetch ledger rows for a team. Tries the PostgREST embedded FK join first;
 * on failure (e.g. unexpected FK name) falls back to two separate queries and
 * joins in memory.
 */
async function fetchLedgerRows(teamId: string): Promise<LedgerRow[]> {
  const { data: joined, error } = await supabase
    .from('CommissionLedger')
    .select(
      '*, agent:User!CommissionLedger_agentUserId_fkey(id,name,email), deal:Deal!CommissionLedger_dealId_fkey(id,title)'
    )
    .eq('teamId', teamId)
    .order('closedAt', { ascending: false })
    .limit(5000);

  if (!error && joined) {
    return (joined as LedgerWithJoins[]).map(flatten);
  }

  // Fallback: two separate queries joined in memory.
  const { data: rows } = await supabase
    .from('CommissionLedger')
    .select('*')
    .eq('teamId', teamId)
    .order('closedAt', { ascending: false })
    .limit(5000);

  const ledgerRows = (rows ?? []) as LedgerDbRow[];
  if (ledgerRows.length === 0) return [];

  const agentIds = Array.from(new Set(ledgerRows.map((r) => r.agentUserId).filter(Boolean)));
  const dealIds = Array.from(new Set(ledgerRows.map((r) => r.dealId).filter(Boolean)));

  const [{ data: agents }, { data: deals }] = await Promise.all([
    agentIds.length
      ? supabase.from('User').select('id, name, email').in('id', agentIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string | null }> }),
    dealIds.length
      ? supabase.from('Deal').select('id, title').in('id', dealIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
  ]);

  const agentMap = new Map(
    (agents ?? []).map((u) => [u.id, u as { id: string; name: string | null; email: string | null }])
  );
  const dealMap = new Map(
    (deals ?? []).map((d) => [d.id, d as { id: string; title: string | null }])
  );

  return ledgerRows.map((r) =>
    flatten({
      ...r,
      agent: agentMap.get(r.agentUserId) ?? null,
      deal: dealMap.get(r.dealId) ?? null,
    })
  );
}

function flatten(row: LedgerWithJoins): LedgerRow {
  return {
    id: row.id,
    dealId: row.dealId,
    dealTitle: row.deal?.title ?? null,
    closedAt: row.closedAt,
    dealValue: row.dealValue ?? 0,
    agentUserId: row.agentUserId,
    agentName: row.agent?.name ?? null,
    agentEmail: row.agent?.email ?? null,
    agentRate: row.agentRate ?? 0,
    managerRate: row.managerRate ?? 0,
    referralRate: row.referralRate ?? 0,
    referralUserId: row.referralUserId,
    agentAmount: row.agentAmount ?? 0,
    managerAmount: row.managerAmount ?? 0,
    referralAmount: row.referralAmount ?? 0,
    status: row.status,
    payoutAt: row.payoutAt,
    notes: row.notes,
  };
}

export default async function ManagerCommissionsPage() {
  let ctx;
  try {
    ctx = await requireManager();
  } catch {
    redirect('/');
  }

  const { team } = ctx;

  const ledger = await fetchLedgerRows(team.id);

  // BP2a adds these columns; access defensively until the type is updated.
  const b = team as unknown as {
    defaultAgentRate?: number | null;
    defaultManagerRate?: number | null;
  };
  const defaultAgentRate = typeof b.defaultAgentRate === 'number' ? b.defaultAgentRate : 0.03;
  const defaultManagerRate = typeof b.defaultManagerRate === 'number' ? b.defaultManagerRate : 0.02;

  const rowCount = ledger.length;
  const statusSentence =
    rowCount === 0
      ? 'No won deals on the ledger yet.'
      : `${rowCount} ${rowCount === 1 ? 'deal' : 'deals'} on the ledger, snapshotted at close.`;

  return (
    <div className={`max-w-5xl mx-auto ${SECTION_RHYTHM} w-full pb-12`}>
      <header className="space-y-1.5">
        <p className={BODY_MUTED}>{team.name}.</p>
        <h1 className={H1} style={TITLE_FONT}>
          Commissions
        </h1>
        <p className={BODY_MUTED}>{statusSentence}</p>
      </header>

      <CommissionsClient
        ledger={ledger}
        defaultAgentRate={defaultAgentRate}
        defaultManagerRate={defaultManagerRate}
      />
    </div>
  );
}
