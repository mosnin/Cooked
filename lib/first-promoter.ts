/**
 * FirstPromoter — server-only transport client.
 *
 * Auth: every request carries both required headers:
 *   Authorization: Bearer ${FIRST_PROMOTER_API_KEY}
 *   Account-ID: ${FIRST_PROMOTER_ACCOUNT_ID}
 *
 * Callers receive normalised data or null on any upstream failure.
 * Secrets never leave this module to the client.
 *
 * API base: https://api.firstpromoter.com/api/v2
 */

import { logger } from '@/lib/logger';

const FP_BASE = 'https://api.firstpromoter.com/api/v2';
const REQUEST_TIMEOUT_MS = 10_000;

// ── Config ────────────────────────────────────────────────────────────────────

/** True when both server-side env vars are present. */
export function firstPromoterConfigured(): boolean {
  return Boolean(
    process.env.FIRST_PROMOTER_API_KEY && process.env.FIRST_PROMOTER_ACCOUNT_ID,
  );
}

// ── Internal fetch wrapper ────────────────────────────────────────────────────

interface FpResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

async function fpFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<FpResponse> {
  const apiKey = process.env.FIRST_PROMOTER_API_KEY;
  const accountId = process.env.FIRST_PROMOTER_ACCOUNT_ID;

  if (!apiKey || !accountId) {
    logger.warn('[first-promoter] env vars not configured', {});
    return { ok: false, status: 0, body: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${FP_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Account-ID': accountId,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    return { ok: res.ok, status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

// ── Normalised types ──────────────────────────────────────────────────────────

export interface AffiliateStats {
  clicks: number;
  referrals: number;
  sales: number;
  /** Revenue in cents. */
  revenue: number;
}

export interface AffiliateBalance {
  currency: string;
  /** Balance in cents. */
  amount: number;
}

export interface AffiliateData {
  id: string;
  refLink: string;
  refToken: string;
  stats: AffiliateStats;
  balances: AffiliateBalance[];
  /** URL to the promoter's FirstPromoter dashboard for payout setup. */
  dashboardUrl: string;
}

// ── Raw FP shapes (v2) ────────────────────────────────────────────────────────

interface FpCampaignEntry {
  ref_link?: string;
  ref_token?: string;
  coupon?: string;
}

interface FpRawStats {
  clicks?: number;
  referrals?: number;
  sales?: number;
  revenue?: number;
}

interface FpRawBalance {
  currency?: string;
  amount?: number;
}

interface FpPromoter {
  id?: number | string;
  promoter_campaigns?: FpCampaignEntry[];
  stats?: FpRawStats;
  balances?: FpRawBalance[];
  password_setup_url?: string;
}

function normalise(raw: FpPromoter): AffiliateData | null {
  if (!raw || !raw.id) return null;

  const campaign = (raw.promoter_campaigns ?? [])[0] ?? {};
  const refLink = campaign.ref_link ?? '';
  const refToken = campaign.ref_token ?? '';
  if (!refLink) return null;

  const s = raw.stats ?? {};
  const stats: AffiliateStats = {
    clicks: Number(s.clicks ?? 0),
    referrals: Number(s.referrals ?? 0),
    sales: Number(s.sales ?? 0),
    revenue: Number(s.revenue ?? 0),
  };

  const balances: AffiliateBalance[] = (raw.balances ?? []).map((b) => ({
    currency: b.currency ?? 'USD',
    amount: Number(b.amount ?? 0),
  }));

  const dashboardUrl =
    raw.password_setup_url ??
    'https://promoters.firstpromoter.com';

  return {
    id: String(raw.id),
    refLink,
    refToken,
    stats,
    balances,
    dashboardUrl,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new promoter in FirstPromoter.
 * Returns the normalised data, or null if the call fails.
 */
export async function createPromoter(params: {
  email: string;
  custId: string;
}): Promise<AffiliateData | null> {
  let res: FpResponse;
  try {
    res = await fpFetch('POST', '/company/promoters', {
      email: params.email,
      cust_id: params.custId,
    });
  } catch (err) {
    logger.warn('[first-promoter] createPromoter request threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!res.ok) {
    logger.warn('[first-promoter] createPromoter non-ok', { status: res.status });
    return null;
  }

  return normalise(res.body as FpPromoter);
}

/**
 * Fetch fresh stats for an existing promoter by their FirstPromoter id.
 * Returns the normalised data, or null on any failure.
 */
export async function getPromoter(id: string): Promise<AffiliateData | null> {
  let res: FpResponse;
  try {
    res = await fpFetch('GET', `/company/promoters/${encodeURIComponent(id)}`);
  } catch (err) {
    logger.warn('[first-promoter] getPromoter request threw', {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!res.ok) {
    logger.warn('[first-promoter] getPromoter non-ok', { id, status: res.status });
    return null;
  }

  return normalise(res.body as FpPromoter);
}
