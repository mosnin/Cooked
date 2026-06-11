/**
 * Tests for the pure CMA stat computation in lib/cma.ts.
 *
 * Covers the unit-testable core (no DB): median(), and computeStats()'s
 * low / median / high, average $/sqft, suggested-range derivation, and the
 * sold/list/mixed basis classification. buildCma() itself talks to Supabase
 * and is exercised end-to-end elsewhere; these tests pin the math.
 */

import { describe, it, expect } from 'vitest';
import { computeStats, median, generateShareToken } from '@/lib/cma';
import type { CmaComp, CmaSubject } from '@/lib/cma';

function comp(overrides: Partial<CmaComp>): CmaComp {
  return {
    id: Math.random().toString(36).slice(2),
    address: '1 Test St',
    city: null,
    beds: null,
    baths: null,
    squareFeet: null,
    price: null,
    priceBasis: 'list',
    pricePerSqft: null,
    listingStatus: 'active',
    ...overrides,
  };
}

const SUBJECT: CmaSubject = {
  propertyId: null,
  address: '500 Subject Ave',
  city: 'Oakland',
  stateRegion: 'CA',
  beds: 3,
  baths: 2,
  squareFeet: 2000,
  propertyType: 'single_family',
  listPrice: null,
};

describe('median', () => {
  it('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });

  it('returns the middle value for an odd-length list', () => {
    expect(median([300, 100, 200])).toBe(200);
  });

  it('averages the two middle values for an even-length list', () => {
    expect(median([100, 200, 300, 400])).toBe(250);
  });
});

describe('computeStats — low / median / high', () => {
  it('computes low, median, high from priced comps', () => {
    const comps = [
      comp({ price: 800_000 }),
      comp({ price: 600_000 }),
      comp({ price: 1_000_000 }),
    ];
    const stats = computeStats(comps, SUBJECT);

    expect(stats.compCount).toBe(3);
    expect(stats.pricedCount).toBe(3);
    expect(stats.low).toBe(600_000);
    expect(stats.median).toBe(800_000);
    expect(stats.high).toBe(1_000_000);
  });

  it('ignores comps with no usable price', () => {
    const comps = [
      comp({ price: 500_000 }),
      comp({ price: null }),
      comp({ price: 0 }),
      comp({ price: 700_000 }),
    ];
    const stats = computeStats(comps, SUBJECT);

    expect(stats.compCount).toBe(4);
    expect(stats.pricedCount).toBe(2);
    expect(stats.low).toBe(500_000);
    expect(stats.high).toBe(700_000);
    expect(stats.median).toBe(600_000);
  });

  it('returns null stats when no comps are priced', () => {
    const stats = computeStats([comp({ price: null }), comp({ price: null })], SUBJECT);
    expect(stats.low).toBeNull();
    expect(stats.median).toBeNull();
    expect(stats.high).toBeNull();
    expect(stats.basis).toBe('none');
  });
});

describe('computeStats — average $/sqft', () => {
  it('averages the per-comp $/sqft values', () => {
    const comps = [
      comp({ price: 600_000, squareFeet: 2000, pricePerSqft: 300 }),
      comp({ price: 800_000, squareFeet: 2000, pricePerSqft: 400 }),
    ];
    const stats = computeStats(comps, SUBJECT);
    expect(stats.avgPricePerSqft).toBe(350);
  });

  it('is null when no comp has a $/sqft', () => {
    const stats = computeStats([comp({ price: 600_000, pricePerSqft: null })], SUBJECT);
    expect(stats.avgPricePerSqft).toBeNull();
  });
});

describe('computeStats — suggested range', () => {
  it('derives the range from subject sqft × the comp $/sqft band', () => {
    const comps = [
      comp({ price: 600_000, squareFeet: 2000, pricePerSqft: 300 }),
      comp({ price: 900_000, squareFeet: 2000, pricePerSqft: 450 }),
    ];
    const stats = computeStats(comps, SUBJECT); // subject sqft = 2000
    expect(stats.suggestedLow).toBe(2000 * 300);
    expect(stats.suggestedHigh).toBe(2000 * 450);
  });

  it('falls back to raw price low/high when the subject has no sqft', () => {
    const subjectNoSqft: CmaSubject = { ...SUBJECT, squareFeet: null };
    const comps = [comp({ price: 500_000 }), comp({ price: 900_000 })];
    const stats = computeStats(comps, subjectNoSqft);
    expect(stats.suggestedLow).toBe(500_000);
    expect(stats.suggestedHigh).toBe(900_000);
  });
});

describe('computeStats — basis classification', () => {
  it('reports "sold" when every priced comp is a sold listing', () => {
    const comps = [
      comp({ price: 600_000, priceBasis: 'sold' }),
      comp({ price: 700_000, priceBasis: 'sold' }),
    ];
    expect(computeStats(comps, SUBJECT).basis).toBe('sold');
  });

  it('reports "list" when every priced comp is a list price', () => {
    const comps = [comp({ price: 600_000, priceBasis: 'list' })];
    expect(computeStats(comps, SUBJECT).basis).toBe('list');
  });

  it('reports "mixed" when sold and list prices both appear', () => {
    const comps = [
      comp({ price: 600_000, priceBasis: 'sold' }),
      comp({ price: 700_000, priceBasis: 'list' }),
    ];
    expect(computeStats(comps, SUBJECT).basis).toBe('mixed');
  });
});

describe('generateShareToken', () => {
  it('returns 32 hex chars and is unique across calls', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
