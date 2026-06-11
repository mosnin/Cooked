/**
 * Tests for the Phase 4 dual-path router.
 *
 * The router is a pure function — no I/O — so the surface to cover is the
 * heuristic itself: which messages route 'direct', which route 'agent', and
 * the escalation phrase detector.
 */

import { describe, it, expect } from 'vitest';
import {
  decideRoute,
  decideBrokerRoute,
  shouldEscalate,
  ACTION_VERBS_REGEX,
} from '@/lib/chat/router';

describe('decideRoute', () => {
  it('routes a generic (non-data) question to direct', () => {
    expect(decideRoute("what's a CMA?")).toBe('direct');
    expect(decideRoute('Explain the 1031 exchange rules to me.')).toBe('direct');
    expect(decideRoute('Summarize this for me.')).toBe('direct');
  });

  it('routes reads of the realtor data to agent — they need tools', () => {
    // These are READS, not mutations, but answering them requires the read
    // tools (pipeline_summary, find_person, find_quiet_hot_persons, …). The
    // toolless direct path can only deflect, so they must reach the agent.
    expect(decideRoute("Show today's pipeline")).toBe('agent');
    expect(decideRoute('Find hot leads')).toBe('agent');
    expect(decideRoute('Plan my day')).toBe('agent');
    expect(decideRoute('Who is my hottest lead?')).toBe('agent');
    expect(decideRoute("what's overdue?")).toBe('agent');
    expect(decideRoute('list my deals')).toBe('agent');
  });

  it('routes action verbs to agent', () => {
    expect(decideRoute('Add Preston as a contact')).toBe('agent');
    expect(decideRoute('Send Preston the follow-up email')).toBe('agent');
    expect(decideRoute('Schedule a tour for tomorrow at 3pm')).toBe('agent');
    expect(decideRoute('Mark this deal as won.')).toBe('agent');
    expect(decideRoute('Draft a check-in message for Sarah')).toBe('agent');
    expect(decideRoute('Create a new deal for 123 Oak Ave')).toBe('agent');
    expect(decideRoute('Update his lead score to 80')).toBe('agent');
    expect(decideRoute('Reach out to the buyer about closing')).toBe('agent');
    expect(decideRoute('Book a showing for Saturday')).toBe('agent');
    expect(decideRoute('Cancel the 5pm tour')).toBe('agent');
    expect(decideRoute('Reply to Sarah saying yes')).toBe('agent');
    expect(decideRoute('Text Preston the address')).toBe('agent');
  });

  it('is case insensitive', () => {
    expect(decideRoute('SEND PRESTON THE EMAIL')).toBe('agent');
    expect(decideRoute('add a contact')).toBe('agent');
    expect(decideRoute('Add a contact')).toBe('agent');
  });

  it('matches action verbs as standalone words, not substrings', () => {
    // \badd\b matches whole-word 'add' only, so 'addendum' does not match;
    // \bsend\b does not match 'sender'. Neither line contains a data-read
    // word, so both stay on the direct path.
    expect(decideRoute('The addendum was unclear')).toBe('direct');
    expect(decideRoute('The sender was anonymous.')).toBe('direct');
  });

  it('routes attachments without action verbs to direct (multimodal Q&A)', () => {
    const att = [{ id: 'a1', mimeType: 'image/png' }];
    expect(decideRoute('What is this listing showing?', att)).toBe('direct');
    expect(decideRoute('Summarize this MLS sheet', att)).toBe('direct');
    expect(decideRoute('', att)).toBe('direct');
  });

  it('still routes to agent when both attachments AND action verbs present', () => {
    const att = [{ id: 'a1', mimeType: 'image/png' }];
    expect(decideRoute('Send this photo to Preston', att)).toBe('agent');
    expect(decideRoute('Add this property to the deal', att)).toBe('agent');
  });

  it('empty messages route direct (nothing to act on)', () => {
    expect(decideRoute('')).toBe('direct');
    expect(decideRoute('   ')).toBe('direct');
  });

  it('exposes the action verb regex for documentation', () => {
    expect(ACTION_VERBS_REGEX).toBeInstanceOf(RegExp);
    expect(ACTION_VERBS_REGEX.test('add')).toBe(true);
    expect(ACTION_VERBS_REGEX.test('addendum')).toBe(false);
  });

  it('routes integration reads to agent — only the agent has integration tools', () => {
    // These were the verbatim "Chippi claims it has no tools" reports: the
    // old regexes matched neither ("emails" wasn't a workspace noun, "check"
    // isn't an action verb), so a Gmail-connected realtor's question landed
    // on the toolless direct path, which can only deflect.
    expect(decideRoute('do I have any new emails?')).toBe('agent');
    expect(decideRoute('check my gmail')).toBe('agent');
    expect(decideRoute('is my gmail connected?')).toBe('agent');
    expect(decideRoute('what integrations do I have?')).toBe('agent');
    expect(decideRoute('anything in slack?')).toBe('agent');
    expect(decideRoute('summarize my inbox from today')).toBe('agent');
    expect(decideRoute('connect hubspot')).toBe('agent');
  });
});

describe('decideBrokerRoute', () => {
  it('routes broker-domain reads to agent — the snapshot path has no broker tools', () => {
    // The shared realtor router sent all of these to the broker direct path,
    // whose prompt is INSTRUCTED to say it doesn't have the answer — brokers
    // read that as "Chippi has no tools".
    expect(decideBrokerRoute("how's team health?")).toBe('agent');
    expect(decideBrokerRoute('audit response times')).toBe('agent');
    expect(decideBrokerRoute('which agents are at risk?')).toBe('agent');
    expect(decideBrokerRoute('show realtor performance')).toBe('agent');
    expect(decideBrokerRoute("who's unassigned?")).toBe('agent');
    expect(decideBrokerRoute('reassign Maria to John')).toBe('agent');
    expect(decideBrokerRoute('what does the leaderboard look like?')).toBe('agent');
    expect(decideBrokerRoute('brokerage revenue this quarter')).toBe('agent');
  });

  it('keeps generic Q&A on direct', () => {
    expect(decideBrokerRoute("what's a CMA?")).toBe('direct');
    expect(decideBrokerRoute('Explain the 1031 exchange rules to me.')).toBe('direct');
  });

  it('inherits the realtor routing for shared phrasings', () => {
    expect(decideBrokerRoute('Send Preston the follow-up email')).toBe('agent');
    expect(decideBrokerRoute('do I have any new emails?')).toBe('agent');
  });
});

describe('shouldEscalate', () => {
  it('escalates when the model says it would need to actually do something', () => {
    expect(shouldEscalate("I'd need to actually create that contact for you.")).toBe(true);
    expect(shouldEscalate('I would need to actually send that.')).toBe(true);
    expect(shouldEscalate("I'll need to actually create him in the CRM first.")).toBe(true);
    expect(shouldEscalate("Let me create that contact for you.")).toBe(true);
  });

  it('escalates on explicit refusals', () => {
    expect(shouldEscalate("I can't send messages from here.")).toBe(true);
    expect(shouldEscalate("I cannot run that action.")).toBe(true);
    expect(shouldEscalate("I can't actually trigger that.")).toBe(true);
  });

  it('escalates on hand-off language', () => {
    expect(
      shouldEscalate("Let me hand this to Chippi's tools for the actual send."),
    ).toBe(true);
    expect(shouldEscalate("I'll hand this over to the agent.")).toBe(true);
  });

  it('does not escalate on plain Q&A responses', () => {
    expect(shouldEscalate('Preston is your hottest lead — emailed Tuesday.')).toBe(false);
    expect(
      shouldEscalate('A CMA (Comparative Market Analysis) compares recent sales nearby.'),
    ).toBe(false);
    expect(shouldEscalate('This MLS sheet shows a 3-bed, 2-bath at $450k.')).toBe(false);
  });

  it('does not escalate on empty input', () => {
    expect(shouldEscalate('')).toBe(false);
    expect(shouldEscalate('   ')).toBe(false);
  });
});
