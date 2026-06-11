'use client';

/**
 * /s/[slug]/affiliate — Affiliate program surface.
 *
 * One screen. Two states:
 *   1. Not enrolled → calm explainer + one primary action.
 *   2. Enrolled → referral link front-and-centre, stat row, payout button.
 *
 * Design: Jobs lens — paper-flat, one focal element (the serif h1 + status
 * sentence), hairline-grid stats, no configuration choices surfaced.
 */

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Gift } from 'lucide-react';
import { toastSuccess, toastError } from '@/lib/toast-helpers';
import { cn } from '@/lib/utils';
import {
  H1,
  TITLE_FONT,
  BODY_MUTED,
  BODY,
  SECTION_LABEL,
  PRIMARY_PILL,
  GHOST_PILL,
  CAPTION,
} from '@/lib/typography';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AffiliateStats {
  clicks: number;
  referrals: number;
  sales: number;
  revenue: number;
}

interface AffiliateBalance {
  currency: string;
  amount: number;
}

type AffiliateStatus =
  | { state: 'loading' }
  | { state: 'unconfigured' }
  | { state: 'unenrolled' }
  | {
      state: 'enrolled';
      refLink: string;
      stats: AffiliateStats | null;
      balances: AffiliateBalance[];
      dashboardUrl: string | null;
    };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

// ── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background px-4 py-4">
      <p className={cn(SECTION_LABEL, 'mb-1')}>{label}</p>
      <p className="text-[25px] leading-tight tracking-tight text-foreground tabular-nums">
        {value}
      </p>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

export function AffiliateView({ slug }: { slug: string }) {
  const [status, setStatus] = useState<AffiliateStatus>({ state: 'loading' });
  const [enrolling, setEnrolling] = useState(false);

  // Fetch current status.
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/affiliate?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) {
        setStatus({ state: 'unenrolled' });
        return;
      }
      const data = (await res.json()) as {
        enrolled: boolean;
        unconfigured?: boolean;
        refLink?: string;
        stats?: AffiliateStats | null;
        balances?: AffiliateBalance[];
        dashboardUrl?: string | null;
      };

      if (data.unconfigured) {
        setStatus({ state: 'unconfigured' });
        return;
      }

      if (!data.enrolled) {
        setStatus({ state: 'unenrolled' });
        return;
      }

      setStatus({
        state: 'enrolled',
        refLink: data.refLink ?? '',
        stats: data.stats ?? null,
        balances: data.balances ?? [],
        dashboardUrl: data.dashboardUrl ?? null,
      });
    } catch {
      setStatus({ state: 'unenrolled' });
    }
  }, [slug]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Enroll handler.
  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      const res = await fetch('/api/affiliate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      const data = (await res.json()) as {
        enrolled?: boolean;
        refLink?: string;
        stats?: AffiliateStats | null;
        balances?: AffiliateBalance[];
        dashboardUrl?: string | null;
        error?: string;
      };

      if (!res.ok || !data.enrolled) {
        toastError(data.error ?? 'Could not enroll. Try again.');
        return;
      }

      setStatus({
        state: 'enrolled',
        refLink: data.refLink ?? '',
        stats: data.stats ?? null,
        balances: data.balances ?? [],
        dashboardUrl: data.dashboardUrl ?? null,
      });
      toastSuccess("You're enrolled. Share your link.");
    } catch {
      toastError('Something went wrong. Try again.');
    } finally {
      setEnrolling(false);
    }
  };

  // Copy handler.
  const handleCopy = async (refLink: string) => {
    try {
      await navigator.clipboard.writeText(refLink);
      toastSuccess('Link copied.');
    } catch {
      toastError('Could not copy. Select the link manually.');
    }
  };

  // ── Derive status sentence ─────────────────────────────────────────────────
  const statusSentence = (() => {
    if (status.state === 'loading') return 'Loading your affiliate status.';
    if (status.state === 'unconfigured')
      return 'Affiliate program is not active on this server.';
    if (status.state === 'unenrolled')
      return 'Refer realtors and brokerages. Earn on every subscription.';
    const s = status.stats;
    if (!s) return 'Your referral link is active.';
    if (s.referrals === 0) return 'Your link is live. Share it.';
    return `${formatNumber(s.referrals)} referral${s.referrals === 1 ? '' : 's'} so far.`;
  })();

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 pb-12 space-y-12">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="space-y-1.5">
        <p className={cn(BODY_MUTED)}>Affiliate.</p>
        <h1 className={cn(H1)} style={TITLE_FONT}>
          Earn with Chippi.
        </h1>
        <p className={cn(BODY_MUTED)}>{statusSentence}</p>
      </header>

      {/* ── Loading skeleton ────────────────────────────────────────────── */}
      {status.state === 'loading' && (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center">
          <p className={cn(BODY, 'text-muted-foreground')}>Loading&hellip;</p>
        </div>
      )}

      {/* ── Unconfigured ────────────────────────────────────────────────── */}
      {status.state === 'unconfigured' && (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-5 py-10 text-center space-y-2">
          <p className={cn(BODY)}>Affiliate program not configured.</p>
          <p className={cn(BODY_MUTED)}>
            Set{' '}
            <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">
              FIRST_PROMOTER_API_KEY
            </code>
            ,{' '}
            <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">
              FIRST_PROMOTER_ACCOUNT_ID
            </code>
            , and{' '}
            <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">
              NEXT_PUBLIC_FIRST_PROMOTER_CID
            </code>{' '}
            in Vercel environment variables to activate.
          </p>
        </div>
      )}

      {/* ── Not enrolled ────────────────────────────────────────────────── */}
      {status.state === 'unenrolled' && (
        <div className="space-y-6">
          {/* Explainer card */}
          <div className="rounded-xl border border-border/70 bg-card px-6 py-6 space-y-3">
            <div className="flex items-center gap-2">
              <Gift className="size-4 text-muted-foreground" />
              <p className={cn(SECTION_LABEL)}>How it works</p>
            </div>
            <p className={cn(BODY)}>
              You get a personal referral link. Share it with other realtors or
              brokerages. When they subscribe to Chippi through your link, you
              earn a commission on their subscription — recurring, for as long
              as they stay active.
            </p>
            <p className={cn(BODY_MUTED)}>
              One link works for both individual agents and entire brokerages.
              Payouts are configured in the FirstPromoter dashboard via PayPal,
              Wise, or Stripe — no setup needed here.
            </p>
          </div>

          <button
            type="button"
            className={cn(PRIMARY_PILL)}
            onClick={handleEnroll}
            disabled={enrolling}
          >
            {enrolling ? 'Enrolling…' : 'Become an affiliate'}
          </button>
        </div>
      )}

      {/* ── Enrolled ────────────────────────────────────────────────────── */}
      {status.state === 'enrolled' && (
        <div className="space-y-6">
          {/* Referral link — the focal element */}
          <div className="rounded-xl border border-border/70 bg-card px-5 py-5 space-y-3">
            <p className={cn(SECTION_LABEL)}>Your referral link</p>
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm font-mono text-foreground truncate select-all">
                {status.refLink}
              </p>
              <button
                type="button"
                className={cn(GHOST_PILL, 'shrink-0')}
                onClick={() => handleCopy(status.refLink)}
              >
                Copy
              </button>
            </div>
            <p className={cn(CAPTION)}>
              Works for individual realtors and entire brokerages — share freely.
            </p>
          </div>

          {/* Stats grid */}
          {status.stats && (
            <div>
              <p className={cn(SECTION_LABEL, 'mb-3')}>Performance</p>
              <section
                className="grid grid-cols-2 sm:grid-cols-4 gap-px rounded-xl overflow-hidden border border-border/60 bg-border/60"
              >
                <StatCell
                  label="Clicks"
                  value={formatNumber(status.stats.clicks)}
                />
                <StatCell
                  label="Referrals"
                  value={formatNumber(status.stats.referrals)}
                />
                <StatCell
                  label="Sales"
                  value={formatNumber(status.stats.sales)}
                />
                <StatCell
                  label="Earnings"
                  value={
                    status.balances.length > 0
                      ? formatCurrency(
                          status.balances[0].amount,
                          status.balances[0].currency,
                        )
                      : formatCurrency(status.stats.revenue)
                  }
                />
              </section>
            </div>
          )}

          {/* Payout action */}
          {status.dashboardUrl && (
            <a
              href={status.dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(PRIMARY_PILL, 'inline-flex')}
            >
              <ExternalLink className="size-4" />
              Manage payouts
            </a>
          )}
        </div>
      )}
    </main>
  );
}
