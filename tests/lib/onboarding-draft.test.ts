/**
 * Tests for the deterministic onboarding-reveal draft generator.
 *
 * The reveal is the highest-stakes moment in onboarding — these lock
 * in that the draft is personalized, tone-correct, and never produces
 * a broken sentence regardless of which inputs are missing.
 */

import { describe, it, expect } from 'vitest';
import { composeOnboardingDraft } from '@/lib/onboarding-draft';

const base = {
  name: 'Sarah Chen',
  businessName: 'Coastal Realty',
  tone: 'warm' as const,
  clientTypes: ['first_time_buyers'],
  leadSources: ['zillow'],
};

describe('composeOnboardingDraft', () => {
  it('personalizes with first name, business, source, and tone', () => {
    const { frame, body } = composeOnboardingDraft(base);
    expect(frame).toContain('Zillow');
    expect(body).toContain('Sarah');         // first name, not full name
    expect(body).not.toContain('Sarah Chen'); // never the full name in the sign-off body opener
    expect(body).toContain('Coastal Realty');
    expect(body).toContain('via Zillow');
  });

  it('warm tone includes an audience-aware clause when one matches', () => {
    const { body } = composeOnboardingDraft({ ...base, clientTypes: ['investors'] });
    expect(body.toLowerCase()).toContain('cap rate');
  });

  it('direct tone is terse, leads with the ask, omits the audience clause', () => {
    const { body } = composeOnboardingDraft({ ...base, tone: 'direct' });
    expect(body).toContain('target area');
    expect(body).toContain('timeline');
    // The warm audience clauses must not leak into the direct template.
    expect(body.toLowerCase()).not.toContain('cap rate');
    expect(body.toLowerCase()).not.toContain('no pressure');
  });

  it('drops the "via X" clause cleanly when no lead source is selected', () => {
    const { frame, body } = composeOnboardingDraft({ ...base, leadSources: [] });
    expect(body).not.toContain('via');
    expect(frame).toContain('new lead reaches out');
    // No double spaces from an omitted clause.
    expect(body).not.toMatch(/ {2,}/);
  });

  it('uses the first lead source as primary when several are selected', () => {
    const { frame } = composeOnboardingDraft({ ...base, leadSources: ['facebook', 'zillow'] });
    expect(frame).toContain('Facebook');
    expect(frame).not.toContain('Zillow');
  });

  it('falls back gracefully when name and business are empty', () => {
    const { body } = composeOnboardingDraft({
      ...base,
      name: '',
      businessName: '',
    });
    expect(body).toContain('there');         // name fallback
    expect(body).toContain('your business'); // business fallback
    expect(body).not.toMatch(/ {2,}/);       // no spacing artifacts
  });

  it('never produces double spaces regardless of input combination', () => {
    const tones = ['warm', 'direct'] as const;
    const sources = [[], ['zillow'], ['sphere'], ['idx_website']];
    const audiences = [[], ['luxury'], ['renters'], ['sellers']];
    for (const tone of tones) {
      for (const leadSources of sources) {
        for (const clientTypes of audiences) {
          const { body, frame } = composeOnboardingDraft({
            ...base, tone, leadSources, clientTypes,
          });
          expect(body, `${tone}/${leadSources}/${clientTypes}`).not.toMatch(/ {2,}/);
          expect(frame).not.toMatch(/ {2,}/);
          expect(body.length).toBeGreaterThan(40); // always a real message
        }
      }
    }
  });
});
