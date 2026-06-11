/**
 * setEmailStar — the only piece of email logic that's net-new in PR #163.
 *
 * The star toggle writes through to Gmail's STARRED label (no local
 * schema). What's worth locking in:
 *   - On star=true → calls GMAIL_ADD_LABEL_TO_EMAIL with STARRED label
 *   - On star=false → calls GMAIL_REMOVE_LABEL_FROM_EMAIL with STARRED label
 *   - Outlook → returns a clean unsupported error without calling Composio
 *   - Composio !successful → surfaces error, doesn't throw
 *   - Composio throw → caught + surfaced as error
 *
 * Drift in any of these means a click on a star silently fails (or worse,
 * succeeds against the wrong message) — bad outcome.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/integrations/composio', () => ({
  composioConfigured: () => true,
  executeToolForEntity: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

import { setEmailStar } from '@/lib/communication/connect';
import { executeToolForEntity } from '@/lib/integrations/composio';

const mockExecute = vi.mocked(executeToolForEntity);

describe('setEmailStar', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('star=true → calls GMAIL_ADD_LABEL_TO_EMAIL with STARRED', async () => {
    mockExecute.mockResolvedValue({ successful: true, data: {} } as never);
    const result = await setEmailStar({
      entityId: 'user_123',
      provider: 'gmail',
      messageId: 'msg_abc',
      starred: true,
    });
    expect(result.ok).toBe(true);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0][0];
    expect(call.slug).toBe('GMAIL_ADD_LABEL_TO_EMAIL');
    expect(call.entityId).toBe('user_123');
    expect(call.arguments).toMatchObject({
      message_id: 'msg_abc',
      label_ids: ['STARRED'],
    });
  });

  it('star=false → calls GMAIL_REMOVE_LABEL_FROM_EMAIL with STARRED', async () => {
    mockExecute.mockResolvedValue({ successful: true, data: {} } as never);
    const result = await setEmailStar({
      entityId: 'user_123',
      provider: 'gmail',
      messageId: 'msg_abc',
      starred: false,
    });
    expect(result.ok).toBe(true);
    const call = mockExecute.mock.calls[0][0];
    expect(call.slug).toBe('GMAIL_REMOVE_LABEL_FROM_EMAIL');
    expect(call.arguments).toMatchObject({
      message_id: 'msg_abc',
      label_ids: ['STARRED'],
    });
  });

  it('outlook provider → returns unsupported error and skips Composio', async () => {
    const result = await setEmailStar({
      entityId: 'user_123',
      provider: 'outlook',
      messageId: 'msg_abc',
      starred: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('outlook_star_unsupported');
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('Composio !successful → surfaces error without throwing', async () => {
    mockExecute.mockResolvedValue({
      successful: false,
      error: 'rate_limited',
    } as never);
    const result = await setEmailStar({
      entityId: 'user_123',
      provider: 'gmail',
      messageId: 'msg_abc',
      starred: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('rate_limited');
  });

  it('Composio throw → caught and surfaced as error', async () => {
    mockExecute.mockRejectedValue(new Error('network down'));
    const result = await setEmailStar({
      entityId: 'user_123',
      provider: 'gmail',
      messageId: 'msg_abc',
      starred: true,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });
});
