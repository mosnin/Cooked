import { describe, it, expect } from 'vitest';
import { computeLeadScore } from '@/lib/scoring/engine';
import {
  computeDeterministicScore,
  computeModelBasedScore,
} from '@/lib/scoring/deterministic-scorer';
import {
  RENTAL_APPLICATION_TEMPLATE,
} from '@/lib/form-config-templates';
import type { IntakeFormConfig } from '@/lib/types';
import type { ScoringModel } from '@/lib/scoring/scoring-model-types';

// Tier bands (must match assignTier in engine.ts / dynamic-lead-scoring.ts):
//   hot >= 75, warm >= 45, else cold/unqualified.
// These tests feed representative strong / middling / weak leads through the
// real scoring functions and assert the scores land in the right 0-100 band.

describe('computeLeadScore — rental engine', () => {
  const strong = {
    name: 'Strong Renter',
    email: 'strong@example.com',
    phone: '5551234567',
    budget: null,
    leadType: 'rental' as const,
    applicationData: {
      monthlyGrossIncome: '7500_plus',
      monthlyRent: '1500_2000',
      employmentStatus: 'full-time',
      targetMoveInDate: 'asap',
      numberOfOccupants: 2,
      hasPets: false,
      leaseTermPreference: 'ready',
      propertyAddress: '123 Main St',
    } as never,
  };

  const middling = {
    name: 'Middling Renter',
    email: 'mid@example.com',
    phone: '5552223333',
    budget: null,
    leadType: 'rental' as const,
    applicationData: {
      monthlyGrossIncome: '4000_5000',
      monthlyRent: '2000_2500',
      employmentStatus: 'part-time',
      targetMoveInDate: '1-2months',
      numberOfOccupants: 3,
      hasPets: false,
      propertyAddress: '45 Oak Ave',
    } as never,
  };

  const weak = {
    name: 'Weak Renter',
    email: null,
    phone: '5559998888',
    budget: null,
    leadType: 'rental' as const,
    applicationData: {
      monthlyGrossIncome: 'under_2000',
      monthlyRent: '2500_3000',
      employmentStatus: 'not-employed',
      targetMoveInDate: 'browsing',
      numberOfOccupants: 6,
      hasPets: true,
    } as never,
  };

  it('scores a strong rental lead in the hot band (>=75)', () => {
    const r = computeLeadScore(strong);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.priorityTier).toBe('hot');
  });

  it('scores a middling rental lead in the warm band (45-74)', () => {
    const r = computeLeadScore(middling);
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.score).toBeLessThan(75);
    expect(r.priorityTier).toBe('warm');
  });

  it('scores a weak rental lead below the warm band (<45)', () => {
    const r = computeLeadScore(weak);
    expect(r.score).toBeLessThan(45);
    expect(['cold', 'unqualified']).toContain(r.priorityTier);
  });
});

describe('computeLeadScore — buyer engine', () => {
  const strong = {
    name: 'Strong Buyer',
    email: 'b-strong@example.com',
    phone: '5551110000',
    budget: null,
    leadType: 'buyer' as const,
    applicationData: {
      preApprovalStatus: 'yes',
      buyerBudget: '600000',
      buyerTimeline: 'asap',
      propertyType: 'single-family',
      bedrooms: '3',
      bathrooms: '2',
      mustHaves: 'garage,yard',
      housingSituation: 'renting',
      firstTimeBuyer: 'no',
    } as never,
  };

  const middling = {
    name: 'Middling Buyer',
    email: 'b-mid@example.com',
    phone: '5552220000',
    budget: null,
    leadType: 'buyer' as const,
    applicationData: {
      preApprovalStatus: 'not-yet',
      buyerBudget: '300000',
      buyerTimeline: '3-6mo',
      propertyType: 'condo',
      bedrooms: '2',
      housingSituation: 'renting',
      firstTimeBuyer: 'yes',
    } as never,
  };

  const weak = {
    name: 'Weak Buyer',
    email: null,
    phone: '5553330000',
    budget: null,
    leadType: 'buyer' as const,
    applicationData: {
      preApprovalStatus: 'no',
      buyerBudget: '120000',
      buyerTimeline: 'exploring',
      firstTimeBuyer: 'yes',
    } as never,
  };

  it('scores a strong buyer lead in the hot band (>=75)', () => {
    const r = computeLeadScore(strong);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.priorityTier).toBe('hot');
  });

  it('scores a middling buyer lead in the warm band (45-74)', () => {
    const r = computeLeadScore(middling);
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.score).toBeLessThan(75);
    expect(r.priorityTier).toBe('warm');
  });

  it('scores a weak buyer lead below the warm band (<45)', () => {
    const r = computeLeadScore(weak);
    expect(r.score).toBeLessThan(45);
    expect(['cold', 'unqualified']).toContain(r.priorityTier);
  });
});

describe('computeDeterministicScore — default rental template', () => {
  const strong = {
    name: 'S', email: 's@x.com', phone: '5551',
    monthlyRent: '1500_2000', numberOfOccupants: 2,
    employmentStatus: 'employed', monthlyGrossIncome: '7500_plus',
    priorEvictions: 'no', hasPets: 'no',
  };
  const middling = {
    name: 'M', email: 'm@x.com', phone: '5552',
    monthlyRent: '2000_2500', numberOfOccupants: 3,
    employmentStatus: 'part-time', monthlyGrossIncome: '3000_4000',
    priorEvictions: 'no', hasPets: 'no',
  };
  const weak = {
    name: 'W', email: 'w@x.com', phone: '5553',
    monthlyRent: 'under_1000', numberOfOccupants: 6,
    employmentStatus: 'unemployed', monthlyGrossIncome: 'under_2000',
    priorEvictions: 'yes', hasPets: 'yes',
  };

  it('produces a 0-100 score for a strong lead', () => {
    const r = computeDeterministicScore(RENTAL_APPLICATION_TEMPLATE, strong);
    expect(r.hasRules).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('ranks strong > middling > weak monotonically', () => {
    const s = computeDeterministicScore(RENTAL_APPLICATION_TEMPLATE, strong).score;
    const m = computeDeterministicScore(RENTAL_APPLICATION_TEMPLATE, middling).score;
    const w = computeDeterministicScore(RENTAL_APPLICATION_TEMPLATE, weak).score;
    expect(s).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(w);
  });
});

describe('computeDeterministicScore — weight, not point magnitude, controls influence', () => {
  // Regression lock for the scale-distortion defect: two questions with EQUAL
  // weight but different point scales (one tops out at 10, one at 100) must
  // contribute equally. Before the fix the score normalized Σ(pts·w)/Σ(maxPts·w),
  // which let the 0-100 question dominate the equally-weighted 0-10 question:
  // acing the small-scale half scored 9/100 and acing the big-scale half scored
  // 91/100 — wildly off for an equal-weight split.
  const config: IntakeFormConfig = {
    version: 1,
    leadType: 'rental',
    sections: [
      {
        id: 's1',
        title: 'Mixed scales',
        position: 0,
        questions: [
          {
            id: 'q_small',
            type: 'radio',
            label: 'Ready to commit?',
            position: 0,
            required: false,
            options: [
              { value: 'yes', label: 'Yes', scoreValue: 10 },
              { value: 'no', label: 'No', scoreValue: 0 },
            ],
            scoring: { weight: 50 },
          },
          {
            id: 'q_big',
            type: 'select',
            label: 'Income band',
            position: 1,
            required: false,
            options: [
              { value: 'high', label: 'High' },
              { value: 'low', label: 'Low' },
            ],
            scoring: {
              weight: 50,
              mappings: [
                { value: 'high', points: 100 },
                { value: 'low', points: 0 },
              ],
            },
          },
        ],
      },
    ],
  } as unknown as IntakeFormConfig;

  it('acing the small-scale question equals acing the big-scale one (~50 each)', () => {
    const acesSmall = computeDeterministicScore(config, { q_small: 'yes', q_big: 'low' }).score;
    const acesBig = computeDeterministicScore(config, { q_small: 'no', q_big: 'high' }).score;
    expect(acesSmall).toBe(50);
    expect(acesBig).toBe(50);
  });

  it('acing both = 100, failing both = 0', () => {
    expect(computeDeterministicScore(config, { q_small: 'yes', q_big: 'high' }).score).toBe(100);
    expect(computeDeterministicScore(config, { q_small: 'no', q_big: 'low' }).score).toBe(0);
  });
});

describe('computeModelBasedScore — AI scoring model path', () => {
  const model: ScoringModel = {
    totalWeight: 100,
    reasoning: 'test',
    generatedAt: '2026-01-01T00:00:00.000Z',
    leadType: 'rental',
    weights: {
      monthlyRent: {
        weight: 20,
        optionScores: { under_1000: 30, '1000_1500': 50, '1500_2000': 70, '2000_2500': 85, '2500_3000': 95, '3000_plus': 100 },
      },
      monthlyGrossIncome: {
        weight: 25,
        optionScores: { under_2000: 10, '2000_3000': 30, '3000_4000': 50, '4000_5000': 70, '5000_7500': 90, '7500_plus': 100 },
      },
      employmentStatus: {
        weight: 20,
        optionScores: { employed: 100, 'self-employed': 80, 'part-time': 60, student: 40, retired: 70, unemployed: 10 },
      },
      priorEvictions: { weight: 20, optionScores: { no: 100, yes: 0 } },
      numberOfOccupants: {
        weight: 15,
        ranges: [
          { min: 1, max: 3, points: 100 },
          { min: 3, max: 5, points: 70 },
          { min: 5, max: null, points: 40 },
        ],
      },
    },
  };

  it('scores a strong lead hot (>=75)', () => {
    const r = computeModelBasedScore(RENTAL_APPLICATION_TEMPLATE, {
      monthlyRent: '3000_plus', monthlyGrossIncome: '7500_plus',
      employmentStatus: 'employed', priorEvictions: 'no', numberOfOccupants: 2,
    }, model);
    expect(r.score).toBeGreaterThanOrEqual(75);
  });

  it('scores a middling lead warm (45-74)', () => {
    const r = computeModelBasedScore(RENTAL_APPLICATION_TEMPLATE, {
      monthlyRent: '2000_2500', monthlyGrossIncome: '3000_4000',
      employmentStatus: 'part-time', priorEvictions: 'no', numberOfOccupants: 3,
    }, model);
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.score).toBeLessThan(75);
  });

  it('scores a weak lead cold (<45)', () => {
    const r = computeModelBasedScore(RENTAL_APPLICATION_TEMPLATE, {
      monthlyRent: 'under_1000', monthlyGrossIncome: 'under_2000',
      employmentStatus: 'unemployed', priorEvictions: 'yes', numberOfOccupants: 6,
    }, model);
    expect(r.score).toBeLessThan(45);
  });
});
