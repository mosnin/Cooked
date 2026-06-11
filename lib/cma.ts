/**
 * CMA (Comparative Market Analysis) — pure logic.
 *
 * In-house only. Comps come from the realtor's own Property rows (the same
 * source `find_comparable_properties` uses) — never MLS, never an external API.
 *
 * `buildCma` selects comps for a subject (by beds/baths/price/area similarity),
 * computes the headline stats, and returns a frozen payload the public report
 * page renders verbatim. Stats are split into small pure helpers so the
 * computation is unit-testable without a database.
 */

import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

// ── Public payload shapes ────────────────────────────────────────────────────

/** Snapshot of the subject property frozen into the report. */
export interface CmaSubject {
  propertyId: string | null;
  address: string;
  city: string | null;
  stateRegion: string | null;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  propertyType: string | null;
  listPrice: number | null;
}

/** A single comparable, snapshotted so the report is stable over time. */
export interface CmaComp {
  id: string;
  address: string;
  city: string | null;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  /** The price we analysed — sold price preferred, else list price. */
  price: number | null;
  /** Whether `price` came from a sold listing vs an active list price. */
  priceBasis: 'sold' | 'list';
  pricePerSqft: number | null;
  listingStatus: string;
}

/** Computed headline numbers. Nulls mean "not enough data". */
export interface CmaStats {
  compCount: number;
  /** How many comps had a usable price (drives low/median/high). */
  pricedCount: number;
  low: number | null;
  median: number | null;
  high: number | null;
  /** Average $/sqft across comps that had both a price and a sqft. */
  avgPricePerSqft: number | null;
  /** Suggested list-price range, derived from the comp spread + subject sqft. */
  suggestedLow: number | null;
  suggestedHigh: number | null;
  /** Whether the priced comps were mostly sold (vs list) prices. */
  basis: 'sold' | 'list' | 'mixed' | 'none';
}

export interface CmaPayload {
  subject: CmaSubject;
  comps: CmaComp[];
  stats: CmaStats;
  /** ISO timestamp the analysis was computed. */
  generatedAt: string;
}

// ── Subject input ────────────────────────────────────────────────────────────

/** Free-typed subject fields (when the realtor isn't picking a saved row). */
export interface SubjectFields {
  address: string;
  city?: string | null;
  stateRegion?: string | null;
  beds?: number | null;
  baths?: number | null;
  squareFeet?: number | null;
  propertyType?: string | null;
  listPrice?: number | null;
}

// ── Pure stat helpers (the unit-tested core) ─────────────────────────────────

/** Median of a numeric list. Empty → null. */
export function median(values: number[]): number | null {
  const xs = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1] + xs[mid]) / 2 : xs[mid];
}

/**
 * Compute the headline stats from a set of comps + the subject.
 *
 * - low / median / high from comps that have a usable price.
 * - avgPricePerSqft from comps with both price and sqft.
 * - suggested range: if the subject has sqft and we have a $/sqft signal, the
 *   range is the subject sqft × the comp $/sqft band (10th-ish: we use
 *   min/max $/sqft of the comps). Otherwise we fall back to the raw price
 *   low/high so there's always a defensible range when comps exist.
 */
export function computeStats(comps: CmaComp[], subject: CmaSubject): CmaStats {
  const priced = comps.filter((c) => c.price != null && c.price > 0) as Array<
    CmaComp & { price: number }
  >;
  const prices = priced.map((c) => c.price);

  const ppsfList = comps
    .filter((c) => c.pricePerSqft != null && c.pricePerSqft > 0)
    .map((c) => c.pricePerSqft as number);

  const avgPricePerSqft =
    ppsfList.length > 0
      ? Math.round(ppsfList.reduce((s, n) => s + n, 0) / ppsfList.length)
      : null;

  // Basis: did the priced comps come from sold data, list data, or both?
  let basis: CmaStats['basis'] = 'none';
  if (priced.length > 0) {
    const sold = priced.filter((c) => c.priceBasis === 'sold').length;
    basis = sold === priced.length ? 'sold' : sold === 0 ? 'list' : 'mixed';
  }

  const low = prices.length > 0 ? Math.min(...prices) : null;
  const high = prices.length > 0 ? Math.max(...prices) : null;
  const med = median(prices);

  // Suggested list-price range.
  let suggestedLow: number | null = null;
  let suggestedHigh: number | null = null;
  if (subject.squareFeet != null && subject.squareFeet > 0 && ppsfList.length > 0) {
    const minPpsf = Math.min(...ppsfList);
    const maxPpsf = Math.max(...ppsfList);
    suggestedLow = Math.round(subject.squareFeet * minPpsf);
    suggestedHigh = Math.round(subject.squareFeet * maxPpsf);
  } else if (low != null && high != null) {
    suggestedLow = low;
    suggestedHigh = high;
  }

  return {
    compCount: comps.length,
    pricedCount: priced.length,
    low,
    median: med,
    high,
    avgPricePerSqft,
    suggestedLow,
    suggestedHigh,
    basis,
  };
}

// ── Comp selection ───────────────────────────────────────────────────────────

/**
 * Resolve the comp `price` + basis for a Property row: prefer a sold listing's
 * price (the truest comp signal), otherwise fall back to the list price.
 */
function priceForComp(row: {
  listPrice: number | null;
  listingStatus: string;
}): { price: number | null; basis: 'sold' | 'list' } {
  const basis = row.listingStatus === 'sold' ? 'sold' : 'list';
  return { price: row.listPrice ?? null, basis };
}

interface PropertyRow {
  id: string;
  address: string;
  city: string | null;
  stateRegion: string | null;
  beds: number | null;
  baths: number | null;
  squareFeet: number | null;
  propertyType: string | null;
  listPrice: number | null;
  listingStatus: string;
  updatedAt: string;
}

const COMP_SELECT =
  'id, address, city, stateRegion, beds, baths, squareFeet, propertyType, listPrice, listingStatus, updatedAt';

const MAX_COMPS = 6;

/**
 * Score a candidate against the subject. Lower is closer. Mirrors the
 * intent of `find_comparable_properties` (beds/baths/price similarity) but
 * adds sqft + a sold-comp preference, since a CMA wants the most relevant
 * recent sales near the top.
 */
function scoreComp(row: PropertyRow, subject: CmaSubject): number {
  let score = 0;
  if (subject.beds != null && row.beds != null) score += Math.abs(row.beds - subject.beds) * 2;
  if (subject.baths != null && row.baths != null) score += Math.abs(row.baths - subject.baths) * 1.5;
  if (subject.squareFeet != null && row.squareFeet != null) {
    score += Math.abs(row.squareFeet - subject.squareFeet) / 250;
  }
  if (
    subject.listPrice != null &&
    subject.listPrice > 0 &&
    row.listPrice != null &&
    row.listPrice > 0
  ) {
    score += (Math.abs(row.listPrice - subject.listPrice) / subject.listPrice) * 5;
  }
  // Prefer sold comps and same property type as light tie-breakers.
  if (row.listingStatus === 'sold') score -= 1;
  if (subject.propertyType && row.propertyType === subject.propertyType) score -= 0.5;
  return score;
}

function toComp(row: PropertyRow): CmaComp {
  const { price, basis } = priceForComp(row);
  const pricePerSqft =
    price != null && row.squareFeet != null && row.squareFeet > 0
      ? Math.round(price / row.squareFeet)
      : null;
  return {
    id: row.id,
    address: row.address,
    city: row.city,
    beds: row.beds,
    baths: row.baths,
    squareFeet: row.squareFeet,
    price,
    priceBasis: basis,
    pricePerSqft,
    listingStatus: row.listingStatus,
  };
}

export interface BuildCmaArgs {
  spaceId: string;
  /** Pick a saved Property as the subject. */
  subjectPropertyId?: string;
  /** Or type subject details directly. One of these is required. */
  subjectFields?: SubjectFields;
}

/**
 * Build a full CMA payload for a space. Selects up to 6 comps from the space's
 * own Property rows, scores them by similarity to the subject, and computes the
 * stats. Throws on bad input or DB error; the route translates to HTTP.
 */
export async function buildCma(args: BuildCmaArgs): Promise<CmaPayload> {
  const { spaceId, subjectPropertyId, subjectFields } = args;

  // ── Resolve the subject ───────────────────────────────────────────────────
  let subject: CmaSubject;
  if (subjectPropertyId) {
    const { data, error } = await supabase
      .from('Property')
      .select(COMP_SELECT)
      .eq('id', subjectPropertyId)
      .eq('spaceId', spaceId)
      .maybeSingle();
    if (error) throw new Error(`Subject lookup failed: ${error.message}`);
    if (!data) throw new Error('Subject property not found.');
    const row = data as PropertyRow;
    subject = {
      propertyId: row.id,
      address: row.address,
      city: row.city,
      stateRegion: row.stateRegion,
      beds: row.beds,
      baths: row.baths,
      squareFeet: row.squareFeet,
      propertyType: row.propertyType,
      listPrice: row.listPrice,
    };
  } else if (subjectFields && subjectFields.address.trim()) {
    subject = {
      propertyId: null,
      address: subjectFields.address.trim(),
      city: subjectFields.city ?? null,
      stateRegion: subjectFields.stateRegion ?? null,
      beds: subjectFields.beds ?? null,
      baths: subjectFields.baths ?? null,
      squareFeet: subjectFields.squareFeet ?? null,
      propertyType: subjectFields.propertyType ?? null,
      listPrice: subjectFields.listPrice ?? null,
    };
  } else {
    throw new Error('Provide a subjectPropertyId or subject fields with an address.');
  }

  // ── Pull candidate comps from this space ──────────────────────────────────
  // Over-fetch and score in memory (small data, same as find_comparable).
  const { data, error } = await supabase
    .from('Property')
    .select(COMP_SELECT)
    .eq('spaceId', spaceId)
    .order('updatedAt', { ascending: false })
    .limit(50);
  if (error) throw new Error(`Comp lookup failed: ${error.message}`);

  let rows = (data ?? []) as PropertyRow[];
  // Never include the subject itself as its own comp.
  if (subject.propertyId) rows = rows.filter((r) => r.id !== subject.propertyId);

  rows.sort((a, b) => scoreComp(a, subject) - scoreComp(b, subject));
  const comps = rows.slice(0, MAX_COMPS).map(toComp);

  const stats = computeStats(comps, subject);

  return {
    subject,
    comps,
    stats,
    generatedAt: new Date().toISOString(),
  };
}

// ── Share token ──────────────────────────────────────────────────────────────

/**
 * URL-safe random token for the public /cma/[token] route. 32 hex chars of
 * crypto-strong randomness — same posture as PropertyPacket tokens.
 */
export function generateShareToken(): string {
  return crypto.randomBytes(16).toString('hex');
}
