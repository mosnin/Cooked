import { describe, expect, it } from 'vitest';
import { coolDownDaysFor } from '@/lib/briefing/tips/cool-down';

describe('briefing tips — cool-down policy', () => {
  it('single-subject tips default to 7-day cool-down after shown', () => {
    expect(coolDownDaysFor('hot_lead_dormant', 'shown')).toBe(7);
    expect(coolDownDaysFor('deal_closing_soon', 'shown')).toBe(7);
    expect(coolDownDaysFor('won_deal_review_ask', 'shown')).toBe(7);
  });

  it('segment tips get 30-day cool-down — they need time to work', () => {
    expect(coolDownDaysFor('past_client_referral', 'shown')).toBe(30);
    expect(coolDownDaysFor('unworked_tag', 'shown')).toBe(30);
  });

  it('trend tips get 14-day cool-down — week-over-week stability', () => {
    expect(coolDownDaysFor('overdue_pileup', 'shown')).toBe(14);
  });

  it('unknown category falls back to 7-day default', () => {
    expect(coolDownDaysFor('made_up_category', 'shown')).toBe(7);
  });

  it('acted outcome resets the cool-down — if the trigger fires fresh, fire again', () => {
    expect(coolDownDaysFor('hot_lead_dormant', 'acted')).toBe(0);
    expect(coolDownDaysFor('past_client_referral', 'acted')).toBe(0);
  });

  it('dismissed outcome gets 60-day silence — explicit no is a stronger signal', () => {
    expect(coolDownDaysFor('hot_lead_dormant', 'dismissed')).toBe(60);
    expect(coolDownDaysFor('overdue_pileup', 'dismissed')).toBe(60);
  });
});
