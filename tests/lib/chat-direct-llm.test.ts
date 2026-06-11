/**
 * Tests for the Phase 4 direct LLM path.
 *
 * Mocks getLLMClient → exposes chat.completions.create so we can assert the
 * exact provider-shaped payload (system message, history limit, multimodal
 * blocks) and verify the response shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock('@/lib/llm', async () => {
  const actual = await vi.importActual<typeof import('@/lib/llm')>('@/lib/llm');
  return {
    ...actual,
    getLLMClient: () => ({
      chat: {
        completions: {
          create: createMock,
        },
      },
    }),
  };
});

import { runDirectChat, CHIPPI_INSTRUCTIONS_LITE } from '@/lib/chat/direct-llm';

function happyResponse(text: string, usage?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}) {
  return {
    choices: [{ message: { content: text } }],
    usage: usage ?? { prompt_tokens: 10, completion_tokens: 5 },
  };
}

beforeEach(() => {
  createMock.mockReset();
});

describe('runDirectChat — wiring', () => {
  it('passes the system message verbatim, no tools', async () => {
    createMock.mockResolvedValue(happyResponse('A CMA is a comparative market analysis.'));
    const result = await runDirectChat({
      model: 'openai/gpt-5.5',
      systemMessage: 'system prompt',
      history: [],
      userMessage: "what's a CMA?",
    });
    expect(createMock).toHaveBeenCalledTimes(1);
    const call = createMock.mock.calls[0][0];
    expect(call.model).toBe('openai/gpt-5.5');
    expect(call.tools).toBeUndefined();
    expect(call.stream).toBe(false);
    expect(call.messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(call.messages.at(-1).role).toBe('user');
    expect(result.text).toBe('A CMA is a comparative market analysis.');
    expect(result.provider).toBe('openai');
    expect(result.usage.promptTokens).toBe(10);
    expect(result.usage.completionTokens).toBe(5);
  });

  it('caps history at the last 4 turns (8 messages)', async () => {
    createMock.mockResolvedValue(happyResponse('ok'));
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `t${i}`,
    }));
    await runDirectChat({
      model: 'openai/gpt-5.5',
      systemMessage: 'sys',
      history,
      userMessage: 'now',
    });
    const call = createMock.mock.calls[0][0];
    // system + (at most 4 turns × 2 messages = 8) + the new user message = 10 total
    expect(call.messages.length).toBeLessThanOrEqual(10);
    // Last history message preserved is t11 (latest).
    expect(call.messages[call.messages.length - 2].content).toBe('t11');
  });

  it('sends Anthropic-shaped image block for an image attachment under an anthropic model', async () => {
    createMock.mockResolvedValue(happyResponse('Looks like a 3-bed.'));
    await runDirectChat({
      model: 'anthropic/claude-opus-4.7',
      systemMessage: 'sys',
      history: [],
      userMessage: 'What is this?',
      attachments: [
        { id: 'a', filename: 'p.png', mimeType: 'image/png', url: 'https://x/p.png' },
      ],
    });
    const call = createMock.mock.calls[0][0];
    const userMsg = call.messages.at(-1);
    expect(Array.isArray(userMsg.content)).toBe(true);
    const imgBlock = (userMsg.content as Array<{ type: string }>).find(
      (b) => b.type === 'image',
    );
    expect(imgBlock).toBeTruthy();
  });

  it('sends OpenAI-shaped image_url block under an openai model', async () => {
    createMock.mockResolvedValue(happyResponse('Looks like a kitchen.'));
    await runDirectChat({
      model: 'openai/gpt-5.5',
      systemMessage: 'sys',
      history: [],
      userMessage: 'What is this?',
      attachments: [
        { id: 'a', filename: 'k.jpg', mimeType: 'image/jpeg', url: 'https://x/k.jpg' },
      ],
    });
    const call = createMock.mock.calls[0][0];
    const userMsg = call.messages.at(-1);
    const imgBlock = (userMsg.content as Array<{ type: string }>).find(
      (b) => b.type === 'image_url',
    );
    expect(imgBlock).toBeTruthy();
  });

  it('emits a fallbackNote for Grok with image attachment', async () => {
    createMock.mockResolvedValue(happyResponse(
      'I can\'t see images directly — try a model with vision.',
    ));
    const result = await runDirectChat({
      model: 'x-ai/grok-4.3',
      systemMessage: 'sys',
      history: [],
      userMessage: 'What is this listing?',
      attachments: [
        { id: 'a', filename: 'p.png', mimeType: 'image/png', url: 'https://x/p.png' },
      ],
    });
    expect(result.fallbackNote).toMatch(/Grok/i);
    expect(result.provider).toBe('xai');
  });
});

describe('CHIPPI_INSTRUCTIONS_LITE', () => {
  it('is significantly smaller than the full Chippi instructions', () => {
    // ~300 token budget — assert a hard char ceiling that catches any
    // accidental bloat. ~4 chars/token → 1500 chars is the soft cap.
    expect(CHIPPI_INSTRUCTIONS_LITE.length).toBeLessThan(1500);
    expect(CHIPPI_INSTRUCTIONS_LITE).toMatch(/Chippi/);
    expect(CHIPPI_INSTRUCTIONS_LITE).toMatch(/answer/i);
  });

  it('makes it clear there are no tools on this path', () => {
    expect(CHIPPI_INSTRUCTIONS_LITE.toLowerCase()).toMatch(/no.*action|do not take action|action path/);
  });
});
