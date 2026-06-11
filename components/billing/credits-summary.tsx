import { resolveBillingAccount } from '@/lib/billing/account';
import { getCreditBalance, getRecentTxns, type CreditTxnRow } from '@/lib/billing/credits';
import { PLANS } from '@/lib/plans';
import { BuyCredits } from '@/components/billing/buy-credits';
import { cn } from '@/lib/utils';

const WORKFLOW_LABEL: Record<string, string> = {
  pipeline_audit: 'Pipeline audit',
  followup_sequence: 'Follow-up sequence',
  lead_qualification: 'Lead qualification',
  tour_booking: 'Tour booking',
  daily_briefing: 'Daily briefing',
  call_prep: 'Call prep',
  lead_score: 'Lead score',
};

function rowLabel(t: CreditTxnRow): string {
  if (t.reason === 'refund') return 'Refund';
  return WORKFLOW_LABEL[t.workflow] ?? t.workflow;
}

function ago(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

/**
 * Credits panel for the billing surface — current plan, spendable balance, the
 * buy-more packs, and recent ledger activity. Resolves the funding account
 * (space, or brokerage pool for Team) itself. Degrades to nothing if the credit
 * tables aren't provisioned yet, so it's safe to drop on any billing page.
 */
export async function CreditsSummary({ spaceId, slug }: { spaceId: string; slug: string }) {
  let planLabel = '';
  let monthlyCredits = 0;
  let balance = 0;
  let txns: CreditTxnRow[] = [];
  try {
    const { account, plan } = await resolveBillingAccount(spaceId);
    planLabel = PLANS[plan].label;
    monthlyCredits = PLANS[plan].monthlyCredits;
    [balance, txns] = await Promise.all([getCreditBalance(account), getRecentTxns(account, 8)]);
  } catch {
    return null; // credits not provisioned in this environment yet
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          AI credits
        </p>
        <p
          className="text-3xl tabular-nums tracking-tight text-foreground leading-none"
          style={{ fontFamily: 'var(--font-title)' }}
        >
          {balance.toLocaleString()}
        </p>
        <p className="text-sm text-muted-foreground">
          {planLabel}
          {monthlyCredits > 0 ? ` · ${monthlyCredits.toLocaleString()} credits/mo` : ''}
        </p>
      </header>

      <BuyCredits slug={slug} />

      {txns.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent activity
          </p>
          <ul className="divide-y divide-border/60 rounded-xl border border-border/70">
            {txns.map((t) => (
              <li key={t.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-foreground">{rowLabel(t)}</span>
                <span className="flex items-center gap-3">
                  <span className="text-[11px] tabular-nums text-muted-foreground/60">{ago(t.createdAt)}</span>
                  <span
                    className={cn(
                      'text-sm tabular-nums',
                      t.delta < 0 ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {t.delta > 0 ? '+' : ''}
                    {t.delta.toLocaleString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
