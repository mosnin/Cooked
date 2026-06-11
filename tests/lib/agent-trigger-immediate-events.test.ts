import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseImmediateEvents } from '@/lib/agent/trigger-policy';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseImmediateEvents', () => {
  it('defaults to all when empty or all', () => {
    expect([...parseImmediateEvents(undefined)].sort()).toEqual([
      'application_submitted',
      'deal_stage_changed',
      'goal_completed',
      'inbound_message',
      'new_lead',
      'demo_completed',
    ]);
    expect([...parseImmediateEvents('all')].sort()).toEqual([
      'application_submitted',
      'deal_stage_changed',
      'goal_completed',
      'inbound_message',
      'new_lead',
      'demo_completed',
    ]);
  });

  it('returns only valid subset', () => {
    expect([...parseImmediateEvents('demo_completed,application_submitted')].sort()).toEqual([
      'application_submitted',
      'demo_completed',
    ]);
  });

  it('fails safe to all on invalid token and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect([...parseImmediateEvents('demo_completed,nope')].sort()).toEqual([
      'application_submitted',
      'deal_stage_changed',
      'goal_completed',
      'inbound_message',
      'new_lead',
      'demo_completed',
    ]);
    expect(warn).toHaveBeenCalled();
  });


  it('warns once per repeated invalid config value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    parseImmediateEvents('new_lead,still_nope');
    parseImmediateEvents('new_lead,still_nope');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
