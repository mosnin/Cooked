/**
 * Direct LLM path — Phase 4.
 *
 * The dual-path router (`lib/chat/router.ts`) sends most chat turns through
 * here instead of the Modal agent. This path is intentionally simple:
 *
 *   system prompt (CHIPPI_INSTRUCTIONS_LITE, ~300 tokens)
 *   + vector context block (from lib/chat/vector-context.ts)
 *   + last N conversation turns
 *   + user message (+ multimodal blocks from lib/chat/multimodal.ts)
 *   → OpenAI Chat Completions, streamed.
 *
 * No agents SDK, no tool registry, no Modal hop. Sub-second time-to-first-
 * token in the happy path. The agent path is still there for anything that
 * actually needs to act.
 *
 * Provider quirks: handled by reusing detectProvider() from lib/llm.ts and
 * by buildMultimodalContent() above. Anthropic cache markers are NOT applied
 * here for v1 — the direct path's system prompt is ~300 tokens, well under
 * Anthropic's 1024-token cache floor, so the markers would be a no-op
 * anyway. If we grow the lite prompt past 1024 tokens we'll add them.
 */

import OpenAI from 'openai';
import { getLLMClient, detectProvider } from '@/lib/llm';
import {
  buildMultimodalContent,
  type MultimodalAttachment,
  type ContentBlock,
} from './multimodal';

/**
 * The direct path's system prompt. Slimmer than the full CHIPPI_INSTRUCTIONS
 * because the direct path has no tools — every line about tool-first,
 * planning, draft-vs-send, integrations, intake form, etc. is dead weight.
 *
 * What stays: identity, voice, the trust contract framing, the "lead with
 * the answer / no narration" output discipline.
 *
 * Kept as a `const` here rather than centralized so the lite path is
 * self-contained — a Phase 4 reviewer can see the entire direct prompt
 * surface without chasing imports.
 */
export const CHIPPI_INSTRUCTIONS_LITE = `
You are Chippi, an AI cowork for a real estate professional. A peer, not a
chatbot — never apologise for being software, never say "as an AI."

# What you can do here
This is the fast Q&A surface. You answer questions, summarize attachments
(images, PDFs), explain real estate concepts, and reason about the realtor's
workspace using the context you're given. You do NOT take action here — no
sending email, no creating contacts, no scheduling. If the realtor asks for
an action, say so plainly so they can phrase it as a request and the action
path will pick it up.

# Output
Lead with the answer. Short for simple, structured for synthesis. No hedging
boilerplate, no emoji, no exclamation, no narration of what you would do.
Use markdown sparingly — bold for the single most load-bearing phrase,
lists only when listing.

# Workspace context
If a "Workspace context" block is in this prompt, treat it as ground truth
about the realtor's CRM. Name contacts/deals/properties verbatim from the
block when relevant. Don't fabricate details — if the block doesn't
mention something, say you don't know and suggest the realtor look it up.
`.trim();

export type DirectHistoryRow = {
  role: 'user' | 'assistant';
  content: string;
};

export interface DirectChatInput {
  model: string;
  /** Tiny — the full system message including the lite prompt + workspace
   *  context block + any space-level profile text. Composed by the caller. */
  systemMessage: string;
  /** Last few turns (chronological, oldest first). */
  history: DirectHistoryRow[];
  userMessage: string;
  attachments?: MultimodalAttachment[];
  signal?: AbortSignal;
}

export interface DirectChatResult {
  /** The model's final text (full, accumulated). */
  text: string;
  /** Provider prefix derived from model. For ChatUsage.provider telemetry. */
  provider: string;
  /** Token usage if the provider returned it (OpenRouter does for most). */
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number };
  /** Fallback note from the multimodal builder; '' when all attachments
   *  were accepted by the provider. Surfaced to the UI as a soft toast. */
  fallbackNote: string;
}

const HISTORY_TURNS_DEFAULT = 4;

/**
 * Run a direct chat completion (non-streaming). The chat endpoint wraps
 * the response in SSE for the browser; doing the streaming here would
 * duplicate work for v1 and complicate the escalation check (we need the
 * full text to scan for escalation phrases anyway).
 *
 * Throws on transport / API errors. The caller maps that to a turn-level
 * error event.
 */
export async function runDirectChat(input: DirectChatInput): Promise<DirectChatResult> {
  const client = getLLMClient();
  const provider = detectProvider(input.model);

  const userBlocks = buildContent(input);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: input.systemMessage },
    ...input.history.slice(-HISTORY_TURNS_DEFAULT * 2).map((h) => ({
      role: h.role,
      content: h.content,
    })),
    // Cast: OpenAI SDK's strict types don't include Anthropic / Google
    // block shapes, but OpenRouter forwards them verbatim. We've kept the
    // shapes documented in multimodal.ts.
    {
      role: 'user',
      content: userBlocks.blocks as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[],
    },
  ];

  const res = await client.chat.completions.create(
    {
      model: input.model,
      messages,
      // No tools — that's the whole point of the direct path.
      // Modest cap to keep direct answers tight; the full agent has higher
      // ceilings for long-form drafts.
      max_tokens: 800,
      stream: false,
    },
    { signal: input.signal },
  );

  const choice = res.choices[0];
  const text = choice?.message?.content;
  let finalText = '';
  if (typeof text === 'string') {
    finalText = text;
  } else if (Array.isArray(text)) {
    // Some providers (Anthropic, Gemini via OpenRouter) return content as
    // an array of blocks even on output. Stitch the text blocks together.
    finalText = (text as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('');
  }

  // Some providers return usage at the top level; OpenAI puts it in `usage`.
  // OpenRouter normalizes to the OpenAI shape but the cached-tokens field
  // is provider-specific.
  const u = res.usage as
    | (typeof res.usage & { prompt_tokens_details?: { cached_tokens?: number } })
    | undefined;
  const promptTokens = u?.prompt_tokens ?? 0;
  const completionTokens = u?.completion_tokens ?? 0;
  const cachedTokens = u?.prompt_tokens_details?.cached_tokens ?? 0;

  return {
    text: finalText,
    provider,
    usage: { promptTokens, completionTokens, cachedTokens },
    fallbackNote: userBlocks.fallbackNote,
  };
}

function buildContent(input: DirectChatInput): {
  blocks: ContentBlock[];
  fallbackNote: string;
} {
  const built = buildMultimodalContent(
    input.model,
    input.userMessage,
    input.attachments ?? [],
  );
  // Splice the fallback note onto the user text block — gives the model
  // an explicit reason any attachment was missing, so it can reference it
  // in the reply instead of pretending it saw something it didn't.
  if (built.fallbackNote) {
    const textIdx = built.blocks.findIndex((b) => b.type === 'text');
    if (textIdx >= 0 && built.blocks[textIdx].type === 'text') {
      const orig = (built.blocks[textIdx] as { text: string }).text;
      (built.blocks[textIdx] as { text: string }).text =
        `${orig}\n\n[Note: ${built.fallbackNote}]`;
    }
  }
  return { blocks: built.blocks, fallbackNote: built.fallbackNote };
}
