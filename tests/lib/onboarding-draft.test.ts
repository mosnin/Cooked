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
  businessName: 'Coastal Sales',
  tone: 'warm' as const,
  clientTypes: ['mid_market'],
  leadSources: ['linkedin'],
};

describe('composeOnboardingDraft', () => {
  it('personalizes with first name, business, source, and tone', () => {
    const { frame, body } = composeOnboardingDraft(base);
    expect(frame).toContain('LinkedIn');
    expect(body).toContain('Sarah');         // first name, not full name
    expect(body).not.toContain('Sarah Chen'); // never the full name in the sign-off body opener
    expect(body).toContain('Coastal Sales');
    expect(body).toContain('via LinkedIn');
  });

  it('warm tone includes an audience-aware clause when one matches', () => {
    const { body } = composeOnboardingDraft({ ...base, clientTypes: ['enterprise'] });
    expect(body.toLowerCase()).toContain('procurement');
  });

  it('direct tone is terse, leads with the ask, omits the audience clause', () => {
    const { body } = composeOnboardingDraft({ ...base, tone: 'direct' });
    expect(body).toContain('problem');
    expect(body).toContain('timeline');
    // The warm audience clauses must not leak into the direct template.
    expect(body.toLowerCase()).not.toContain('procurement');
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
    const { frame } = composeOnboardingDraft({ ...base, leadSources: ['facebook', 'linkedin'] });
    expect(frame).toContain('Facebook');
    expect(frame).not.toContain('LinkedIn');
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
    const sources = [[], ['linkedin'], ['sphere'], ['company_website']];
    const audiences = [[], ['enterprise'], ['inbound_leads'], ['smb']];
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
