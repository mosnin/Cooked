import { describe, it, expect } from 'vitest';
import { validateSendPayload } from '@/lib/communication/validation';

describe('validateSendPayload — email channel', () => {
  it('accepts a minimal valid email', () => {
    const res = validateSendPayload({
      channel: 'email',
      to: 'jane@example.com',
      subject: 'Hi',
      body: 'Hello there.',
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.value.channel === 'email') {
      expect(res.value.to).toEqual(['jane@example.com']);
      expect(res.value.cc).toEqual([]);
      expect(res.value.bcc).toEqual([]);
      expect(res.value.subject).toBe('Hi');
      expect(res.value.body).toBe('Hello there.');
    } else {
      throw new Error('expected ok=true with email channel');
    }
  });

  it('splits comma-separated recipients and de-dupes', () => {
    const res = validateSendPayload({
      channel: 'email',
      to: 'a@x.com, b@x.com,  A@X.com ',
      subject: 'Hello',
      body: 'Body.',
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.value.channel === 'email') {
      // Original case preserved; dedupe is case-insensitive.
      expect(res.value.to).toEqual(['a@x.com', 'b@x.com']);
    }
  });

  it('rejects empty To', () => {
    const res = validateSendPayload({
      channel: 'email',
      to: '',
      subject: 'x',
      body: 'y',
    });
    expect(res).toEqual({ ok: false, error: 'Add a recipient.' });
  });

  it('rejects malformed email', () => {
    const res = validateSendPayload({
      channel: 'email',
      to: 'not-an-email',
      subject: 'x',
      body: 'y',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('Invalid email');
  });

  it('rejects missing subject', () => {
    const res = validateSendPayload({
      channel: 'email',
      to: 'a@b.com',
      subject: '',
      body: 'hi',
    });
    expect(res).toEqual({ ok: false, error: 'Subject is required.' });
  });

  it('rejects empty body', () => {
    const res = validateSendPayload({
      channel: 'email',
      to: 'a@b.com',
      subject: 'x',
      body: '   ',
    });
    expect(res).toEqual({ ok: false, error: 'Write something in the body.' });
  });
});

describe('validateSendPayload — whatsapp channel', () => {
  it('accepts a valid E.164 phone + body', () => {
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: '+15551234567',
      body: 'Hello there.',
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.value.channel === 'whatsapp') {
      expect(res.value.to).toBe('+15551234567');
      expect(res.value.body).toBe('Hello there.');
    } else {
      throw new Error('expected ok=true with whatsapp channel');
    }
  });

  it('strips spaces, hyphens, and parens from the phone', () => {
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: '+1 (555) 123-4567',
      body: 'Hi.',
    });
    expect(res.ok).toBe(true);
    if (res.ok && res.value.channel === 'whatsapp') {
      expect(res.value.to).toBe('+15551234567');
    }
  });

  it('accepts an array of length one as the phone', () => {
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: ['+15551234567'],
      body: 'Hi.',
    });
    expect(res.ok).toBe(true);
  });

  it('rejects an empty phone', () => {
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: '',
      body: 'Hi.',
    });
    expect(res).toEqual({ ok: false, error: 'Add a phone number.' });
  });

  it('rejects a malformed phone', () => {
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: 'not a number',
      body: 'Hi.',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('phone number');
  });

  it('rejects an empty body', () => {
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: '+15551234567',
      body: '   ',
    });
    expect(res).toEqual({ ok: false, error: 'Write something to send.' });
  });

  it('does not require subject for whatsapp', () => {
    // Passing subject is harmless; validator should not flag it.
    const res = validateSendPayload({
      channel: 'whatsapp',
      to: '+15551234567',
      subject: 'ignored',
      body: 'Hi.',
    });
    expect(res.ok).toBe(true);
  });

  it('defaults to email when channel is missing', () => {
    // Backwards compatibility: legacy callers that don't pass channel
    // must continue to be treated as email and validated accordingly.
    const res = validateSendPayload({
      to: 'a@b.com',
      subject: 'x',
      body: 'y',
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.channel).toBe('email');
  });
});
