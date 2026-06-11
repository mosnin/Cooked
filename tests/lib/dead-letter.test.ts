import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertMock, fromMock } = vi.hoisted(() => {
  const insertMock = vi.fn(async (_row?: Record<string, unknown>) => ({ error: null }));
  const fromMock = vi.fn((_table?: string) => ({ insert: insertMock }));
  return { insertMock, fromMock };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }));

import { recordDeadLetter, originalEventData } from '@/lib/inngest/dead-letter';

describe('recordDeadLetter', () => {
  beforeEach(() => {
    insertMock.mockClear();
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockClear();
  });

  it('inserts a pending DeadLetterEvent with the error message and stack', async () => {
    const err = new Error('boom');
    await recordDeadLetter({ spaceId: 'sp1', eventType: 'studio/post.scheduled', eventPayload: { postId: 'p1' }, error: err });
    expect(fromMock).toHaveBeenCalledWith('DeadLetterEvent');
    const row = insertMock.mock.calls[0][0] as Record<string, unknown>;
    expect(row.spaceId).toBe('sp1');
    expect(row.eventType).toBe('studio/post.scheduled');
    expect(row.eventPayload).toEqual({ postId: 'p1' });
    expect(row.errorMessage).toBe('boom');
    expect(row.status).toBe('pending');
    expect(typeof row.errorStack).toBe('string');
  });

  it('defaults a missing spaceId to "unknown" (column is NOT NULL)', async () => {
    await recordDeadLetter({ spaceId: '', eventType: 'x', error: 'oops' });
    expect((insertMock.mock.calls[0][0] as Record<string, unknown>).spaceId).toBe('unknown');
  });

  it('never throws even if the insert rejects (a DLQ write must not cascade)', async () => {
    insertMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      recordDeadLetter({ spaceId: 'sp1', eventType: 'x', error: new Error('e') }),
    ).resolves.toBeUndefined();
  });

  it('truncates an enormous error message', async () => {
    await recordDeadLetter({ spaceId: 'sp1', eventType: 'x', error: new Error('y'.repeat(5000)) });
    const row = insertMock.mock.calls[0][0] as Record<string, string>;
    expect(row.errorMessage.length).toBe(2000);
  });
});

describe('originalEventData', () => {
  it('reads the direct shape (event.data)', () => {
    expect(originalEventData({ event: { data: { postId: 'p1' } } })).toEqual({ postId: 'p1' });
  });
  it('reads the wrapped failure-envelope shape (event.data.event.data)', () => {
    expect(originalEventData({ event: { data: { event: { data: { postId: 'p2' } } } } })).toEqual({ postId: 'p2' });
  });
  it('is empty-safe', () => {
    expect(originalEventData(undefined)).toEqual({});
    expect(originalEventData({})).toEqual({});
  });
});
