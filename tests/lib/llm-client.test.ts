import { describe, it, expect, afterEach } from 'vitest';
import { getLLMClient } from '@/lib/llm';

/**
 * Guards that the shared LLM client keeps bounded timeout/retry settings. The
 * OpenAI SDK defaults (600s timeout, 2 retries) let a hung upstream hold a
 * function open for minutes and triple token spend — if these caps silently
 * revert, that cost/latency amplifier comes back.
 */
describe('getLLMClient latency/cost caps', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env = { ...orig };
  });

  it('caps timeout (120s) and retries (1) on the OpenRouter path', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const c = getLLMClient() as unknown as { timeout: number; maxRetries: number };
    expect(c.timeout).toBe(120_000);
    expect(c.maxRetries).toBe(1);
  });

  it('caps timeout and retries on the OpenAI-direct fallback', () => {
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    const c = getLLMClient() as unknown as { timeout: number; maxRetries: number };
    expect(c.timeout).toBe(120_000);
    expect(c.maxRetries).toBe(1);
  });
});
